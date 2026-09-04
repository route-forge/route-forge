import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteForge, HTTPError, NetworkError, RequestAbortedError } from '../src/index.js';
import type { LevelRoutesResponse, ResponseData, SummaryResponse } from '../src/types.js';
import { makeSummary as normalizeSummary } from './fixtures.js';

// ─── mock helpers ───────────────────────────────────────────

function makeSummary(): SummaryResponse {
  return normalizeSummary({
    levels: { public: { description: 'public', load: 'lazy', route_count: 1 } },
  });
}

interface MockOpts {
  /** 业务 api 请求的响应状态码 */
  apiStatus?: number;
  /** 业务 api 请求的响应体 */
  apiBody?: unknown;
  /** 业务请求直接抛错（模拟网络层失败） */
  apiNetworkError?: Error;
}

function mockBackend(opts: MockOpts = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const summary = makeSummary();
  const level: LevelRoutesResponse = {
    level: 'public',
    routes: {
      'users.index': { name: 'users.index', uri: 'users', methods: ['GET'], parameters: [] },
      'users.update': {
        name: 'users.update',
        uri: 'users/{user}',
        methods: ['PUT'],
        parameters: ['user'],
      },
      'users.upload': {
        name: 'users.upload',
        uri: 'users/upload',
        methods: ['POST'],
        parameters: [],
      },
    },
  };
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const ep = summary.config.endpoint_prefix;
    if (url === ep) return jsonResponse(summary);
    if (url.startsWith(ep + '/')) {
      const lvl = url.slice(ep.length + 1).split('/')[0]!;
      return lvl === 'public' ? jsonResponse(level) : jsonResponse({}, 404);
    }
    // 业务请求
    if (opts.apiNetworkError) throw opts.apiNetworkError;
    return jsonResponse(opts.apiBody ?? { success: true }, opts.apiStatus ?? 200);
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

async function createLoadedForge(opts: MockOpts = {}) {
  const calls = mockBackend(opts);
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

describe('HTTP error semantics (builtin adapter)', () => {
  it('non-2xx rejects with HTTPError carrying status/route/code', async () => {
    const { forge } = await createLoadedForge({ apiStatus: 500 });
    try {
      await forge.api('public', 'users.index');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HTTPError);
      const err = e as HTTPError;
      expect(err.code).toBe('RF_FE_008');
      expect(err.route).toBe('users.index');
      expect(err.context?.status).toBe(500);
    }
  });

  it('HTTP non-2xx enters response interceptor onRejected chain (SPEC §4.1.3a)', async () => {
    const { forge } = await createLoadedForge({ apiStatus: 404 });
    const seen: unknown[] = [];
    forge.interceptors.response.use(undefined, (e) => {
      seen.push(e);
      return { recovered: true };
    });
    const result = await forge.api('public', 'users.index');
    // onRejected 收到的是 HTTPError 实例，且恢复值成为 api() 的 resolve 值
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeInstanceOf(HTTPError);
    expect(result).toEqual({ recovered: true });
  });

  it('response onFulfilled only receives 2xx responses', async () => {
    const { forge } = await createLoadedForge({ apiStatus: 404 });
    const fulfilled: unknown[] = [];
    forge.interceptors.response.use((r) => {
      fulfilled.push(r);
      return r;
    });
    await expect(forge.api('public', 'users.index')).rejects.toThrow(HTTPError);
    expect(fulfilled.length).toBe(0);
  });

  it('response chain resumes after onRejected recovery: later onFulfilled gets recovered value', async () => {
    const { forge } = await createLoadedForge({ apiStatus: 503 });
    const seen: string[] = [];
    forge.interceptors.response.use(undefined, () => {
      seen.push('recover');
      return { fallback: true };
    });
    forge.interceptors.response.use((v) => {
      seen.push('after:' + JSON.stringify(v));
      return v;
    });
    const result = await forge.api('public', 'users.index');
    expect(seen).toEqual(['recover', 'after:{"fallback":true}']);
    expect(result).toEqual({ fallback: true });
  });

  it('fetch-level failure rejects with NetworkError carrying cause', async () => {
    const boom = new TypeError('fetch failed');
    const { forge } = await createLoadedForge({ apiNetworkError: boom });
    try {
      await forge.api('public', 'users.index');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NetworkError);
      const err = e as NetworkError;
      expect(err.code).toBe('RF_FE_007');
      expect(err.route).toBe('users.index');
      expect(err.cause).toBe(boom);
    }
  });
});

