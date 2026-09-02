/**
 * Adapter 降级测试（宿主无可用 axios 的场景）
 *
 * 覆盖审计项：
 *   - H1b：adapter:'auto' 检测不到有效 axios → 自动降级到内置 builtin（零配置可运行）
 *   - M1：adapter:'axios' 显式强制但宿主无 axios → 抛 AdapterNotFoundError（RF_FE_005）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdapterNotFoundError, createRouteForge } from '../src/index.js';
import type { LevelRoutesResponse } from '../src/types.js';
import { makeSummary } from './fixtures.js';

// 模拟宿主未安装（或无效）的 axios：模块存在但没有 request 函数
// → wrapAxiosAdapter 判定无效并返回 null
vi.mock('axios', () => ({}));

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
let fetchUrls: string[];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchUrls = [];
  // 确保全局 axios 兜底探测也失败
  delete (globalThis as any).axios;
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    fetchUrls.push(url);
    if (url === summary.config.endpoint_prefix) {
      return jsonResponse(summary);
    }
    if (url === '/_forge/routes/public') {
      return jsonResponse(levelRoutes);
    }
    return jsonResponse({ ok: true, url });
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

describe('adapter auto detection — no usable axios', () => {
  it('auto degrades to builtin: level and business requests go through fetch', async () => {
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'auto',
    });
    await forge.load('public');
    const result = (await forge.api('public', 'users.index')) as any;

    expect(result.data.ok).toBe(true);
    // 摘要 / 层级 / 业务全部走 fetch（builtin 基于原生 fetch）
    expect(fetchUrls).toContain('/_forge/routes');
    expect(fetchUrls).toContain('/_forge/routes/public');
    expect(fetchUrls).toContain('/users');
  });

  it('auto-degraded builtin still honors forge interceptors', async () => {
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'auto',
      interceptors: {
        response: [(resp: any) => resp.data],
      },
    });
    await forge.load('public');
    const result = await forge.api('public', 'users.index');
    // 响应拦截器解包生效 → 证明降级后的 builtin 复用了 forge 拦截器管理器
    expect(result).toEqual({ ok: true, url: '/users' });
  });
});

describe('adapter axios forced — host axios missing', () => {
  it('explicit axios without usable host axios rejects with AdapterNotFoundError', async () => {
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'axios',
    });
    try {
      await forge.load('public');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterNotFoundError);
      expect((e as AdapterNotFoundError).code).toBe('RF_FE_005');
    }
    // 业务调用同样失败（不静默降级）
    await expect(forge.api('public', 'users.index')).rejects.toBeInstanceOf(AdapterNotFoundError);
  });
});
