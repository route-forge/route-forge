/**
 * Vue 插件级内嵌 hydration：createRouteForgePlugin() 无参时消费 window.__ROUTE_FORGE__。
 * 单一用例（core 侧 module-memo 在本测试文件内只读一次，避免跨用例串味）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouteForgePlugin } from '../src/index.js';
import type { SummaryResponse } from '@route-forge/core';

const summary: SummaryResponse = {
  schemeVersion: 1,
  levels: {
    public: {
      description: 'public',
      load: 'lazy',
      route_count: 1,
      route: { uri: '/_forge/routes/public', methods: ['GET', 'HEAD'] },
    },
  },
  config: { strict_mode: false, endpoint_prefix: '/_forge/routes', url_prefix: null, cache_ttl: 3600 },
};

function ok(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as any;
}

describe('createRouteForgePlugin() 无参消费 window.__ROUTE_FORGE__', () => {
  afterEach(() => vi.restoreAllMocks());

  it('no options → uses embedded summary, never requests the summary endpoint', async () => {
    let reads = 0;
    if (typeof (globalThis as any).window === 'undefined') (globalThis as any).window = {};
    Object.defineProperty((globalThis as any).window, '__ROUTE_FORGE__', {
      configurable: true,
      enumerable: false,
      get() {
        reads++;
        const v = summary;
        delete (globalThis as any).window.__ROUTE_FORGE__;
        return v;
      },
    });

    let summaryRequested = false;
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/_forge/routes') {
        summaryRequested = true;
        return ok(summary);
      }
      return ok({ level: 'public', routes: {} });
    });

    const plugin = createRouteForgePlugin();
    await plugin.ready();

    expect(reads).toBe(1); // 构造即消费内嵌摘要
    expect(summaryRequested).toBe(false); // 从未请求摘要端点
  });
});
