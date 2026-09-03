/**
 * React Provider 级内嵌 hydration：<RouteForgeProvider> 不传 options 时消费 window.__ROUTE_FORGE__。
 * 单一用例（core 侧 module-memo 在本测试文件内只读一次，避免跨用例串味）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { RouteForgeProvider, useForge } from '../src/index.js';
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

describe('RouteForgeProvider 无 options 消费 window.__ROUTE_FORGE__', () => {
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

    let ready = false;
    function Probe() {
      const forge = useForge();
      useEffect(() => {
        void forge.ready().then(() => {
          ready = true;
        });
      }, [forge]);
      return null;
    }

    // 关键：<RouteForgeProvider> 完全不传 options
    render(
      <RouteForgeProvider>
        <Probe />
      </RouteForgeProvider>,
    );

    await waitFor(() => expect(ready).toBe(true));
    expect(reads).toBe(1);
    expect(summaryRequested).toBe(false);
  });
});
