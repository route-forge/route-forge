import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { StrictMode, createElement, useContext } from 'react';
import type { LevelRoutesResponse, SummaryResponse } from '@route-forge/core';
import { ForgeContext, RouteForgeProvider, useForge } from '../src/index.js';

describe('@route-forge/react provider (scaffold smoke test)', () => {
  it('provides forge instance via context', () => {
    let forgeInstance: ReturnType<typeof useForge> | null = null;

    function TestComponent() {
      forgeInstance = useForge();
      return createElement('div', { 'data-testid': 'test' }, 'test');
    }

    render(
      createElement(
        RouteForgeProvider,
        { options: { endpoint: '/_forge/routes', levels: ['public'] } },
        createElement(TestComponent),
      ),
    );

    expect(forgeInstance).toBeTruthy();
    expect(typeof forgeInstance!.api).toBe('function');
    expect(typeof forgeInstance!.load).toBe('function');
    expect(typeof forgeInstance!.isLoaded).toBe('function');
  });

  it('throws when useForge is used outside provider', () => {
    function TestComponent() {
      useForge();
      return createElement('div', null, 'test');
    }

    expect(() => {
      render(createElement(TestComponent));
    }).toThrow('[route-forge/react] useForge() must be used within a <RouteForgeProvider>');
  });

  it('FORGE_CONTEXT is exported', () => {
    expect(ForgeContext).toBeTruthy();
  });
});

// ─── onInterceptors 创建期钩子 ──────────────────────────────

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

const levelRoutes: LevelRoutesResponse = {
  level: 'public',
  routes: {
    'users.index': { name: 'users.index', uri: 'users', methods: ['GET'], parameters: [] },
  },
};

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as any;
}

function mockFetch() {
  const prev = (globalThis as any).fetch;
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const ep = summary.config.endpoint_prefix;
    if (url === ep) return jsonResponse(summary);
    if (url.startsWith(ep + '/')) return jsonResponse(levelRoutes);
    return jsonResponse({ success: true, echo: { url } });
  });
  return () => { (globalThis as any).fetch = prev; };
}

describe('RouteForgeProvider onInterceptors（创建期注册拦截器）', () => {
  it('工厂化即同步触发一次，回调拿到带 request/response.use 的管理器（无需 ready）', () => {
    let calls = 0;
    let seen: any;
    render(
      createElement(
        RouteForgeProvider,
        {
          options: { endpoint: '/_forge/routes', levels: ['public'] },
          onInterceptors: (i: any) => { calls++; seen = i; },
        },
        null,
      ),
    );
    expect(calls).toBe(1);
    expect(typeof seen.request.use).toBe('function');
    expect(typeof seen.response.use).toBe('function');
  });

  it('回调收到的 interceptors 与 context 实例的 interceptors 是同一引用（注册可穿透下游）', () => {
    let hookArg: any;
    let ctxInterceptors: any;
    function Capture() {
      ctxInterceptors = useContext(ForgeContext)!.interceptors;
      return null;
    }
    render(
      createElement(
        RouteForgeProvider,
        {
          options: { endpoint: '/_forge/routes', levels: ['public'] },
          onInterceptors: (i: any) => { hookArg = i; },
        },
        createElement(Capture),
      ),
    );
    expect(hookArg).toBe(ctxInterceptors);
    expect(hookArg.request).toBe(ctxInterceptors.request);
  });

  it('StrictMode 模拟 remount 下，存活实例的拦截器只注册一次（api 时不重复执行）', async () => {
    // StrictMode remount 会重建新实例并各注册一次（工厂回调全局可被调 2 次），
    // 但真正下发到 context、被 api() 使用的存活实例只挂了 1 个 handler——这才是用户关心的不变式。
    const restore = mockFetch();
    try {
      let runs = 0;
      let forge: any;
      function Capture() {
        forge = useContext(ForgeContext)!;
        return null;
      }
      render(
        createElement(
          StrictMode,
          null,
          createElement(
            RouteForgeProvider,
            {
              options: { endpoint: '/_forge/routes', levels: ['public'], adapter: 'builtin' },
              onInterceptors: (i: any) => {
                i.request.use((c: any) => { runs++; return c; });
              },
            },
            createElement(Capture),
          ),
        ),
      );
      await act(async () => { await forge.ready(); });
      await act(async () => { await forge.api('public', 'users.index'); });
      expect(runs).toBe(1);
    } finally {
      restore();
    }
  });

  it('options 变值重建实例后再触发一次；仅回调 identity 变化（options 等值）不重跑', async () => {
    let calls = 0;
    function App({ endpoint, token }: { endpoint: string; token: number }) {
      // 每次渲染都传新内联 options 字面量 + 新 onInterceptors 闭包
      void token;
      return createElement(
        RouteForgeProvider,
        {
          options: { endpoint, levels: ['public'] },
          onInterceptors: () => { calls++; },
        },
        null,
      );
    }
    const { rerender } = render(createElement(App, { endpoint: '/_forge/routes', token: 1 }));
    expect(calls).toBe(1); // 挂载惰性初始化触发一次
    // 同值 options + 新回调 identity：等值比较命中 → 不重建、不重跑
    rerender(createElement(App, { endpoint: '/_forge/routes', token: 2 }));
    rerender(createElement(App, { endpoint: '/_forge/routes', token: 3 }));
    expect(calls).toBe(1);
    // options 实际变化 → effect 重建实例 → 再触发一次
    rerender(createElement(App, { endpoint: '/_other/routes', token: 4 }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it('经钩子注册的请求拦截器在后续 api() 生效（无需在 ready 之后注册）', async () => {
    const restore = mockFetch();
    try {
      let reqRan = false;
      let forge: any;
      function Capture() {
        forge = useContext(ForgeContext)!;
        return null;
      }
      render(
        createElement(
          RouteForgeProvider,
          {
            options: { endpoint: '/_forge/routes', levels: ['public'], adapter: 'builtin' },
            onInterceptors: (i: any) => {
              i.request.use((c: any) => { reqRan = true; return c; });
            },
          },
          createElement(Capture),
        ),
      );
      await act(async () => { await forge.ready(); });
      await act(async () => { await forge.api('public', 'users.index'); });
      expect(reqRan).toBe(true);
    } finally {
      restore();
    }
  });
});
