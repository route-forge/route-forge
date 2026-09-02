import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, getCurrentInstance, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouteForgePlugin, useForge, useForgeApi, useForgeRoute } from '../src/index.js';
import type { LevelRoutesResponse, SummaryResponse } from '@route-forge/core';

// ─── mock backend ───────────────────────────────────────────

const summary: SummaryResponse = {
  levels: {
    public: { description: 'public', load: 'lazy', cache: 300, route_count: 2 },
  },
  config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
  unassigned: [],
};

const levelRoutes: LevelRoutesResponse = {
  level: 'public',
  routes: {
    'users.index': { name: 'users.index', uri: 'users', methods: ['GET'], parameters: [] },
    'users.show': {
      name: 'users.show',
      uri: 'users/{user}',
      methods: ['GET'],
      parameters: ['user'],
    },
  },
};

const backend = { levelOk: true, apiOk: true };

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  backend.levelOk = true;
  backend.apiOk = true;
  originalFetch = globalThis.fetch;
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const ep = summary.config.endpoint_prefix;
    if (url === ep) return jsonResponse(summary);
    if (url.startsWith(ep + '/')) {
      return backend.levelOk ? jsonResponse(levelRoutes) : jsonResponse({ message: 'boom' }, 500);
    }
    if (!backend.apiOk) return jsonResponse({ message: 'server error' }, 500);
    return jsonResponse({ success: true, echo: { url } });
  });
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as any;
}

function makePlugin() {
  return createRouteForgePlugin({
    endpoint: '/_forge/routes',
    levels: ['public'],
    adapter: 'builtin',
  });
}

// ─── useForge ───────────────────────────────────────────────

