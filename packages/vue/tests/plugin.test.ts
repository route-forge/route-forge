import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouteForge } from '@route-forge/core';
import type { LevelRoutesResponse, SummaryResponse } from '@route-forge/core';
import { createRouteForgePlugin, ForgeReady, FORGE_INJECTION_KEY, useForge } from '../src/index.js';

describe('@route-forge/vue plugin (scaffold smoke test)', () => {
  it('installs and provides injection key ($forge removed in v3.0.0)', () => {
    const app = createApp({ template: '<div/>' });
    app.use(createRouteForgePlugin({
      endpoint: '/_forge/routes',
      levels: ['public'],
    }));
    expect(FORGE_INJECTION_KEY).toBeTruthy();
  });
});

// ─── mock backend（创建期拦截器功能用例复用）─────────────────

const summary: SummaryResponse = {
  schemeVersion: 1,
  levels: {
    public: {
      description: 'public',
      load: 'lazy',
      route_count: 2,
      route: { uri: '/_forge/routes/public', methods: ['GET', 'HEAD'] },
    },
  },
  config: { strict_mode: false, endpoint_prefix: '/_forge/routes', url_prefix: null, cache_ttl: 3600 },
};

const levelRoutes: LevelRoutesResponse = {
  level: 'public',
  routes: {
    'users.index': { name: 'users.index', uri: 'users', methods: ['GET'], parameters: [] },
    'users.show': { name: 'users.show', uri: 'users/{user}', methods: ['GET'], parameters: ['user'] },
  },
};

let originalFetch: typeof globalThis.fetch;

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as any;
}

describe('createRouteForgePlugin() 暴露 interceptors（创建期同步注册）', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      const ep = summary.config.endpoint_prefix;
      if (url === ep) return jsonResponse(summary);
      if (url.startsWith(ep + '/')) return jsonResponse(levelRoutes);
      return jsonResponse({ success: true, echo: { url } });
    });
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function makePlugin() {
    return createRouteForgePlugin({ endpoint: '/_forge/routes', levels: ['public'], adapter: 'builtin' });
  }

  it('无需 await ready()：工厂返回即同步暴露 request/response 拦截器，注册返回数值 id', () => {
    const plugin = makePlugin(); // 未调用 ready()
    expect(typeof plugin.interceptors.request.use).toBe('function');
    expect(typeof plugin.interceptors.response.use).toBe('function');
    const id = plugin.interceptors.request.use((c) => c);
    expect(typeof id).toBe('number');
  });

  it('plugin.interceptors 与 app 注入实例的 interceptors 是同一引用（注册可穿透到下游）', () => {
    const plugin = makePlugin();
    let provided: any;
    const C = defineComponent({
      setup() {
        provided = useForge();
        return () => null;
      },
    });
    mount(C, { global: { plugins: [plugin] } });
    expect(provided.interceptors).toBe(plugin.interceptors);
    expect(provided.interceptors.request).toBe(plugin.interceptors.request);
  });

  it('创建期注册的请求拦截器，在后续 api() 调用中生效（不依赖 ready 之后注册）', async () => {
    const plugin = makePlugin();
    let reqRan = false;
    // 在 app.use / mount / ready 之前，仅在工厂返回后就注册
    plugin.interceptors.request.use((c) => {
      reqRan = true;
      return c;
    });

    let forge: any;
    const C = defineComponent({
      setup() {
        forge = useForge();
        return () => null;
      },
    });
    mount(C, { global: { plugins: [plugin] } });

    await forge.ready();
    await forge.api('public', 'users.index');
    expect(reqRan).toBe(true);
  });

  it('多个拦截器可依次注册并在同一次 api() 中全部执行', async () => {
    const plugin = makePlugin();
    const order: string[] = [];
    plugin.interceptors.request.use((c) => { order.push('a'); return c; });
    plugin.interceptors.request.use((c) => { order.push('b'); return c; });

    let forge: any;
    const C = defineComponent({
      setup() {
        forge = useForge();
        return () => null;
      },
    });
    mount(C, { global: { plugins: [plugin] } });

    await forge.ready();
    await forge.api('public', 'users.index');
    // 请求拦截器 LIFO：后注册先执行
    expect(order).toEqual(['b', 'a']);
  });
});

describe('createRouteForgePlugin 传入实例（复用模式）', () => {
  it('reuses the provided forge instance instead of creating a new one', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(summary)));
    const external = createRouteForge({ endpoint: '/_forge/routes', levels: ['public'], adapter: 'builtin' });
    let provided: any;
    const C = defineComponent({
      setup() {
        provided = useForge();
        return () => null;
      },
    });
    mount(C, { global: { plugins: [createRouteForgePlugin(external)] } });
    expect(provided).toBe(external);
    expect(provided.interceptors).toBe(external.interceptors);
    vi.unstubAllGlobals();
  });
});

describe('ForgeReady（ready 门闩组件）', () => {
  it('renders fallback until ready() resolves, then default slot', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === summary.config.endpoint_prefix) return jsonResponse(summary);
      return jsonResponse(levelRoutes);
    }));
    const plugin = createRouteForgePlugin({ endpoint: '/_forge/routes', levels: ['public'], adapter: 'builtin' });
    const wrapper = mount(ForgeReady, {
      slots: {
        default: () => h('span', 'content'),
        fallback: () => h('span', 'gated'),
      },
      global: { plugins: [plugin] },
    });
    // ready 前：fallback
    expect(wrapper.text()).toBe('gated');
    await flushPromises();
    // ready 后：default
    expect(wrapper.text()).toBe('content');
    vi.unstubAllGlobals();
  });

  it('opens immediately (no fallback frame) when forge is already ready', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === summary.config.endpoint_prefix) return jsonResponse(summary);
      return jsonResponse(levelRoutes);
    }));
    const forge = createRouteForge({ endpoint: '/_forge/routes', levels: ['public'], adapter: 'builtin' });
    await forge.ready();
    const plugin = createRouteForgePlugin(forge);
    const wrapper = mount(ForgeReady, {
      slots: {
        default: () => h('span', 'content'),
        fallback: () => h('span', 'gated'),
      },
      global: { plugins: [plugin] },
    });
    expect(wrapper.text()).toBe('content');
    vi.unstubAllGlobals();
  });
});
