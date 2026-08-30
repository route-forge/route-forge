import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRouteForge,
  ForgeError,
  MissingRouteParamError,
  RequestAbortedError,
  UnknownLevelError,
  UnknownRouteError,
} from '../src/index.js';
import type { LevelRoutesResponse, SummaryResponse } from '../src/types.js';

// Helper: 模拟摘要端点响应
function makeSummary(overrides: Partial<SummaryResponse> = {}): SummaryResponse {
  return {
    levels: {
      public: { description: 'public', load: 'lazy', cache: 300, route_count: 2 },
      admin: { description: 'admin', load: 'eager', cache: 60, route_count: 1 },
    },
    config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
    unassigned: [],
    ...overrides,
  };
}

// Helper: 设置全局 fetch mock
// 注：响应同时提供 json()/text()/headers，兼容摘要端点（用 json）与 builtin adapter（用 text+headers）
function mockSummary(summary: SummaryResponse | null, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (status !== 200) {
      return {
        ok: false,
        status,
        json: async () => ({}),
        text: async () => '',
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    }
    const body = summary === null ? '{}' : JSON.stringify(summary);
    return {
      ok: true,
      status: 200,
      json: async () => summary,
      text: async () => body,
      headers: new Headers({ 'content-type': 'application/json' }),
    } as any;
  });
  return calls;
}

// Helper: 同时 mock 摘要端点与层级路由拉取
function mockFull(
  summary: SummaryResponse,
  levelRoutes: Record<string, LevelRoutesResponse>,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const ep = summary.config.endpoint_prefix;
    // 摘要端点：URL 精确等于 endpoint（不带额外路径）
    if (url === ep) {
      const body = JSON.stringify(summary);
      return {
        ok: true,
        status: 200,
        json: async () => summary,
        text: async () => body,
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    }
    // 层级拉取：URL 形如 {endpoint}/{level}
    if (url.startsWith(ep + '/')) {
      const level = url.slice(ep.length + 1).split('/')[0]!.split('?')[0]!;
      const lr = levelRoutes[level];
      if (!lr) {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => '',
          headers: new Headers(),
        } as any;
      }
      const body = JSON.stringify(lr);
      return {
        ok: true,
        status: 200,
        json: async () => lr,
        text: async () => body,
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '',
      headers: new Headers(),
    } as any;
  });
  return calls;
}

