import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, getCurrentInstance, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import {
  createRouteForgePlugin,
  useForge,
  useForgeApi,
  useForgeLevel,
  useForgeRoute,
} from '../src/index.js';
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

  it('callable form: forge(level, name, params) invokes api', async () => {
    let forge: any;
    const C = defineComponent({
      setup() {
        forge = useForge();
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    const result: any = await forge('public', 'users.index');
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

  it('bound forge props are immutable, non-enumerable and interceptors are frozen', () => {
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
    expect(Object.isFrozen(bound.interceptors)).toBe(true);
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

// ─── useForgeLevel ──────────────────────────────────────────

describe('useForgeLevel', () => {
  it('auto-loads on mount and flips loaded to true', async () => {
    let state: any;
    const C = defineComponent({
      setup() {
        state = useForgeLevel('public');
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    expect(state.loaded.value).toBe(true);
    expect(state.error.value).toBeNull();
  });

  it('load failure sets error ref', async () => {
    backend.levelOk = false;
    let state: any;
    const C = defineComponent({
      setup() {
        state = useForgeLevel('public');
        return () => null;
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    expect(state.loaded.value).toBe(false);
    expect(state.error.value).toBeTruthy();
  });
});

// ─── useForgeRoute ──────────────────────────────────────────

describe('useForgeRoute', () => {
  it('builds url with static params after level load', async () => {
    let url: string | undefined;
    const C = defineComponent({
      setup() {
        const { loaded } = useForgeLevel('public');
        const urlRef = useForgeRoute('public', 'users.show', () => ({ user: 42 }));
        return () => {
          if (loaded.value) url = urlRef.value;
          return null;
        };
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    expect(url).toBe('/users/42');
  });

  it('reactive params: url updates when ref changes', async () => {
    const urls: string[] = [];
    const C = defineComponent({
      setup() {
        const { loaded } = useForgeLevel('public');
        const userId = ref(1);
        const urlRef = useForgeRoute('public', 'users.show', () => ({ user: userId.value }));
        return () => {
          if (loaded.value) {
            urls.push(urlRef.value);
            if (urls.length === 1) {
              userId.value = 2;
            }
          }
          return null;
        };
      },
    });
    mount(C, { global: { plugins: [makePlugin()] } });
    await flushPromises();
    await flushPromises();
    expect(urls).toContain('/users/1');
    expect(urls).toContain('/users/2');
  });
});
