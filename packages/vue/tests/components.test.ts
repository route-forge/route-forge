import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouteForgePlugin, ForgeLink, ForgeRoute } from '../src/index.js';
import type { LevelRoutesResponse, SummaryResponse } from '@route-forge/core';

// ─── mock backend ───────────────────────────────────────────

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
    'users.show': {
      name: 'users.show',
      uri: 'users/{user}',
      methods: ['GET'],
      parameters: ['user'],
    },
  },
};

let originalFetch: typeof globalThis.fetch;

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

/** 模拟 vue-router 全局注册的 RouterLink（不依赖 vue-router 本体，验证探测与 to 传参） */
const RouterLinkStub = defineComponent({
  name: 'RouterLink',
  props: { to: { type: [String, Object], required: true } },
  setup(props, { slots }) {
    return () => h('span', { 'data-testid': 'router-link', 'data-to': props.to }, slots.default?.());
  },
});

// ─── ForgeLink ──────────────────────────────────────────────

describe('ForgeLink', () => {
  it('renders nothing while level not loaded, then <a href> after load (attrs passthrough)', async () => {
    const wrapper = mount(ForgeLink, {
      props: { level: 'public', name: 'users.show', params: { user: 7 }, class: 'btn', 'data-testid': 'link' },
      slots: { default: () => '查看用户' },
      global: { plugins: [makePlugin()] },
    });

    // 未加载：默认不渲染
    expect(wrapper.find('a').exists()).toBe(false);
    await flushPromises();

    const a = wrapper.find('a');
    expect(a.exists()).toBe(true);
    expect(a.attributes('href')).toBe('/users/7');
    expect(a.text()).toBe('查看用户');
    expect(a.classes()).toContain('btn');
    expect(a.attributes('data-testid')).toBe('link');
  });

  it('renders loading slot while not loaded', async () => {
    const wrapper = mount(ForgeLink, {
      props: { level: 'public', name: 'users.index' },
      slots: { default: () => '列表', loading: () => h('span', 'loading…') },
      global: { plugins: [makePlugin()] },
    });

    expect(wrapper.text()).toBe('loading…');
    await flushPromises();
    const a = wrapper.find('a');
    expect(a.exists()).toBe(true);
    expect(a.attributes('href')).toBe('/users');
    expect(a.text()).toBe('列表');
  });

  it('renders globally registered RouterLink with to=<href> when available', async () => {
    const wrapper = mount(ForgeLink, {
      props: { level: 'public', name: 'users.show', params: { user: 7 }, class: 'rl' },
      slots: { default: () => '查看用户' },
      global: { plugins: [makePlugin()], components: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    // 探测到全局 RouterLink → 渲染 RouterLink 而非 <a>
    expect(wrapper.find('a').exists()).toBe(false);
    const rl = wrapper.find('[data-testid="router-link"]');
    expect(rl.exists()).toBe(true);
    expect(rl.attributes('data-to')).toBe('/users/7');
    expect(rl.text()).toBe('查看用户');
    expect(rl.classes()).toContain('rl');
  });

  it('degrades to console.error (not crash) when route name is unknown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = mount(ForgeLink, {
      props: { level: 'public', name: 'nope.missing' },
      slots: { loading: () => h('span', 'fallback') },
      global: { plugins: [makePlugin()] },
    });
    await flushPromises();

    // level 已加载但路由解析失败 → 降级为 ''：渲染 loading 占位，渲染不中断
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.text()).toBe('fallback');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.join(' '))).toContain('ForgeLink 路由解析失败');
    // 初次渲染时 level 确实未加载（"尚未加载" warn 属预期），且仅一次
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('尚未加载');
  });

  it('warns once per instance while unloaded', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = mount(ForgeLink, {
      props: { level: 'public', name: 'users.index' },
      global: { plugins: [makePlugin()] },
    });

    // 未加载期间的首次渲染：warn 一次
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('尚未加载');

    await flushPromises();
    // 加载完成后重渲染：不再 warn
    await wrapper.setProps({ name: 'users.show' });
    await flushPromises();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('reacts to params / name prop changes (object form and getter form)', async () => {
    const wrapper = mount(ForgeLink, {
      props: { level: 'public', name: 'users.show', params: { user: 7 } },
      global: { plugins: [makePlugin()] },
    });
    await flushPromises();
    expect(wrapper.find('a').attributes('href')).toBe('/users/7');

    // 对象形式：props 响应式更新
    await wrapper.setProps({ params: { user: 8 } });
    expect(wrapper.find('a').attributes('href')).toBe('/users/8');

    // getter 形式：函数形式同样响应
    await wrapper.setProps({ params: () => ({ user: 9 }) });
    expect(wrapper.find('a').attributes('href')).toBe('/users/9');
  });
});

// ─── ForgeRoute ─────────────────────────────────────────────

describe('ForgeRoute', () => {
  it('exposes { href, loaded } via scoped slot; loading slot before load', async () => {
    const wrapper = mount(ForgeRoute, {
      props: { level: 'public', name: 'users.show', params: { user: 7 } },
      slots: {
        default: ({ href, loaded }: { href: string; loaded: boolean }) =>
          h('a', { href }, loaded ? 'ready' : 'not-ready'),
        loading: () => h('span', 'loading…'),
      },
      global: { plugins: [makePlugin()] },
    });

    expect(wrapper.text()).toBe('loading…');
    await flushPromises();
    expect(wrapper.find('a').attributes('href')).toBe('/users/7');
    expect(wrapper.text()).toBe('ready');
  });

  it('renders nothing without slots (both before and after load)', async () => {
    const wrapper = mount(ForgeRoute, {
      props: { level: 'public', name: 'users.index' },
      global: { plugins: [makePlugin()] },
    });

    expect(wrapper.html()).toBe('');
    await flushPromises();
    // 无 default 插槽：加载完成后也没有可渲染内容
    expect(wrapper.html()).toBe('');
  });

  it('degrades to console.error when route resolution fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mount(ForgeRoute, {
      props: { level: 'public', name: 'nope.missing' },
      // 解析失败降级为 ''（loaded=false）→ 渲染 loading 插槽（此处未传 → 不渲染）
      slots: {
        default: ({ href, loaded }: { href: string; loaded: boolean }) =>
          h('span', { 'data-testid': 'state' }, `${href}|${loaded}`),
      },
      global: { plugins: [makePlugin()] },
    });
    await flushPromises();

    expect(wrapper.html()).toBe('');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.join(' '))).toContain('ForgeRoute 路由解析失败');
  });
});
