/**
 * Adapter 非预期错误降级测试
 *
 * 覆盖审计项：
 *   - M2：adapter 解析抛出非 AdapterNotFoundError 的错误时，ensureAdapter 降级到
 *     builtin，且降级后 forge 拦截链语义不变（回归：降级曾丢失 forge 拦截器管理器，
 *     导致用户拦截器被静默跳过）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteForge } from '../src/index.js';
import type { LevelRoutesResponse } from '../src/types.js';
import { makeSummary } from './fixtures.js';

// 模拟 axios 包装层抛出非预期错误（如宿主 axios 初始化异常）
vi.mock('../src/adapters/axios.js', () => ({
  wrapAxiosAdapter: vi.fn(async () => {
    throw new Error('unexpected axios initialization failure');
  }),
}));

const summary = makeSummary({
  levels: {
    public: { description: 'public', load: 'lazy', route_count: 1 },
  },
});

const levelRoutes: LevelRoutesResponse = {
  level: 'public',
  routes: {
    'users.index': { name: 'users.index', uri: 'users', methods: ['GET'], parameters: [] },
  },
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    if (url === summary.config.endpoint_prefix) return jsonResponse(summary);
    if (url === '/_forge/routes/public') return jsonResponse(levelRoutes);
    return jsonResponse({ ok: true });
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

describe('adapter unexpected failure degrades to builtin', () => {
  it('non-AdapterNotFoundError during resolution degrades to builtin (requests still work)', async () => {
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'axios',
    });
    // 不抛错：降级为内置实现，请求照常
    await forge.load('public');
    const result = (await forge.api('public', 'users.index')) as any;
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true });
  });

  it('degraded builtin preserves forge interceptor chain (regression)', async () => {
    const seen: string[] = [];
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'axios',
      interceptors: {
        request: [(config) => {
          seen.push('request');
          return config;
        }],
        response: [(resp: any) => {
          seen.push('response');
          return resp.data;
        }],
      },
    });
    await forge.load('public');
    const result = await forge.api('public', 'users.index');
    // 降级后请求/响应拦截器都必须照常执行
    expect(seen).toEqual(['request', 'response']);
    expect(result).toEqual({ ok: true });
  });
});