describe('request/response interceptor integration', () => {
  it('request interceptor mutations reach the actual fetch call', async () => {
    const { forge, calls } = await createLoadedForge();
    forge.interceptors.request.use((c) => {
      c.headers['X-Trace'] = 'abc';
      c.url = c.url + '?injected=1';
      return c;
    });
    await forge.api('public', 'users.index');
    const bizCall = calls.find((c) => c.url.startsWith('/users'));
    expect(bizCall).toBeDefined();
    expect(bizCall!.url).toBe('/users?injected=1');
    const sentHeaders = bizCall!.init!.headers as Headers;
    expect(sentHeaders.get('X-Trace')).toBe('abc');
  });

  it('unrecovered request interceptor error aborts before business fetch', async () => {
    const { forge, calls } = await createLoadedForge();
    const before = calls.filter((c) => c.url.startsWith('/users')).length;
    forge.interceptors.request.use(() => {
      throw new Error('blocked by interceptor');
    });
    await expect(forge.api('public', 'users.index')).rejects.toThrow('blocked by interceptor');
    const after = calls.filter((c) => c.url.startsWith('/users')).length;
    // 业务请求未发出
    expect(after).toBe(before);
  });

  it('request interceptor onRejected can recover and continue', async () => {
    const { forge } = await createLoadedForge();
    // 先注册恢复器（LIFO 下后执行），再注册抛错器（LIFO 下先执行）
    const base = {
      route: 'users.index',
      level: 'public',
      method: 'GET',
      url: '/users',
      headers: { Accept: 'application/json' },
      params: {},
      meta: { name: 'users.index', uri: 'users', methods: ['GET'], parameters: [] },
    };
    forge.interceptors.request.use(undefined, () => base);
    forge.interceptors.request.use(() => {
      throw new Error('boom');
    });
    const result = (await forge.api('public', 'users.index')) as any;
    // 恢复后的配置正常发出请求，api() resolve 完整 ResponseData（data 为业务响应体）
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ success: true });
  });

  it('response interceptor transforms resolved value of api()', async () => {
    const { forge } = await createLoadedForge({ apiBody: { data: { list: [1, 2, 3] } } });
    forge.interceptors.response.use((r: ResponseData) => (r.data as any).data.list);
    const result = await forge.api('public', 'users.index');
    expect(result).toEqual([1, 2, 3]);
  });

  it('ejected interceptor no longer runs', async () => {
    const { forge } = await createLoadedForge();
    let count = 0;
    const id = forge.interceptors.response.use((r) => {
      count++;
      return r;
    });
    forge.interceptors.response.eject(id);
    await forge.api('public', 'users.index');
    expect(count).toBe(0);
  });

  it('declarative interceptor resolves for each accepted form (fn / tuple / object)', async () => {
    // 函数形式：整个作为 resolve
    {
      mockBackend({});
      let hit = false;
      const forge = createRouteForge({
        endpoint: '/_forge/routes',
        levels: ['public'],
        adapter: 'builtin',
        interceptors: {
          response: (r) => {
            hit = (r as ResponseData).route === 'users.index';
            return r;
          },
        },
      });
      await forge.load('public');
      await forge.api('public', 'users.index');
      expect(hit).toBe(true);
    }
    // 元组形式 [resolve, reject]：成功只走 resolve，不走 reject
    {
      mockBackend({});
      const seen: string[] = [];
      const forge = createRouteForge({
        endpoint: '/_forge/routes',
        levels: ['public'],
        adapter: 'builtin',
        interceptors: {
          response: [
            (r) => {
              seen.push('resolve');
              return r;
            },
            () => {
              seen.push('reject');
            },
          ],
        },
      });
      await forge.load('public');
      await forge.api('public', 'users.index');
      expect(seen).toEqual(['resolve']);
    }
    // 对象形式 { resolve, reject }
    {
      mockBackend({});
      const seen: string[] = [];
      const forge = createRouteForge({
        endpoint: '/_forge/routes',
        levels: ['public'],
        adapter: 'builtin',
        interceptors: {
          response: {
            resolve: (r) => {
              seen.push('resolve');
              return r;
            },
            reject: () => {
              seen.push('reject');
            },
          },
        },
      });
      await forge.load('public');
      await forge.api('public', 'users.index');
      expect(seen).toEqual(['resolve']);
    }
  });

  it('declarative [resolve, reject] tuple routes non-2xx to reject only', async () => {
    // 复现用户报的坑：[resolve, reject] 在成功时误跑 reject —— 修复后成功走 resolve、失败才走 reject
    mockBackend({ apiStatus: 500 });
    const seen: string[] = [];
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      interceptors: {
        response: [
          (r) => {
            seen.push('resolve');
            return r;
          },
          (e) => {
            seen.push('reject');
            throw e;
          },
        ],
      },
    });
    await forge.load('public');
    await expect(forge.api('public', 'users.index')).rejects.toBeInstanceOf(HTTPError);
    expect(seen).toEqual(['reject']);
  });
});