describe('route parameter validation', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const summary = makeSummary({
    config: {
      strict_mode: false,
      endpoint_prefix: '/_forge/routes',
    },
  });

  it('required param missing always throws MissingRouteParamError (strict=false)', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      strict: false,
    });
    await forge.load('public');
    // route() 也应抛
    expect(() => forge.route('public', 'user.show')).toThrow(MissingRouteParamError);
    // api() 也应抛
    await expect(forge.api('public', 'user.show')).rejects.toThrow(MissingRouteParamError);
  });

  it('required param missing always throws MissingRouteParamError (strict=true)', async () => {
    const strictSummary = makeSummary({
      config: {
        strict_mode: true,
        endpoint_prefix: '/_forge/routes',
      },
    });
    mockFull(strictSummary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      strict: true,
    });
    await forge.load('public');
    expect(() => forge.route('public', 'user.show')).toThrow(MissingRouteParamError);
    await expect(forge.api('public', 'user.show')).rejects.toThrow(MissingRouteParamError);
  });

  it('optional param ({param?}) missing replaced with empty string', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'post.show': {
            name: 'post.show',
            uri: 'posts/{post}/{page?}',
            methods: ['GET'],
            parameters: ['post', 'page'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      strict: false,
    });
    await forge.load('public');
    // 必填参数 post 已传，可选参数 page 未传：不抛，{page?} 替换为空并清理残留 /
    const url = forge.route('public', 'post.show', { post: 42 });
    expect(url).toContain('/posts/42');
    expect(url).not.toContain('{page?}');
    expect(url).not.toMatch(/\/\//); // 无连续 //
  });

  it('optional param provided value is substituted', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'post.show': {
            name: 'post.show',
            uri: 'posts/{post}/{page?}',
            methods: ['GET'],
            parameters: ['post', 'page'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');
    const url = forge.route('public', 'post.show', { post: 42, page: 3 });
    expect(url).toContain('/posts/42/3');
  });

  it('param value is correctly substituted into URL', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');
    const url = forge.route('public', 'user.show', { user: 123 });
    expect(url).toContain('/users/123');
    expect(url).not.toContain('{user}');
  });

  it('multiple missing required params all reported in single error', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'multi': { name: 'multi', uri: 'a/{x}/b/{y}', methods: ['GET'], parameters: ['x', 'y'] },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');
    try {
      forge.route('public', 'multi');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(MissingRouteParamError);
      const msg = (e as Error).message;
      expect(msg).toContain('x');
      expect(msg).toContain('y');
    }
  });

  it('required param with default value uses default when not provided', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'posts.index': {
            name: 'posts.index',
            uri: 'posts/{page}',
            methods: ['GET'],
            parameters: ['page'],
            parameter_defaults: { page: 1 },
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');
    // 必填参数 page 未传，但有默认值 1 → 不抛，使用默认值
    const url = forge.route('public', 'posts.index');
    expect(url).toContain('/posts/1');
  });

  it('explicit param value overrides default', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'posts.index': {
            name: 'posts.index',
            uri: 'posts/{page}',
            methods: ['GET'],
            parameters: ['page'],
            parameter_defaults: { page: 1 },
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');
    // 显式传 page=3 → 使用 3 而非默认值 1
    const url = forge.route('public', 'posts.index', { page: 3 });
    expect(url).toContain('/posts/3');
  });

  it('mixed params: default fills missing, still throws for param without default', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'multi': {
            name: 'multi',
            uri: 'a/{x}/b/{y}',
            methods: ['GET'],
            parameters: ['x', 'y'],
            parameter_defaults: { x: 'hello' },
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');
    // x 有默认值，y 没有 → 缺失 y 应抛 MissingRouteParamError
    try {
      forge.route('public', 'multi');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(MissingRouteParamError);
      const msg = (e as Error).message;
      expect(msg).toContain('y');
      expect(msg).not.toContain('x');
    }
  });
});

describe('unknown route always throws', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('route() throws UnknownRouteError when route not found (strict=false)', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: false,
        endpoint_prefix: '/_forge/routes',
      },
    });
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      strict: false,
    });
    await forge.load('public');
    expect(() => forge.route('public', 'nonexistent.route')).toThrow(UnknownRouteError);
  });

  it('api() throws UnknownRouteError when route not found (strict=false)', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: false,
        endpoint_prefix: '/_forge/routes',
      },
    });
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      strict: false,
    });
    await forge.load('public');
    await expect(forge.api('public', 'nonexistent.route')).rejects.toThrow(UnknownRouteError);
  });

  it('route() throws UnknownRouteError when route not found (strict=true)', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: true,
        endpoint_prefix: '/_forge/routes',
      },
    });
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      strict: true,
    });
    await forge.load('public');
    expect(() => forge.route('public', 'nonexistent.route')).toThrow(UnknownRouteError);
  });

  it('api() throws UnknownRouteError when route not found (strict=true)', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: true,
        endpoint_prefix: '/_forge/routes',
      },
    });
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      strict: true,
    });
    await forge.load('public');
    await expect(forge.api('public', 'nonexistent.route')).rejects.toThrow(UnknownRouteError);
  });
});

