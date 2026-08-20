import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBuiltinHttp } from '../src/adapters/builtin-http.js';
import { createInterceptorManager } from '../src/interceptors.js';
import type { RequestConfig, ResponseData } from '../src/types.js';

function makeConfig(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return {
    route: 'test.show',
    level: 'admin',
    method: 'GET',
    url: '/admin/test',
    headers: {},
    params: {},
    meta: { name: 'test.show', uri: 'admin/test', methods: ['GET'], parameters: [] },
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(
  opts: {
    status?: number;
    body?: string;
    contentType?: string;
    captureSignal?: boolean;
  } = {},
): FetchCall[] {
  const calls: FetchCall[] = [];
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });

    // 当需要捕获 signal 时（timeout 测试用），实现 abort 即 reject 的语义
    if (opts.captureSignal) {
      const sig = init?.signal as AbortSignal | undefined;
      if (sig) {
        if (sig.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        return new Promise((_, reject) => {
          sig.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
    }

    const status = opts.status ?? 200;
    const body = opts.body ?? '';
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      headers: new Headers(
        opts.contentType ? { 'content-type': opts.contentType } : {},
      ),
    } as any;
  });
  return calls;
}

describe('createBuiltinHttp', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // SubTask 9.1
  it('test_get_convenience_method_calls_request_with_GET', async () => {
    const calls = mockFetch();
    const adapter = createBuiltinHttp();
    await adapter.get('/foo');
    expect(calls.length).toBe(1);
    expect(calls[0]!.init?.method).toBe('GET');
  });

  // SubTask 9.2
  it('test_post_convenience_method_calls_request_with_POST', async () => {
    const calls = mockFetch();
    const adapter = createBuiltinHttp();
    await adapter.post('/foo');
    expect(calls.length).toBe(1);
    expect(calls[0]!.init?.method).toBe('POST');
  });

  // SubTask 9.3
  it('test_put_convenience_method_calls_request_with_PUT', async () => {
    const calls = mockFetch();
    const adapter = createBuiltinHttp();
    await adapter.put('/foo');
    expect(calls.length).toBe(1);
    expect(calls[0]!.init?.method).toBe('PUT');
  });

  // SubTask 9.4
  it('test_patch_convenience_method_calls_request_with_PATCH', async () => {
    const calls = mockFetch();
    const adapter = createBuiltinHttp();
    await adapter.patch('/foo');
    expect(calls.length).toBe(1);
    expect(calls[0]!.init?.method).toBe('PATCH');
  });

  // SubTask 9.5
  it('test_delete_convenience_method_calls_request_with_DELETE', async () => {
    const calls = mockFetch();
    const adapter = createBuiltinHttp();
    // delete 是保留字，使用对象字面量语法访问
    await adapter.delete('/foo');
    expect(calls.length).toBe(1);
    expect(calls[0]!.init?.method).toBe('DELETE');
  });

  // SubTask 9.6
  it('test_request_interceptors_LIFO_order', async () => {
    const requestMgr = createInterceptorManager<RequestConfig>();
    const responseMgr = createInterceptorManager<ResponseData>();
    const order: string[] = [];
    requestMgr.use((c) => { order.push('a'); return c; });
    requestMgr.use((c) => { order.push('b'); return c; });
    requestMgr.use((c) => { order.push('c'); return c; });

    mockFetch();
    const adapter = createBuiltinHttp({ request: requestMgr, response: responseMgr });
    await adapter.request(makeConfig());
    // 请求拦截器 LIFO：后注册先执行
    expect(order).toEqual(['c', 'b', 'a']);
  });

  // SubTask 9.7
  it('test_response_interceptors_FIFO_order', async () => {
    const requestMgr = createInterceptorManager<RequestConfig>();
    const responseMgr = createInterceptorManager<ResponseData>();
    const order: string[] = [];
    responseMgr.use((r) => { order.push('a'); return r; });
    responseMgr.use((r) => { order.push('b'); return r; });
    responseMgr.use((r) => { order.push('c'); return r; });

    mockFetch();
    const adapter = createBuiltinHttp({ request: requestMgr, response: responseMgr });
    await adapter.request(makeConfig());
    // 响应拦截器 FIFO：先注册先执行
    expect(order).toEqual(['a', 'b', 'c']);
  });

  // SubTask 9.8
  it('test_onRejected_recovery_continues_onFulfilled', async () => {
    const requestMgr = createInterceptorManager<RequestConfig>();
    const responseMgr = createInterceptorManager<ResponseData>();
    const seen: unknown[] = [];

    // f0 抛错 → r1 接住并返回恢复值 → f2 收到恢复值
    responseMgr.use(() => { seen.push('f0'); throw new Error('boom'); });
    responseMgr.use(undefined, (e) => {
      seen.push('r1:' + (e as Error).message);
      return { recovered: true };
    });
    responseMgr.use((v) => { seen.push('f2:' + JSON.stringify(v)); return v; });

    mockFetch();
    const adapter = createBuiltinHttp({ request: requestMgr, response: responseMgr });
    const result = await adapter.request(makeConfig());
    expect(seen).toEqual(['f0', 'r1:boom', 'f2:{"recovered":true}']);
    expect(result).toEqual({ recovered: true });
  });

  // SubTask 9.9
  it('test_timeout_aborts_fetch_after_timeout_ms', async () => {
    // AbortSignal.timeout() 走真实 timers（Node 内部实现），故用真实 timers + 短 timeout
    const calls = mockFetch({ captureSignal: true });
    const adapter = createBuiltinHttp();
    const config = makeConfig({ timeout: 50 });
    await expect(adapter.request(config)).rejects.toThrow();
    expect(calls.length).toBe(1);
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  // SubTask 9.10
  it('test_no_timeout_does_not_abort', async () => {
    const calls = mockFetch();
    const adapter = createBuiltinHttp();
    // 不设置 timeout：init.signal 应为 undefined
    const result = await adapter.request(makeConfig());
    expect(calls.length).toBe(1);
    expect(calls[0]!.init?.signal).toBeUndefined();
    expect(result.status).toBe(200);
  });

  // SubTask 9.11
  it('test_paramsSerializer_custom_serialization', async () => {
    const calls = mockFetch();
    const adapter = createBuiltinHttp();
    await adapter.request(
      makeConfig({
        url: '/foo',
        params: { a: 1, b: 'x y' },
        paramsSerializer: (p) =>
          Object.entries(p)
            .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
            .join('&'),
      }),
    );
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe('/foo?a=1&b=x%20y');
  });

  // SubTask 9.12
  it('test_forge_interceptors_shared_with_builtin_adapter', async () => {
    const requestMgr = createInterceptorManager<RequestConfig>();
    const responseMgr = createInterceptorManager<ResponseData>();

    const adapter = createBuiltinHttp({ request: requestMgr, response: responseMgr });

    // 同一对象引用
    expect(adapter.interceptors?.request).toBe(requestMgr);
    expect(adapter.interceptors?.response).toBe(responseMgr);
    expect(adapter.runsInterceptors).toBe(true);

    // 在共享的 requestMgr 上注册拦截器，触发 request() 应被调用
    let called = false;
    requestMgr.use((c) => {
      called = true;
      return c;
    });

    mockFetch();
    await adapter.request(makeConfig());
    expect(called).toBe(true);
  });
});