describe('request body serialization (builtin adapter)', () => {
  it('object body is JSON-stringified with auto Content-Type', async () => {
    const { forge, calls } = await createLoadedForge();
    await forge.api('public', 'users.update', { user: 1, body: { name: 'Alice' } });
    const bizCall = calls.find((c) => c.url.startsWith('/users/'));
    expect(bizCall!.init!.method).toBe('PUT');
    expect(bizCall!.init!.body).toBe(JSON.stringify({ name: 'Alice' }));
    const headers = bizCall!.init!.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('explicit Content-Type header is preserved (not overwritten)', async () => {
    const { forge, calls } = await createLoadedForge();
    await forge.api('public', 'users.update', {
      user: 1,
      body: { a: 1 },
      headers: { 'Content-Type': 'application/vnd.custom+json' },
    });
    const bizCall = calls.find((c) => c.url.startsWith('/users/'));
    const headers = bizCall!.init!.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/vnd.custom+json');
  });

  it('GET requests never carry a body', async () => {
    const { forge, calls } = await createLoadedForge();
    // body 对象在 GET 路由上被忽略（不发送请求体）
    await forge.api('public', 'users.index', { body: { ignored: true } });
    const bizCall = calls.find((c) => c.url.startsWith('/users'));
    expect(bizCall!.init!.body).toBeUndefined();
  });

  it('FormData body is passed through without JSON serialization', async () => {
    const { forge, calls } = await createLoadedForge();
    const fd = new FormData();
    fd.append('file', 'content');
    await forge.api('public', 'users.upload', { body: fd });
    const bizCall = calls.find((c) => c.url.startsWith('/users/upload'));
    expect(bizCall!.init!.body).toBe(fd);
    // FormData 交由 fetch 自行设置 multipart boundary，不应强加 JSON Content-Type
    const headers = bizCall!.init!.headers as Headers;
    expect(headers.get('Content-Type')).toBeNull();
  });

  it('string body is sent as-is', async () => {
    const { forge, calls } = await createLoadedForge();
    // string body 走智能消解是路径参数；此处通过拦截器直接注入 body 验证透传
    forge.interceptors.request.use((c) => {
      if (c.route === 'users.upload') {
        c.method = 'POST';
        c.body = 'raw-text-payload';
      }
      return c;
    });
    await forge.api('public', 'users.upload');
    const bizCall = calls.find((c) => c.url.startsWith('/users/upload'));
    expect(bizCall!.init!.body).toBe('raw-text-payload');
  });
});

// ─── 拦截器对 config.signal 的操作（审计项 L4） ─────────────

describe('interceptor signal manipulation (L4)', () => {
  it('aborted signal replacement short-circuits before adapter dispatch', async () => {
    // 用自定义 Fetcher 精确观测分发边界：
    // forge 在拦截链之后、adapter 调用之前检查 signal，业务请求不应到达 fetcher
    const seen: string[] = [];
    const fetcher = {
      async request(config: any) {
        seen.push(config.url);
        // 摘要端点（重构后摘要拉取也走 adapter 通道）
        if (config.url === '/_forge/routes') {
          return {
            route: config.route, level: config.level, method: 'GET', url: config.url,
            status: 200, headers: new Headers(), data: makeSummary(), config,
          };
        }
        if (config.url.includes('/_forge/routes/public')) {
          return {
            route: config.route, level: config.level, method: 'GET', url: config.url,
            status: 200, headers: new Headers(),
            data: {
              level: 'public',
              routes: {
                'users.index': { name: 'users.index', uri: 'users', methods: ['GET'], parameters: [] },
              },
            },
            config,
          };
        }
        return {
          route: config.route, level: config.level, method: config.method, url: config.url,
          status: 200, headers: new Headers(), data: { ok: true }, config,
        };
      },
    };
    mockBackend(); // 摘要端点仍走 fetch
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: fetcher,
    });
    const ctrl = new AbortController();
    ctrl.abort();
    forge.interceptors.request.use((c) => ({ ...c, signal: ctrl.signal }));
    await expect(forge.api('public', 'users.index')).rejects.toBeInstanceOf(RequestAbortedError);
    // fetcher 见过摘要拉取与层级拉取，未见过业务请求（链后短路生效）
    expect(seen).toEqual(['/_forge/routes', '/_forge/routes/public']);
  });

  it('request interceptor can remove config.signal without breaking the request', async () => {
    const { forge } = await createLoadedForge();
    forge.interceptors.request.use((c) => ({ ...c, signal: undefined }));
    const result = (await forge.api('public', 'users.index')) as any;
    expect(result.status).toBe(200);
  });
});