describe('createRouteForge auto-discovery', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('auto-discovers levels from summary endpoint', async () => {
    mockSummary(makeSummary());
    const forge = createRouteForge({ endpoint: '/_forge/routes', adapter: 'builtin' });
    // 等待自动发现完成
    await new Promise((r) => setTimeout(r, 0));
    // forge.load('nonexistent') 应抛 UnknownLevelError（不在自动发现的 levels 中）
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(forge.load('nonexistent')).rejects.toThrow();
    warn.mockRestore();
  });

  it('auto-discovers eager from load field', async () => {
    const calls = mockSummary(makeSummary()); // admin 是 eager
    createRouteForge({ endpoint: '/_forge/routes', adapter: 'builtin' });
    await new Promise((r) => setTimeout(r, 50));
    // admin 是 eager，应触发 forge.load('admin') → fetch /_forge/routes/admin
    const adminCalls = calls.filter((c) => c.url.includes('/admin'));
    expect(adminCalls.length).toBeGreaterThan(0);
  });

  it('intersects explicit levels with backend', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary()); // backend has public, admin
    createRouteForge({ endpoint: '/_forge/routes', levels: ['admin', 'foo'], adapter: 'builtin' });
    await new Promise((r) => setTimeout(r, 10));
    // foo 应被剔除并告警
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('foo'));
    warn.mockRestore();
  });

  it('strict option deprecated: not consumed regardless of backend strict_mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary({ config: { strict_mode: true, endpoint_prefix: '/_forge/routes' } }));
    createRouteForge({
      endpoint: '/_forge/routes',
      strict: false,
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));
    // strict 选项已废弃（前端校验始终开启）：后端 strict_mode=true 不再触发前端告警/行为变化
    const strictWarns = warn.mock.calls.filter((c) => String(c[0]).includes('strict'));
    expect(strictWarns.length).toBe(0);
    warn.mockRestore();
  });

  it('strict option deprecated: frontend strict=true also has no effect', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary({ config: { strict_mode: false, endpoint_prefix: '/_forge/routes' } }));
    createRouteForge({ endpoint: '/_forge/routes', strict: true, adapter: 'builtin' });
    await new Promise((r) => setTimeout(r, 10));
    // 前端 strict=true：无任何 strict 相关告警或行为变化
    const strictWarns = warn.mock.calls.filter((c) => String(c[0]).includes('strict'));
    expect(strictWarns.length).toBe(0);
    warn.mockRestore();
  });

  it('endpoint conflict uses backend value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary({ config: { strict_mode: false, endpoint_prefix: '/_forge/routes' } }));
    createRouteForge({ endpoint: '/api/routes', adapter: 'builtin' });
    await new Promise((r) => setTimeout(r, 10));
    // 应告警 endpoint 不一致
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('endpoint_prefix'));
    warn.mockRestore();
  });

  it('summary fetch failure falls back to explicit levels', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(null, 500); // summary endpoint returns 500
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));
    // 应告警 summary 不可达
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
    warn.mockRestore();
  });

  it('summary fetch failure without explicit levels throws', async () => {
    mockSummary(null, 500); // summary endpoint returns 500
    // createRouteForge 不传 levels：同步返回不抛
    expect(() => createRouteForge({ endpoint: '/_forge/routes', adapter: 'builtin' })).not.toThrow();
    // 异步等待应 reject
    const forge = createRouteForge({ endpoint: '/_forge/routes', adapter: 'builtin' });
    await expect(forge.load('public')).rejects.toThrow();
  });

  it('summary request times out: ready() rejects without explicit levels, degrades with them', async () => {
    // 摘要端点挂起不响应：timeout 生效（此前裸 fetch 无 timeout 会永久挂起）
    const summaryUrl = '/_forge/routes';
    (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === summaryUrl) {
        // 等待远超 timeout（timeout: 50ms）→ 触发 AbortSignal.timeout
        await new Promise((r) => setTimeout(r, 500));
        return {} as any;
      }
      throw new Error('unexpected fetch: ' + url);
    });

    // 无显式 levels → ready() reject（不再永久挂起）
    const forge1 = createRouteForge({ endpoint: summaryUrl, adapter: 'builtin', timeout: 50 });
    await expect(forge1.ready()).rejects.toThrow();

    // 有显式 levels → warn 降级，levels 可用
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forge2 = createRouteForge({
      endpoint: summaryUrl,
      levels: ['public'],
      adapter: 'builtin',
      timeout: 50,
    });
    await expect(forge2.ready()).resolves.toBe(forge2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
    warn.mockRestore();
  });

  it('writes timeout option to RequestConfig', async () => {
    // URL-aware mock：区分摘要端点与 level 拉取请求
    const calls: { url: string; init?: RequestInit }[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/_forge/routes')) {
        const summary = makeSummary();
        return {
          ok: true,
          status: 200,
          json: async () => summary,
          text: async () => JSON.stringify(summary),
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      // level fetch：返回 LevelRoutesResponse
      const levelBody = { level: 'public', routes: {} };
      return {
        ok: true,
        status: 200,
        json: async () => levelBody,
        text: async () => JSON.stringify(levelBody),
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    });

    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      adapter: 'builtin',
      timeout: 5000,
      levels: ['public'],
    });
    await new Promise((r) => setTimeout(r, 10));

    await forge.load('public');

    // timeout > 0 时 builtin adapter 通过 AbortSignal.timeout(ms) 创建 signal 并赋给 fetch 的 init.signal
    const levelCall = calls.find((c) => c.url.includes('/public'));
    expect(levelCall).toBeDefined();
    expect(levelCall!.init?.signal).toBeDefined();
  });
});

