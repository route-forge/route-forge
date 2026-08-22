import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteForge, MissingRouteParamError } from '../src/index.js';
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
        headers: new Headers(),
      } as any;
    }
    const body = summary === null ? '{}' : JSON.stringify(summary);
    return {
      ok: true,
      status: 200,
      json: async () => summary,
      text: async () => body,
      headers: new Headers(),
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
      const level = url.slice(ep.length + 1).split('/')[0].split('?')[0];
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

  it('strict_mode backend authoritative cannot relax', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary({ config: { strict_mode: true, endpoint_prefix: '/_forge/routes' } }));
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      strict: false,
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));
    // 告警 strict 被强制为 true
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('strict_mode=true'));
    warn.mockRestore();
  });

  it('strict_mode frontend can tighten', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary({ config: { strict_mode: false, endpoint_prefix: '/_forge/routes' } }));
    createRouteForge({ endpoint: '/_forge/routes', strict: true, adapter: 'builtin' });
    await new Promise((r) => setTimeout(r, 10));
    // 后端 false 前端 true：合法收紧，不告警
    const strictWarns = warn.mock.calls.filter((c) => c[0].includes('strict'));
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
          headers: new Headers(),
        } as any;
      }
      // level fetch：返回 LevelRoutesResponse
      const levelBody = { level: 'public', routes: {} };
      return {
        ok: true,
        status: 200,
        json: async () => levelBody,
        text: async () => JSON.stringify(levelBody),
        headers: new Headers(),
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