describe('useForge', () => {
  it('throws when called outside plugin', () => {
    const C = defineComponent({
      setup() {
        useForge();
        return () => null;
      },
    });
    expect(() => mount(C)).toThrow('[route-forge/vue] useForge() must be used inside an app with createRouteForgePlugin() installed');
  });

  it('callable form: forge.api(level, name, params) invokes api', async () => {
    let forge: any;
    const C = defineComponent({
      setup() {
        forge = useForge();
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    const result: any = await forge.api('public', 'users.index');
    expect(result.data.success).toBe(true);
    expect(result.data.echo.url).toBe('/users');
  });

  it('bound form: forge(name, params) auto-binds level; no prefix property when not given', async () => {
    let bound: any;
    const C = defineComponent({
      setup() {
        bound = useForge('public');
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    expect(typeof bound).toBe('function');
    expect(bound.level).toBe('public');
    expect('prefix' in bound).toBe(false);
    const result: any = await bound('users.show', { user: 7 });
    expect(result.data.echo.url).toBe('/users/7');
  });

  it('bound form with prefix resolves suffixed route names', async () => {
    let bound: any;
    const C = defineComponent({
      setup() {
        bound = useForge('public', 'users');
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    expect(bound.prefix).toBe('users');
    const result: any = await bound('show', { user: 3 });
    expect(result.data.echo.url).toBe('/users/3');
  });

  it('bound forge props are immutable and non-enumerable', () => {
    let bound: any;
    const C = defineComponent({
      setup() {
        bound = useForge('public');
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    const desc = Object.getOwnPropertyDescriptor(bound, 'level')!;
    expect(desc.writable).toBe(false);
    expect(desc.enumerable).toBe(false);
    expect(desc.configurable).toBe(false);
    expect(Object.keys(bound)).not.toContain('level');
  });
});

// ─── $forge global property ─────────────────────────────────

describe('$forge global property', () => {
  it('$forge.route resolves url after level load', async () => {
    let url: string | undefined;
    const C = defineComponent({
      setup() {
        const forge = useForge();
        const instance = getCurrentInstance()!;
        const loaded = ref(false);
        forge.load('public').then(() => (loaded.value = true));
        return () => {
          if (loaded.value) {
            url = (instance.appContext.config.globalProperties as any).$forge.route('public', 'users.show', { user: 99 });
          }
          return null;
        };
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    expect(url).toBe('/users/99');
  });
});

// ─── useForgeApi ────────────────────────────────────────────

describe('useForgeApi', () => {
  it('successful call resolves data and clears error', async () => {
    let api: any;
    const C = defineComponent({
      setup() {
        api = useForgeApi('public');
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    const { data, error } = await api.call('users.index');
    expect(error).toBeNull();
    expect(data.data.success).toBe(true);
    expect(api.pending.value).toBe(false);
    expect(api.error.value).toBeNull();
  });

  it('concurrent calls keep pending true until all complete', async () => {
    // 引用计数：先完成的 call 不把其他在途请求的 pending 提前清掉
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((r) => { releaseFirst = r; });
    const origFetch = (globalThis as any).fetch;
    let usersCalls = 0;
    (globalThis as any).fetch = vi.fn(async (url: string, ...rest: unknown[]) => {
      // 第一个业务请求被 gate 卡住，第二个正常完成
      if (url === '/users' && ++usersCalls === 1) await gate;
      return origFetch(url, ...rest);
    });

    let api: any;
    const C = defineComponent({
      setup() {
        api = useForgeApi('public');
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();

    const first = api.call('users.index');
    const second = api.call('users.index');
    await second;
    await nextTick();
    // 先完成的 call 不清除 pending（旧实现此处已翻 false）
    expect(api.pending.value).toBe(true);
    releaseFirst();
    await first;
    await nextTick();
    // 全部完成才置 false
    expect(api.pending.value).toBe(false);
    (globalThis as any).fetch = origFetch;
  });

  it('failed call sets error ref and returns it without throwing', async () => {
    backend.apiOk = false;
    let api: any;
    const C = defineComponent({
      setup() {
        api = useForgeApi('public');
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    const { data, error } = await api.call('users.index');
    expect(data).toBeUndefined();
    expect(error).toBeTruthy();
    expect((error as any).code).toBe('RF_FE_008');
    expect(api.error.value).toBe(error);
    expect(api.pending.value).toBe(false);
  });
});

// ─── useForgeRoute ──────────────────────────────────────────

describe('useForgeRoute', () => {
  it('builds url with static params after level load', async () => {
    let url: string | undefined;
    const C = defineComponent({
      setup() {
        const urlRef = useForgeRoute('public', 'users.show', () => ({ user: 42 }));
        return () => {
          url = urlRef.value; // always access reactive value to trigger re-render
          return null;
        };
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    await flushPromises();
    expect(url).toBe('/users/42');
  });

  it('returns empty string before level loads, then updates', async () => {
    const urls: string[] = [];
    const C = defineComponent({
      setup() {
        const userId = ref(1);
        const urlRef = useForgeRoute('public', 'users.show', () => ({ user: userId.value }));
        return () => {
          urls.push(urlRef.value);
          if (urlRef.value === '/users/1') {
            // level loaded with user 1, now change param to test reactivity
            userId.value = 2;
          }
          return null;
        };
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    await nextTick();
    await flushPromises();
    expect(urls).toContain('');
    expect(urls).toContain('/users/1');
    expect(urls).toContain('/users/2');
  });

  it('returns empty string instead of crashing render when route name does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let url: string | undefined;
    let renderCrashed = false;
    const C = defineComponent({
      setup() {
        const urlRef = useForgeRoute('public', 'users.nonexistent');
        return () => {
          try {
            url = urlRef.value;
          } catch {
            renderCrashed = true;
          }
          return null;
        };
      },
      errorCaptured() {
        renderCrashed = true;
        return false;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    await flushPromises();
    // 渲染不炸 + 降级为空字符串
    expect(renderCrashed).toBe(false);
    expect(url).toBe('');
    // 错误以醒目 warn 输出（含错误对象）
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[route-forge]'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('returns empty string instead of crashing render when required param is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let url: string | undefined;
    const C = defineComponent({
      setup() {
        // users.show 需要 user 参数，故意不传
        const urlRef = useForgeRoute('public', 'users.show', () => ({}));
        return () => {
          url = urlRef.value;
          return null;
        };
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    await flushPromises();
    expect(url).toBe('');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // 注：level 收窄为静态字符串后（不支持 getter 形式），原"level 快照不追踪 getter 变化"
  // 的运行时测试随 API 一并移除——传 getter 现在是类型错误，无需运行时验证。

  it('throws TypeError when level is not a static string (runtime guard)', () => {
    const C = defineComponent({
      setup() {
        let err: unknown;
        try {
          useForgeRoute((() => 'public') as unknown as string, 'login.show');
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(TypeError);
        expect(String(err)).toContain('level must be a static string');
        return () => null;
      },
    });
    // 断言在 setup 内完成，挂载本身不应再抛错
    expect(() => mount(C, { global: { plugins: [makePlugin()] } })).not.toThrow();
  });
});

// ─── API trimming & levelLoaded ─────────────────────────────

describe('useForge API trimming', () => {
  it('useForge() without level returns full RouteForge instance', () => {
    let forge: any;
    const C = defineComponent({
      setup() {
        forge = useForge();
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    // useForge() returns the full RouteForge instance with all top-level methods
    expect(typeof forge.api).toBe('function');
    expect(typeof forge.load).toBe('function');
    expect(typeof forge.route).toBe('function');
    expect(typeof forge.url).toBe('function');
    expect(typeof forge.hasRoute).toBe('function');
    expect(typeof forge.getRoutes).toBe('function');
    expect(typeof forge.isLoaded).toBe('function');
    expect(typeof forge.ready).toBe('function');
    expect(typeof forge.use).toBe('function');
    // onLevelLoaded only exists on BoundForge (after use(level)), not on top-level RouteForge
    expect(forge.onLevelLoaded).toBeUndefined();
  });

  it('useForge(level) returns levelLoaded ref and auto-triggers load', async () => {
    let bound: any;
    const C = defineComponent({
      setup() {
        bound = useForge('public');
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    // levelLoaded should exist
    expect(bound.levelLoaded).toBeDefined();
    // 覆盖后的 levelLoaded 保持可重配置（对齐 core BoundForge 与 React 适配层）
    expect(Object.getOwnPropertyDescriptor(bound, 'levelLoaded')!.configurable).toBe(true);
    await flushPromises();
    // after auto-load, levelLoaded should be true
    expect(bound.levelLoaded.value).toBe(true);
    expect(bound.isLoaded('public')).toBe(true);
  });

  it('createRouteForgePlugin returns ready method that returns promise', async () => {
    const plugin = makePlugin();
    expect(plugin.ready).toBeDefined();
    expect(typeof plugin.ready).toBe('function');
    const p = plugin.ready();
    expect(typeof p.then).toBe('function');
    await p;
  });
});

describe('plugin.ready() (M5)', () => {
  it('resolves after auto-discovery + eager load; recommended mount entry', async () => {
    const plugin = createRouteForgePlugin({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    // onSummaryReady 已移除（v2.0.0）：挂载应用统一走 ready().then(...)，
    // 失败走 .catch —— 完整的成功/失败语义链
    const mounted = await plugin.ready().then(() => true).catch(() => false);
    expect(mounted).toBe(true);
    expect(plugin.ready).toBeTypeOf('function');
  });
});