describe('url_prefix from backend summary', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('generated URL includes url_prefix from summary response', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: false,
        endpoint_prefix: '/_forge/routes',
        url_prefix: '/api/v1',
      },
    });
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));
    await forge.load('public');
    const url = forge.route('public', 'user.show', { user: 123 });
    expect(url).toBe('/api/v1/users/123');
  });

  it('url_prefix with trailing slash is normalized', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: false,
        endpoint_prefix: '/_forge/routes',
        url_prefix: '/api/v1/',
      },
    });
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'posts.index': {
            name: 'posts.index',
            uri: 'posts',
            methods: ['GET'],
            parameters: [],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));
    await forge.load('public');
    const url = forge.route('public', 'posts.index');
    expect(url).toBe('/api/v1/posts');
    expect(url).not.toContain('//');
  });

  it('no url_prefix in summary keeps existing behavior', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: false,
        endpoint_prefix: '/_forge/routes',
      },
    });
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));
    await forge.load('public');
    const url = forge.route('public', 'user.show', { user: 42 });
    expect(url).toBe('/users/42');
  });

  it('url_prefix works with baseURL', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: false,
        endpoint_prefix: '/_forge/routes',
        url_prefix: '/app',
      },
    });
    // 自定义 mock：baseURL 会导致完整 URL，需按 pathname 匹配
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      const pathname = url.replace(/^https?:\/\/[^/]+/, '');
      if (pathname === '/_forge/routes') {
        const body = JSON.stringify(summary);
        return {
          ok: true,
          status: 200,
          json: async () => summary,
          text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      if (pathname.startsWith('/_forge/routes/')) {
        const levelBody = {
          level: 'public',
          routes: { 'home': { name: 'home', uri: '/', methods: ['GET'], parameters: [] } },
        };
        const body = JSON.stringify(levelBody);
        return {
          ok: true,
          status: 200,
          json: async () => levelBody,
          text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
        headers: new Headers(),
      } as any;
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      baseURL: 'https://example.com',
    });
    await new Promise((r) => setTimeout(r, 10));
    await forge.load('public');
    const url = forge.route('public', 'home');
    expect(url).toBe('https://example.com/app/');
  });

  it('url_prefix with protocol and domain overrides baseURL', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: false,
        endpoint_prefix: '/_forge/routes',
        url_prefix: 'https://api.example.com',
      },
    });
    // 自定义 mock：baseURL 会导致完整 URL，需按 pathname 匹配
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      const pathname = url.replace(/^https?:\/\/[^/]+/, '');
      if (pathname === '/_forge/routes') {
        const body = JSON.stringify(summary);
        return {
          ok: true,
          status: 200,
          json: async () => summary,
          text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      if (pathname.startsWith('/_forge/routes/')) {
        const levelBody = {
          level: 'public',
          routes: {
            'user.show': {
              name: 'user.show',
              uri: 'users/{user}',
              methods: ['GET'],
              parameters: ['user'],
            },
          },
        };
        const body = JSON.stringify(levelBody);
        return {
          ok: true,
          status: 200,
          json: async () => levelBody,
          text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
        headers: new Headers(),
      } as any;
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      baseURL: 'https://frontend.example.com',
    });
    await new Promise((r) => setTimeout(r, 10));
    await forge.load('public');
    const url = forge.route('public', 'user.show', { user: 123 });
    // url_prefix 含协议时应完全覆盖 baseURL，不拼接前端域名
    expect(url).toBe('https://api.example.com/users/123');
  });

  it('url_prefix with protocol, path and trailing slash is normalized', async () => {
    const summary = makeSummary({
      config: {
        strict_mode: false,
        endpoint_prefix: '/_forge/routes',
        url_prefix: 'https://api.example.com/v1/',
      },
    });
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      const pathname = url.replace(/^https?:\/\/[^/]+/, '');
      if (pathname === '/_forge/routes') {
        const body = JSON.stringify(summary);
        return {
          ok: true, status: 200,
          json: async () => summary, text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      if (pathname.startsWith('/_forge/routes/')) {
        const levelBody = {
          level: 'public',
          routes: {
            'posts.index': {
              name: 'posts.index',
              uri: 'posts',
              methods: ['GET'],
              parameters: [],
            },
          },
        };
        const body = JSON.stringify(levelBody);
        return {
          ok: true, status: 200,
          json: async () => levelBody, text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
        headers: new Headers(),
      } as any;
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));
    await forge.load('public');
    const url = forge.route('public', 'posts.index');
    expect(url).toBe('https://api.example.com/v1/posts');
    expect(url).not.toContain('//posts');
  });
});

