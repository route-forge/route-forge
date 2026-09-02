import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteForge, UnknownRouteError } from '../src/index.js';
import type { LevelRoutesResponse, RequestConfig, SummaryResponse } from '../src/types.js';
import { makeSummary as normalizeSummary, type SummaryOverrides } from './fixtures.js';

// ─── mock helpers ───────────────────────────────────────────

function makeSummary(overrides: SummaryOverrides = {}): SummaryResponse {
  return normalizeSummary({
    levels: { public: { description: 'public', load: 'lazy', route_count: 1 } },
    ...overrides,
  });
}

/** URL 感知 mock：摘要 / 层级拉取 / 业务请求分别处理，并记录全部调用 */
function mockBackend(summary: SummaryResponse, levelRoutes: Record<string, LevelRoutesResponse>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const ep = summary.config.endpoint_prefix;
    if (url === ep) {
      return jsonResponse(summary);
    }
    if (url.startsWith(ep + '/')) {
      const level = url.slice(ep.length + 1).split('/')[0]!.split('?')[0]!;
      const lr = levelRoutes[level];
      if (!lr) return jsonResponse({}, 404);
      return jsonResponse(lr);
    }
    // 业务 api 请求
    return jsonResponse({ success: true });
  });
  return calls;
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as any;
}

function makeLevel(routes: Record<string, any>): LevelRoutesResponse {
  return { level: 'public', routes };
}

async function createLoadedForge(routes: Record<string, any>) {
  const calls = mockBackend(makeSummary(), { public: makeLevel(routes) });
  const forge = createRouteForge({
    endpoint: '/_forge/routes',
    levels: ['public'],
    adapter: 'builtin',
  });
  await forge.load('public');
  return { forge, calls };
}

// ─── tests ──────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('URL building — substitution edge cases', () => {
  it('param values with special characters are URI-encoded', async () => {
    const { forge } = await createLoadedForge({
      'user.show': {
        name: 'user.show',
        uri: 'users/{user}',
        methods: ['GET'],
        parameters: ['user'],
      },
    });
    const url = forge.route('public', 'user.show', { user: 'a b/c&?#中' });
    expect(url).toBe('/users/a%20b%2Fc%26%3F%23%E4%B8%AD');
  });

  it('param value containing {placeholder} text is NOT re-substituted (injection guard)', async () => {
    const { forge } = await createLoadedForge({
      'pair.show': {
        name: 'pair.show',
        uri: 'a/{x}/b/{y}',
        methods: ['GET'],
        parameters: ['x', 'y'],
      },
    });
    // x 的值包含字面量 "{y}"：旧逐参数替换实现会把 {y} 二次替换成 real，
    // 单次遍历实现下应原样编码为 %7By%7D
    const url = forge.route('public', 'pair.show', { x: '{y}', y: 'real' });
    expect(url).toBe('/a/%7By%7D/b/real');
  });

  it('boolean and zero param values are stringified, not treated as missing', async () => {
    const { forge } = await createLoadedForge({
      'flags.show': {
        name: 'flags.show',
        uri: 'flags/{active}/{count}',
        methods: ['GET'],
        parameters: ['active', 'count'],
      },
    });
    const url = forge.route('public', 'flags.show', { active: false, count: 0 });
    expect(url).toBe('/flags/false/0');
  });

  it('missing leading optional param cleans up leftover slash', async () => {
    const { forge } = await createLoadedForge({
      'post.show': {
        name: 'post.show',
        uri: '{locale?}/posts/{post}',
        methods: ['GET'],
        parameters: ['locale', 'post'],
      },
    });
    const url = forge.route('public', 'post.show', { post: 42 });
    expect(url).toBe('/posts/42');
  });

  it('undeclared placeholder in uri is left untouched', async () => {
    const { forge } = await createLoadedForge({
      'odd.show': {
        name: 'odd.show',
        uri: 'odd/{known}/{mystery}',
        methods: ['GET'],
        parameters: ['known'],
      },
    });
    const url = forge.route('public', 'odd.show', { known: 'k' });
    expect(url).toContain('/odd/k/');
    expect(url).toContain('{mystery}');
  });

  it('url() alias produces identical result to route()', async () => {
    const { forge } = await createLoadedForge({
      'user.show': {
        name: 'user.show',
        uri: 'users/{user}',
        methods: ['GET'],
        parameters: ['user'],
      },
    });
    expect(forge.url('public', 'user.show', { user: 9 })).toBe(forge.route('public', 'user.show', { user: 9 }));
  });

  it('route() throws UnknownRouteError when level cache not loaded yet', () => {
    mockBackend(makeSummary(), { public: makeLevel({}) });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    // 未 load：同步 route() 直接抛
    expect(() => forge.route('public', 'user.show')).toThrow(UnknownRouteError);
  });
});

