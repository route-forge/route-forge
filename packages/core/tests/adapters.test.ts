/**
 * Adapter 选择机制测试（宿主存在 axios 的场景）
 *
 * 覆盖审计项：
 *   - H1a：adapter:'auto' 检测到宿主 axios → 复用（业务请求走 axios，不走 fetch）
 *   - H2：自定义 Fetcher 对象 → 绕过检测、接收 RequestConfig、forge 拦截链照常执行
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteForge } from '../src/index.js';
import type {
  LevelRoutesResponse,
  RequestConfig,
  ResponseData,
  SummaryResponse,
} from '../src/types.js';

// ─── axios mock：宿主已安装 axios ───────────────────────────

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('axios', () => ({
  default: { request: requestMock },
}));

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
  },
};

let originalFetch: typeof globalThis.fetch;
let fetchUrls: string[];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchUrls = [];
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    fetchUrls.push(url);
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
  requestMock.mockImplementation(async (cfg: { url: string }) => {
    if (cfg.url.includes('/_forge/routes/public')) {
      return { status: 200, data: levelRoutes, headers: {} };
    }
    return { status: 200, data: { ok: true }, headers: {} };
  });
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  vi.restoreAllMocks();
});

// ─── H1a：auto 检测到宿主 axios → 复用 ──────────────────────

describe('adapter auto detection — host axios present', () => {
  it('auto picks host axios: level and business requests go through axios, not fetch', async () => {
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'auto',
    });
    await forge.load('public');
    await forge.api('public', 'users.index');

    // axios 承接了层级拉取与业务请求
    const urls = requestMock.mock.calls.map((c) => (c[0] as { url: string }).url);
    expect(urls).toContain('/_forge/routes/public');
    expect(urls).toContain('/users');
    // fetch 仅用于摘要端点（摘要发现不走 adapter）
    expect(fetchUrls).toEqual(['/_forge/routes']);
  });
});

// ─── H2：自定义 Fetcher ─────────────────────────────────────

describe('custom Fetcher adapter', () => {
  function makeFetcher() {
    const seen: RequestConfig[] = [];
    const fetcher = {
      seen,
      async request(config: RequestConfig): Promise<ResponseData> {
        seen.push(config);
        if (config.url.includes('/_forge/routes/public')) {
          return {
            route: config.route,
            level: config.level,
            method: 'GET',
            url: config.url,
            status: 200,
            headers: new Headers(),
            data: levelRoutes,
            config,
          };
        }
        return {
          route: config.route,
          level: config.level,
          method: config.method,
          url: config.url,
          status: 200,
          headers: new Headers(),
          data: { custom: true, route: config.route },
          config,
        };
      },
    };
    return fetcher;
  }

  it('object adapter bypasses detection and receives full RequestConfig', async () => {
    const fetcher = makeFetcher();
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: fetcher,
    });
    await forge.load('public');
    const result = (await forge.api('public', 'users.index')) as any;

    expect(result.data.custom).toBe(true);
    // 业务请求的 config 完整传递（route/meta/url）
    const biz = fetcher.seen.find((c) => c.route === 'users.index')!;
    expect(biz).toBeDefined();
    expect(biz.url).toBe('/users');
    expect(biz.meta.name).toBe('users.index');
    expect(biz.level).toBe('public');
    // 未走 axios 也未走 fetch（摘要除外）
    expect(requestMock).not.toHaveBeenCalled();
    expect(fetchUrls).toEqual(['/_forge/routes']);
  });

  it('forge request/response interceptors still run for custom fetcher', async () => {
    const fetcher = makeFetcher();
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: fetcher,
      interceptors: {
        request: [(config) => ({ ...config, headers: { ...config.headers, 'X-Tag': 'yes' } })],
        response: [(resp: any) => resp.data],
      },
    });
    await forge.load('public');
    const result = await forge.api('public', 'users.index');

    // 响应拦截器已解包（末段返回 resp.data）
    expect(result).toEqual({ custom: true, route: 'users.index' });
    // 请求拦截器修改的 headers 传到了 fetcher（注意：拦截链产出新对象）
    const biz = fetcher.seen.find((c) => c.route === 'users.index')!;
    expect(biz.headers['X-Tag']).toBe('yes');
  });
});