// ─── 声明式 + 运行时拦截器统一排序（审计项 L7） ─────────────

describe('declarative + runtime interceptor unified order (L7)', () => {
  it('request chain is LIFO across declarative and runtime registrations', async () => {
    mockBackend();
    const order: string[] = [];
    const tag =
      (label: string) =>
      (c: { route?: string }) => {
        if (c.route === 'users.index') order.push(label);
        return c as never;
      };
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      // 声明式只注册一个拦截器（函数形式）
      interceptors: {
        request: tag('decl'),
      },
    });
    // 运行时可多次追加，与声明式统一按注册时间排序
    forge.interceptors.request.use(tag('runtime-1'));
    forge.interceptors.request.use(tag('runtime-2'));
    await forge.load('public');
    await forge.api('public', 'users.index');
    // LIFO（对齐 axios）：后注册先执行 → runtime-2 → runtime-1 → decl
    expect(order).toEqual(['runtime-2', 'runtime-1', 'decl']);
  });

  it('response chain is FIFO across declarative and runtime registrations', async () => {
    mockBackend();
    const order: string[] = [];
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      interceptors: {
        response: [
          (r) => { order.push('decl-1'); return r; },
        ],
      },
    });
    forge.interceptors.response.use((r) => { order.push('runtime-2'); return r; });
    await forge.load('public');
    await forge.api('public', 'users.index');
    // FIFO（对齐 axios）：decl-1 → runtime-2
    expect(order).toEqual(['decl-1', 'runtime-2']);
  });
});