describe('method selection', () => {
  async function captureMethod(methods: string[]): Promise<string> {
    let captured: RequestConfig | null = null;
    const { forge } = await createLoadedForge({
      'item.act': { name: 'item.act', uri: 'items', methods, parameters: [] },
    });
    forge.interceptors.request.use((c) => {
      captured = c;
      return c;
    });
    await forge.api('public', 'item.act');
    return captured!.method;
  }

  it('prefers non-HEAD method when HEAD listed first', async () => {
    expect(await captureMethod(['HEAD', 'GET'])).toBe('GET');
  });

  it('uses POST when methods are [HEAD, POST]', async () => {
    expect(await captureMethod(['HEAD', 'POST'])).toBe('POST');
  });

  it('falls back to first method when only HEAD declared', async () => {
    expect(await captureMethod(['HEAD'])).toBe('HEAD');
  });
});

describe('query string serialization', () => {
  it('serializes query object skipping null/undefined values', async () => {
    let captured: RequestConfig | null = null;
    const { forge } = await createLoadedForge({
      'search.index': { name: 'search.index', uri: 'search', methods: ['GET'], parameters: [] },
    });
    forge.interceptors.request.use((c) => {
      captured = c;
      return c;
    });
    await forge.api('public', 'search.index', {
      query: { page: 2, kw: 'a b', skipNull: null, skipUndef: undefined },
    });
    expect(captured!.url).toBe('/search?page=2&kw=a+b');
  });

  it('empty query object leaves url unchanged', async () => {
    let captured: RequestConfig | null = null;
    const { forge } = await createLoadedForge({
      'search.index': { name: 'search.index', uri: 'search', methods: ['GET'], parameters: [] },
    });
    forge.interceptors.request.use((c) => {
      captured = c;
      return c;
    });
    await forge.api('public', 'search.index', { query: {} });
    expect(captured!.url).toBe('/search');
  });

  it('per-call timeout overrides global timeout in RequestConfig', async () => {
    let captured: RequestConfig | null = null;
    mockBackend(makeSummary(), {
      public: makeLevel({
        'slow.show': { name: 'slow.show', uri: 'slow', methods: ['GET'], parameters: [] },
      }),
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      timeout: 30_000,
    });
    await forge.load('public');
    forge.interceptors.request.use((c) => {
      captured = c;
      return c;
    });
    await forge.api('public', 'slow.show', { timeout: 1234 });
    expect(captured!.timeout).toBe(1234);
  });
});