describe('hasRoute', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const summary = makeSummary({
    config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
  });

  it('returns true for existing route after load', async () => {
    mockFull(summary, {
      admin: {
        level: 'admin',
        routes: {
          'users.show': {
            name: 'users.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
          'users.index': {
            name: 'users.index',
            uri: 'users',
            methods: ['GET'],
            parameters: [],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['admin'],
      adapter: 'builtin',
    });
    await forge.load('admin');
    expect(forge.hasRoute('admin', 'users.show')).toBe(true);
    expect(forge.hasRoute('admin', 'users.index')).toBe(true);
  });

  it('returns false for non-existing route', async () => {
    mockFull(summary, {
      admin: {
        level: 'admin',
        routes: {
          'users.show': {
            name: 'users.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['admin'],
      adapter: 'builtin',
    });
    await forge.load('admin');
    expect(forge.hasRoute('admin', 'users.destroy')).toBe(false);
  });

  it('returns false when level not loaded', async () => {
    mockFull(summary, {
      admin: {
        level: 'admin',
        routes: {
          'users.show': {
            name: 'users.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['admin'],
      adapter: 'builtin',
    });
    // 未 load('admin')，缓存为空
    expect(forge.hasRoute('admin', 'users.show')).toBe(false);
  });
});

describe('api() smart param resolution', () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedConfig: import('../src/types.js').RequestConfig | null;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedConfig = null;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const summary = makeSummary({
    config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
  });

  /** 创建 forge 并注册请求拦截器以捕获最终 config */
  async function createForgeWithCapture(routes: Record<string, any>) {
    mockFull(summary, {
      public: {
        level: 'public',
        routes,
      },
    });
    // 覆写 fetch：对非路由加载请求返回 200（避免 api() 调用时得到 404）
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const res = await (origFetch as any)(url, init);
      // 路由加载端点已由 mockFull 处理；其他 URL（api 调用）返回 200
      if (res.status === 404 && !url.startsWith('/_forge/routes')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => JSON.stringify({ success: true }),
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      return res;
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    forge.interceptors.request.use((c) => {
      capturedConfig = { ...c };
      return c;
    });
    await forge.load('public');
    return forge;
  }

  it('backward compat: flat path params + query object + body object', async () => {
    const forge = await createForgeWithCapture({
      'users.update': {
        name: 'users.update',
        uri: 'users/{user}',
        methods: ['PUT'],
        parameters: ['user'],
      },
    });
    await forge.api('public', 'users.update', {
      user: 42,
      query: { include: 'posts' },
      body: { name: 'Alice' },
    });
    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.url).toContain('/users/42');
    expect(capturedConfig!.url).toContain('include=posts');
    expect(capturedConfig!.body).toEqual({ name: 'Alice' });
  });

  it('conflict: query as string → treated as path param', async () => {
    const forge = await createForgeWithCapture({
      'search.show': {
        name: 'search.show',
        uri: 'search/{query}',
        methods: ['GET'],
        parameters: ['query'],
      },
    });
    await forge.api('public', 'search.show', { query: 'keyword' });
    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.url).toContain('/search/keyword');
    expect(capturedConfig!.url).not.toContain('?');
  });

  it('conflict: query as object → treated as query string, path param missing → throws', async () => {
    const forge = await createForgeWithCapture({
      'search.show': {
        name: 'search.show',
        uri: 'search/{query}',
        methods: ['GET'],
        parameters: ['query'],
      },
    });
    await expect(
      forge.api('public', 'search.show', { query: { keyword: 'test' } }),
    ).rejects.toThrow(MissingRouteParamError);
  });

  it('params explicit: overrides flat keys for path params', async () => {
    const forge = await createForgeWithCapture({
      'users.show': {
        name: 'users.show',
        uri: 'users/{user}',
        methods: ['GET'],
        parameters: ['user'],
      },
    });
    await forge.api('public', 'users.show', {
      params: { user: 1 },
      user: 2, // 被 params 覆盖
      query: { include: 'posts' },
    });
    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.url).toContain('/users/1');
    expect(capturedConfig!.url).toContain('include=posts');
  });

  it('params + conflict: params provides path param, fixed key keeps original meaning', async () => {
    const forge = await createForgeWithCapture({
      'search.show': {
        name: 'search.show',
        uri: 'search/{query}',
        methods: ['POST'],
        parameters: ['query'],
      },
    });
    await forge.api('public', 'search.show', {
      params: { query: 'keyword' },
      query: { page: 1 },
      body: { detailed: true },
    });
    expect(capturedConfig).not.toBeNull();
    // params.query → 替换 {query}
    expect(capturedConfig!.url).toContain('/search/keyword');
    // query 对象 → query string
    expect(capturedConfig!.url).toContain('page=1');
    // body → 请求体
    expect(capturedConfig!.body).toEqual({ detailed: true });
  });

  it('conflict: body as string → treated as path param', async () => {
    const forge = await createForgeWithCapture({
      'items.create': {
        name: 'items.create',
        uri: 'items/{body}',
        methods: ['GET'],
        parameters: ['body'],
      },
    });
    await forge.api('public', 'items.create', { body: 'special-id' });
    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.url).toContain('/items/special-id');
    expect(capturedConfig!.body).toBeUndefined();
  });

  it('conflict: headers as string → treated as path param', async () => {
    const forge = await createForgeWithCapture({
      'proxy.show': {
        name: 'proxy.show',
        uri: 'proxy/{headers}',
        methods: ['GET'],
        parameters: ['headers'],
      },
    });
    await forge.api('public', 'proxy.show', { headers: 'custom-value' });
    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.url).toContain('/proxy/custom-value');
    // headers 未被设置（仅 Accept 默认）
    expect(capturedConfig!.headers).toEqual({ Accept: 'application/json' });
  });

  it('backward compat: headers as object → treated as request headers', async () => {
    const forge = await createForgeWithCapture({
      'users.show': {
        name: 'users.show',
        uri: 'users/{user}',
        methods: ['GET'],
        parameters: ['user'],
      },
    });
    await forge.api('public', 'users.show', {
      user: 1,
      headers: { 'X-Custom': 'value' },
    });
    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.headers).toEqual({
      Accept: 'application/json',
      'X-Custom': 'value',
    });
  });

  it('params as path param name conflict: params key used for path params', async () => {
    const forge = await createForgeWithCapture({
      'items.show': {
        name: 'items.show',
        uri: 'items/{params}',
        methods: ['GET'],
        parameters: ['params'],
      },
    });
    // params 作为固定 key 是路径参数的显式指定
    // 如果路由有 {params} 路径参数，需要用 params 显式指定
    await forge.api('public', 'items.show', {
      params: { params: 'value1' },
    });
    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig!.url).toContain('/items/value1');
  });

  it('mixed: normal path params + conflict resolution + query/body', async () => {
    const forge = await createForgeWithCapture({
      'complex.show': {
        name: 'complex.show',
        uri: 'complex/{user}/{query}',
        methods: ['POST'],
        parameters: ['user', 'query'],
      },
    });
    await forge.api('public', 'complex.show', {
      user: 42,
      query: 'search-term',
      body: { filter: 'active' },
      headers: { 'X-Token': 'abc' },
    });
    expect(capturedConfig).not.toBeNull();
    // user 和 query 都是 string/number → 路径参数
    expect(capturedConfig!.url).toContain('/complex/42/search-term');
    // body 是对象 → 请求体
    expect(capturedConfig!.body).toEqual({ filter: 'active' });
    // headers 是对象 → 请求头
    expect(capturedConfig!.headers).toEqual({
      Accept: 'application/json',
      'X-Token': 'abc',
    });
  });
});

describe('ForgeRequest abort', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const summary = makeSummary({
    config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
  });

  it('api() returns ForgeRequest with internal AbortSignal passed to fetch', async () => {
    const calls = mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');

    const request = forge.api('public', 'user.show', { user: 1 });
    void request.catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    const apiCall = calls.find((c) => c.url.includes('/users/1'));
    expect(apiCall).toBeDefined();
    // 内部自动创建 AbortSignal 并传给 fetch
    expect(apiCall!.init?.signal).toBeDefined();
    expect(apiCall!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('abort() cancels request and rejects with RequestAbortedError', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');

    const request = forge.api('public', 'user.show', { user: 1 });
    // 立即取消请求
    request.abort();

    await expect(request).rejects.toThrow(RequestAbortedError);
  });

  it('abort() before async setup completes still cancels request', async () => {
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    // 不 await load，让 api() 内部异步加载
    const request = forge.api('public', 'user.show', { user: 1 });
    // 在异步 setup 完成前立即 abort
    request.abort();

    await expect(request).rejects.toThrow(RequestAbortedError);
  });
});

describe('unassigned virtual tier', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('summary with unassigned routes exposes "unassigned" level', async () => {
    const summary = makeSummary({
      config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
      unassigned: [
        {
          name: 'debug.info',
          uri: '_debug/info',
          methods: ['GET', 'HEAD'],
          parameters: [],
        },
      ],
    });
    const calls = mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'unassigned'],  // 显式包含 unassigned
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));

    // load('unassigned') 应成功，且不发 HTTP 请求
    await forge.load('unassigned');
    const unassignedFetch = calls.find((c) => c.url.includes('/unassigned'));
    expect(unassignedFetch).toBeUndefined();

    // getRoutes('unassigned') 应返回摘要中的路由
    const routes = forge.getRoutes('unassigned');
    expect(routes['debug.info']).toBeDefined();
    expect(routes['debug.info']!.uri).toBe('_debug/info');

    // route('unassigned', ...) 应正确生成 URL
    const url = forge.route('unassigned', 'debug.info');
    expect(url).toContain('_debug/info');

    // hasRoute 应返回 true
    expect(forge.hasRoute('unassigned', 'debug.info')).toBe(true);
  });

  it('api("unassigned", ...) calls the correct URL', async () => {
    const summary = makeSummary({
      config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
      unassigned: [
        {
          name: 'debug.info',
          uri: '_debug/info',
          methods: ['GET', 'HEAD'],
          parameters: [],
        },
      ],
    });
    const calls = mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'unassigned'],  // 显式包含 unassigned
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));

    void forge.api('unassigned', 'debug.info').catch(() => {
    });
    await new Promise((r) => setTimeout(r, 10));

    const apiCall = calls.find((c) => c.url.includes('_debug/info'));
    expect(apiCall).toBeDefined();
  });

  it('empty unassigned array does not expose "unassigned" level', async () => {
    const summary = makeSummary({
      config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
      unassigned: [],
    });
    mockFull(summary, {});
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));

    await expect(forge.load('unassigned')).rejects.toThrow(UnknownLevelError);
  });

  it('explicit levels including "unassigned" is preserved', async () => {
    const summary = makeSummary({
      config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
      unassigned: [
        {
          name: 'debug.info',
          uri: '_debug/info',
          methods: ['GET', 'HEAD'],
          parameters: [],
        },
      ],
    });
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'user.show': {
            name: 'user.show',
            uri: 'users/{user}',
            methods: ['GET'],
            parameters: ['user'],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'unassigned'],
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));

    await forge.load('unassigned');
    expect(forge.hasRoute('unassigned', 'debug.info')).toBe(true);
  });
});

