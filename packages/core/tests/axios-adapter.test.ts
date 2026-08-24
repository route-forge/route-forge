import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteForge, HTTPError, NetworkError } from '../src/index.js';
import type { LevelRoutesResponse, SummaryResponse } from '../src/types.js';

// ─── axios mock（vi.hoisted 保证工厂提升前即可引用 mock 函数） ───

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('axios', () => ({
  default: { request: requestMock },
}));

// ─── 摘要端点走全局 fetch，层级/业务请求走 axios ─────────────

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
    'users.update': {
      name: 'users.update',
      uri: 'users/{user}',
      methods: ['PUT'],
      parameters: ['user'],
    },
  },
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    if (url === summary.config.endpoint_prefix) {
      return {
        ok: true,
        status: 200,
        json: async () => summary,
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    }
    throw new Error('unexpected fetch: ' + url);
  });
  requestMock.mockReset();
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  vi.restoreAllMocks();
});

/** 默认 axios 实现：层级拉取成功 + 业务请求按参数响应 */
function setupAxios(opts: {
  apiStatus?: number;
  apiData?: unknown;
  apiHeaders?: Record<string, string>;
} = {}) {
  requestMock.mockImplementation(async (cfg: { url: string }) => {
    if (cfg.url.includes('/_forge/routes/public')) {
      return { status: 200, data: levelRoutes, headers: {} };
    }
    const status = opts.apiStatus ?? 200;
    if (status < 200 || status >= 300) {
      // axios 默认 validateStatus：非 2xx 抛带 response 的错误
      throw Object.assign(new Error(`Request failed with status code ${status}`), {
        response: {
          status,
          data: opts.apiData ?? { message: 'error' },
          headers: opts.apiHeaders ?? {},
        },
      });
    }
    return { status, data: opts.apiData ?? { ok: true }, headers: opts.apiHeaders ?? {} };
  });
}

function createForge() {
  return createRouteForge({
    endpoint: '/_forge/routes',
    levels: ['public'],
    adapter: 'axios',
  });
}

// ─── tests ──────────────────────────────────────────────────

describe('axios adapter — request delegation', () => {
  it('business request is delegated to host axios with url/method/headers/data', async () => {
    setupAxios();
    const forge = createForge();
    await forge.load('public');
    await forge.api('public', 'users.update', { user: 7, body: { name: 'Bob' } });
    const bizCall = requestMock.mock.calls
      .map((c) => c[0])
      .find((cfg: any) => cfg.url === '/users/7');
    expect(bizCall).toBeDefined();
    expect(bizCall.method).toBe('PUT');
    expect(bizCall.data).toEqual({ name: 'Bob' });
    expect(bizCall.headers.Accept).toBe('application/json');
  });

  it('per-call timeout is passed through to axios (parity with builtin)', async () => {
    setupAxios();
    const forge = createForge();
    await forge.load('public');
    await forge.api('public', 'users.index', { timeout: 777 });
    const bizCall = requestMock.mock.calls
      .map((c) => c[0])
      .find((cfg: any) => cfg.url === '/users');
    expect(bizCall.timeout).toBe(777);
  });

  it('resolves with ResponseData built from axios response', async () => {
    setupAxios({
      apiData: { list: [1, 2] },
      apiHeaders: { toJSON: () => ({ 'x-req-id': 'abc' }) } as any,
    });
    const forge = createForge();
    await forge.load('public');
    const result = (await forge.api('public', 'users.index')) as any;
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ list: [1, 2] });
    expect(result.route).toBe('users.index');
    expect(result.headers).toBeInstanceOf(Headers);
    // AxiosHeaders 风格（toJSON）被安全转换
    expect(result.headers.get('x-req-id')).toBe('abc');
  });
});

describe('axios adapter — error semantics', () => {
  it('non-2xx (error with response) surfaces as HTTPError with status', async () => {
    setupAxios({ apiStatus: 500, apiData: { message: 'boom' } });
    const forge = createForge();
    await forge.load('public');
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

  it('non-2xx enters response onRejected chain and can recover (parity with builtin)', async () => {
    setupAxios({ apiStatus: 404 });
    const forge = createForge();
    await forge.load('public');
    const seen: unknown[] = [];
    forge.interceptors.response.use(undefined, (e) => {
      seen.push(e);
      return { recovered: true };
    });
    const result = await forge.api('public', 'users.index');
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeInstanceOf(HTTPError);
    expect(result).toEqual({ recovered: true });
  });

  it('error without response (network failure) becomes NetworkError', async () => {
    const netErr = new Error('connect ECONNREFUSED');
    requestMock.mockImplementation(async (cfg: { url: string }) => {
      if (cfg.url.includes('/_forge/routes/public')) {
        return { status: 200, data: levelRoutes, headers: {} };
      }
      throw netErr;
    });
    const forge = createForge();
    await forge.load('public');
    try {
      await forge.api('public', 'users.index');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NetworkError);
      const err = e as NetworkError;
      expect(err.code).toBe('RF_FE_007');
      expect(err.cause).toBe(netErr);
    }
  });

  it('level fetch failure via axios surfaces as HTTPError', async () => {
    requestMock.mockImplementation(async (cfg: { url: string }) => {
      if (cfg.url.includes('/_forge/routes/public')) {
        throw Object.assign(new Error('Request failed with status code 500'), {
          response: { status: 500, data: {}, headers: {} },
        });
      }
      return { status: 200, data: {}, headers: {} };
    });
    const forge = createForge();
    await expect(forge.load('public')).rejects.toThrow(HTTPError);
  });
});