describe('load / invalidate / isLoaded lifecycle', () => {
  it('concurrent load() deduplicates into a single fetch', async () => {
    const calls = mockBackend(makeSummary(), {
      public: makeLevel({
        'home': {
          name: 'home',
          uri: 'home',
          methods: ['GET'],
          parameters: [],
        },
      }),
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await Promise.all([forge.load('public'), forge.load('public'), forge.load('public')]);
    const levelFetches = calls.filter((c) => c.url === '/_forge/routes/public');
    expect(levelFetches.length).toBe(1);
  });

  it('second load() hits cache and does not refetch', async () => {
    const calls = mockBackend(makeSummary(), {
      public: makeLevel({
        'home': {
          name: 'home',
          uri: 'home',
          methods: ['GET'],
          parameters: [],
        },
      }),
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');
    await forge.load('public');
    const levelFetches = calls.filter((c) => c.url === '/_forge/routes/public');
    expect(levelFetches.length).toBe(1);
  });

  it('invalidate(level) forces refetch on next load', async () => {
    const calls = mockBackend(makeSummary(), {
      public: makeLevel({
        'home': {
          name: 'home',
          uri: 'home',
          methods: ['GET'],
          parameters: [],
        },
      }),
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');
    forge.invalidate('public');
    expect(forge.isLoaded('public')).toBe(false);
    await forge.load('public');
    const levelFetches = calls.filter((c) => c.url === '/_forge/routes/public');
    expect(levelFetches.length).toBe(2);
  });

  it('invalidate() without args clears all levels', async () => {
    mockBackend(makeSummary(), {
      public: makeLevel({
        'home': {
          name: 'home',
          uri: 'home',
          methods: ['GET'],
          parameters: [],
        },
      }),
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');
    expect(forge.isLoaded()).toBe(true);
    forge.invalidate();
    expect(forge.isLoaded('public')).toBe(false);
    expect(forge.isLoaded()).toBe(false);
  });

  it('isLoaded() is false before load and before discovery completes', () => {
    mockBackend(makeSummary(), { public: makeLevel({}) });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    expect(forge.isLoaded()).toBe(false);
    expect(forge.isLoaded('public')).toBe(false);
  });

  it('failed load rejects and is retryable (failure not cached)', async () => {
    let levelStatus = 500;
    const summary = makeSummary();
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === summary.config.endpoint_prefix) return jsonResponse(summary);
      if (url === '/_forge/routes/public') {
        if (levelStatus !== 200) return jsonResponse({}, levelStatus);
        return jsonResponse(makeLevel({
          'home': {
            name: 'home',
            uri: 'home',
            methods: ['GET'],
            parameters: [],
          },
        }));
      }
      return jsonResponse({});
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await expect(forge.load('public')).rejects.toThrow();
    expect(forge.isLoaded('public')).toBe(false);
    // 修复后重试应成功（失败不会被当成缓存）
    levelStatus = 200;
    await forge.load('public');
    expect(forge.isLoaded('public')).toBe(true);
  });

  it('load(array) loads multiple levels in parallel', async () => {
    const summary = makeSummary({
      levels: {
        public: { description: 'p', load: 'lazy', cache: 300, route_count: 1 },
        admin: { description: 'a', load: 'lazy', cache: 300, route_count: 1 },
      },
    });
    mockBackend(summary, {
      public: {
        level: 'public',
        routes: { 'home': { name: 'home', uri: 'home', methods: ['GET'], parameters: [] } },
      },
      admin: {
        level: 'admin',
        routes: { 'dash': { name: 'dash', uri: 'dash', methods: ['GET'], parameters: [] } },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'admin'],
      adapter: 'builtin',
    });
    await forge.load(['public', 'admin']);
    expect(forge.isLoaded('public')).toBe(true);
    expect(forge.isLoaded('admin')).toBe(true);
    expect(forge.isLoaded()).toBe(true);
  });
});

describe('getRoutes snapshot isolation', () => {
  it('getRoutes(level) returns deep-ish copy: mutating it does not affect cache', async () => {
    const { forge } = await createLoadedForge({
      'user.show': {
        name: 'user.show',
        uri: 'users/{user}',
        methods: ['GET'],
        parameters: ['user'],
      },
    });
    const snapshot = forge.getRoutes('public');
    expect(Object.keys(snapshot)).toEqual(['user.show']);
    // 篡改快照：不应影响内部缓存
    snapshot['user.show']!.uri = 'hacked/{user}';
    delete snapshot['user.show'];
    expect(forge.hasRoute('public', 'user.show')).toBe(true);
    expect(forge.route('public', 'user.show', { user: 1 })).toBe('/users/1');
  });

  it('getRoutes() without level groups all loaded levels', async () => {
    const summary = makeSummary({
      levels: {
        public: { description: 'p', load: 'lazy', cache: 300, route_count: 1 },
        admin: { description: 'a', load: 'lazy', cache: 300, route_count: 1 },
      },
    });
    mockBackend(summary, {
      public: {
        level: 'public',
        routes: { 'home': { name: 'home', uri: 'home', methods: ['GET'], parameters: [] } },
      },
      admin: {
        level: 'admin',
        routes: { 'dash': { name: 'dash', uri: 'dash', methods: ['GET'], parameters: [] } },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'admin'],
      adapter: 'builtin',
    });
    await forge.load(['public', 'admin']);
    const all = forge.getRoutes();
    expect(Object.keys(all).sort()).toEqual(['admin', 'public']);
    expect(all['public']!['home']!.uri).toBe('home');
    expect(all['admin']!['dash']!.uri).toBe('dash');
  });

  it('getRoutes(unknownLevel) returns empty object without throwing', async () => {
    const { forge } = await createLoadedForge({});
    expect(forge.getRoutes('public')).toEqual({});
  });

  it('getRoutes() no-arg overload deep-copies nested structures (L5)', async () => {
    // 审计项 L5：嵌套对象（parameter_defaults）不能与内部缓存共享引用
    const { forge } = await createLoadedForge({
      'user.show': {
        name: 'user.show',
        uri: 'users/{user}',
        methods: ['GET'],
        parameters: ['user'],
        parameter_defaults: { user: 1 },
      },
    });
    const all = forge.getRoutes();
    const meta = all['public']!['user.show']!;
    // 篡改返回值（含嵌套对象）
    meta.uri = 'HACKED';
    meta.parameter_defaults!.user = 999;
    // 内部缓存不受影响
    const fresh = forge.getRoutes('public');
    expect(fresh['user.show']!.uri).toBe('users/{user}');
    expect(fresh['user.show']!.parameter_defaults).toEqual({ user: 1 });
  });
});