// ─── auto-discovery guard + callbacks ─────────────────────────

describe('auto-discovery guard & callbacks', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('route() throws ForgeError RF_FE_010 when discovery not completed and no explicit levels', () => {
    // 使用延迟 fetch 模拟 discovery 未完成
    (globalThis as any).fetch = vi.fn(() => new Promise(() => {
    })); // never resolves
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      adapter: 'builtin',
    });
    expect(() => forge.route('public', 'users.index')).toThrow(ForgeError);
    try {
      forge.route('public', 'users.index');
    } catch (e) {
      expect((e as ForgeError).code).toBe('RF_FE_010');
    }
  });

  it('hasRoute() throws ForgeError RF_FE_010 when discovery not completed and no explicit levels', () => {
    (globalThis as any).fetch = vi.fn(() => new Promise(() => {
    }));
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      adapter: 'builtin',
    });
    expect(() => forge.hasRoute('public', 'users.index')).toThrow(ForgeError);
    try {
      forge.hasRoute('public', 'users.index');
    } catch (e) {
      expect((e as ForgeError).code).toBe('RF_FE_010');
    }
  });

  it('route() works with explicit levels even before discovery completes', async () => {
    const summary: SummaryResponse = {
      levels: {
        public: { description: 'public', load: 'lazy', cache: 300, route_count: 1 },
      },
      config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
      unassigned: [],
    };
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'users.index': {
            name: 'users.index',
            uri: 'users',
            methods: ['GET'],
            parameters: [],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    // 显式加载 public 层级
    await forge.load('public');
    // 有 explicit levels，守卫不触发，route() 可用
    expect(forge.route('public', 'users.index')).toBe('/users');
  });

  it('api() is not affected by discovery guard', async () => {
    const summary: SummaryResponse = {
      levels: {
        public: { description: 'public', load: 'lazy', cache: 300, route_count: 1 },
      },
      config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
      unassigned: [],
    };
    // 使用 mockFull 提供路由元数据，同时处理业务请求
    const calls = mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'users.index': {
            name: 'users.index',
            uri: 'users',
            methods: ['GET'],
            parameters: [],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      adapter: 'builtin',
    });
    // 先加载 level
    await forge.load('public');
    // api() 内部会 await discovery，不受守卫影响
    // 业务请求 /users 会被 mockFull 返回 404（因为它只处理摘要和层级拉取）
    // 这里只验证 api() 能正常执行到发起请求阶段（不因守卫而阻塞）
    try {
      await forge.api('public', 'users.index');
    } catch (e) {
      // HTTP 404 说明请求确实发出了（路由解析成功），只是 mock 没有对应的业务响应
      expect((e as any).code).toBe('RF_FE_008'); // HTTPError
    }
  });

  it('forge.ready() resolves after discovery + eager load completes', async () => {
    const summary = makeSummary();
    mockFull(summary, {
      admin: {
        level: 'admin',
        routes: {
          'dashboard': {
            name: 'dashboard',
            uri: 'dashboard',
            methods: ['GET'],
            parameters: [],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['admin'],
      adapter: 'builtin',
    });
    await forge.ready();
    // eager load 完成后 route() 应该可用
    expect(forge.route('admin', 'dashboard')).toBe('/dashboard');
  });

  it('BoundForge.onLevelLoaded() resolves after level load', async () => {
    const summary = makeSummary();
    mockFull(summary, {
      public: {
        level: 'public',
        routes: {
          'users.index': {
            name: 'users.index',
            uri: 'users',
            methods: ['GET'],
            parameters: [],
          },
        },
      },
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      adapter: 'builtin',
    });
    const bound = forge.use('public');
    // onLevelLoaded() 无参返回 Promise<BoundForge>
    const loaded = await bound.onLevelLoaded();
    expect(loaded).toBe(bound);
    expect(loaded.route('users.index')).toBe('/users');
    // onLevelLoaded() 有参回调
    let callbackFired = false;
    forge.invalidate('public');
    const bound2 = forge.use('public');
    await bound2.onLevelLoaded((b) => {
      callbackFired = true;
      expect(b).toBe(bound2);
    });
    expect(callbackFired).toBe(true);
  });
});
