import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import {
  ForgeContext,
  RouteForgeProvider,
  useForge,
  useForgeApi,
  useForgeRoute,
} from '../src/index.js';
import type { LevelRoutesResponse, SummaryResponse } from '@route-forge/core';

// ─── mock backend ───────────────────────────────────────────

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
    'users.show': {
      name: 'users.show',
      uri: 'users/{user}',
      methods: ['GET'],
      parameters: ['user'],
    },
  },
};

/** 运行时开关：层级拉取 / 业务请求可分别置为失败（模拟重试场景） */
const backend = { levelOk: true, apiOk: true };

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  backend.levelOk = true;
  backend.apiOk = true;
  originalFetch = globalThis.fetch;
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const ep = summary.config.endpoint_prefix;
    if (url === ep) {
      return jsonResponse(summary);
    }
    if (url.startsWith(ep + '/')) {
      return backend.levelOk ? jsonResponse(levelRoutes) : jsonResponse({ message: 'boom' }, 500);
    }
    if (!backend.apiOk) return jsonResponse({ message: 'server error' }, 500);
    // 回显请求参数，便于断言绑定层级/前缀的正确性
    return jsonResponse({
      success: true,
      echo: { url, method: init?.method ?? 'GET' },
    });
  });
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  localStorage.clear();
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

function makeOptions(endpoint = '/_forge/routes') {
  return { endpoint, levels: ['public'], adapter: 'builtin' as const };
}

// ─── provider stability ─────────────────────────────────────

describe('RouteForgeProvider instance stability (regression)', () => {
  it('inline options literal with equal values keeps the same forge across re-renders', () => {
    const seen: unknown[] = [];

    function Capture() {
      seen.push(useContext(ForgeContext));
      return null;
    }

    function App({ endpoint }: { endpoint: string }) {
      // 每次渲染都是新的内联对象字面量 —— 旧实现会因此每次重建实例
      return (
        <RouteForgeProvider options={{ endpoint, levels: ['public'], adapter: 'builtin' }}>
          <Capture />
        </RouteForgeProvider>
      );
    }

    const { rerender } = render(<App endpoint="/_forge/routes" />);
    rerender(<App endpoint="/_forge/routes" />);
    rerender(<App endpoint="/_forge/routes" />);
    expect(seen.length).toBe(3);
    expect(seen[0]).toBeTruthy();
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });

  it('changed option value rebuilds the forge instance', () => {
    const seen: unknown[] = [];

    function Capture() {
      seen.push(useContext(ForgeContext));
      return null;
    }

    function App({ endpoint }: { endpoint: string }) {
      return (
        <RouteForgeProvider options={{ endpoint, levels: ['public'], adapter: 'builtin' }}>
          <Capture />
        </RouteForgeProvider>
      );
    }

    const { rerender } = render(<App endpoint="/_forge/routes" />);
    rerender(<App endpoint="/_other/routes" />);
    expect(seen.length).toBe(2);
    expect(seen[1]).not.toBe(seen[0]);
  });
});

// ─── useForge ───────────────────────────────────────────────

describe('useForge', () => {
  it('bound forge is callable and has no prefix property when prefix not given', async () => {
    let bound: any;

    function C() {
      bound = useForge({ level: 'public' });
      return null;
    }

    render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    expect(typeof bound).toBe('function');
    expect(bound.level).toBe('public');
    expect('prefix' in bound).toBe(false);

    const result: any = await bound('users.index');
    expect(result.data.success).toBe(true);
    expect(result.data.echo.url).toBe('/users');
  });

  it('bound forge props are immutable and non-enumerable', () => {
    let bound: any;

    function C() {
      bound = useForge({ level: 'public' });
      return null;
    }

    render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    const desc = Object.getOwnPropertyDescriptor(bound, 'level')!;
    expect(desc.writable).toBe(false);
    expect(desc.enumerable).toBe(false);
    expect(desc.configurable).toBe(false);
    expect(Object.keys(bound)).not.toContain('level');
  });

  it('bound forge with prefix resolves suffixed route names', async () => {
    let bound: any;

    function C() {
      bound = useForge({ level: 'public', prefix: 'users' });
      return null;
    }

    render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    expect(bound.prefix).toBe('users');
    const result: any = await bound('show', { user: 3 });
    expect(result.data.echo.url).toBe('/users/3');
  });
});

// ─── useForgeApi ────────────────────────────────────────────

describe('useForgeApi', () => {
  it('successful call resolves data and clears error', async () => {
    let api: any;

    function C() {
      api = useForgeApi({ level: 'public' });
      return null;
    }

    render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    const { data, error } = await act(async () => api.call('users.index'));
    expect(error).toBeNull();
    expect(data.data.success).toBe(true);
    expect(api.pending).toBe(false);
    expect(api.error).toBeNull();
  });

  it('failed call sets error ref and returns it without throwing', async () => {
    backend.apiOk = false;
    let api: any;

    function C() {
      api = useForgeApi({ level: 'public' });
      return null;
    }

    render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    const { data, error } = await act(async () => api.call('users.index'));
    expect(data).toBeUndefined();
    expect(error).toBeTruthy();
    expect((error as any).code).toBe('RF_FE_008');
    expect(api.error).toBe(error);
    expect(api.pending).toBe(false);
  });
});

// ─── useForgeRoute ──────────────────────────────────────────

describe('useForgeRoute', () => {
  it('returns empty string initially, then builds url after level auto-load', async () => {
    const urls: string[] = [];

    function C() {
      const url = useForgeRoute('public', 'users.show', { user: 42 });
      urls.push(url);
      return <div data-url={url || 'empty'}>{url || 'loading'}</div>;
    }

    const { getByText } = render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    getByText('loading');
    await waitFor(() => expect(urls).toContain('/users/42'));
  });
});

// ─── API trimming & levelLoaded ─────────────────────────────

describe('useForge API trimming', () => {
  it('useForge() without level returns full RouteForge instance', () => {
    let forge: any;

    function C() {
      forge = useForge();
      return null;
    }

    render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    // useForge() returns the full RouteForge instance with all top-level methods
    expect(typeof forge.api).toBe('function');
    expect(typeof forge.load).toBe('function');
    expect(typeof forge.route).toBe('function');
    expect(typeof forge.url).toBe('function');
    expect(typeof forge.hasRoute).toBe('function');
    expect(typeof forge.getRoutes).toBe('function');
    expect(typeof forge.isLoaded).toBe('function');
    expect(typeof forge.ready).toBe('function');
    expect(typeof forge.use).toBe('function');
    // onLevelLoaded only exists on BoundForge (after use(level)), not on top-level RouteForge
    expect(forge.onLevelLoaded).toBeUndefined();
  });

  it('useForge({ level }) returns levelLoaded and auto-triggers load', async () => {
    let bound: any;

    function C() {
      bound = useForge({ level: 'public' });
      return null;
    }

    render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    expect(bound.levelLoaded).toBeDefined();
    await waitFor(() => expect(bound.isLoaded('public')).toBe(true));
  });

  it('levelLoaded flips from false to true and triggers re-render after load', async () => {
    // 回归测试：旧实现只给闭包变量赋值、不 setState，组件不会重渲染（H8）
    const rendered: boolean[] = [];

    function C() {
      const bound = useForge({ level: 'public' }) as any;
      rendered.push(bound.levelLoaded);
      return <div>{String(bound.levelLoaded)}</div>;
    }

    const { getByText } = render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    // 首次渲染：未加载 → false
    expect(rendered[0]).toBe(false);
    // 加载完成：state 更新 → 组件重渲染 → UI 显示 true
    await waitFor(() => expect(getByText('true')).toBeTruthy());
    expect(rendered[rendered.length - 1]).toBe(true);
  });

  it('levelLoaded initializes true when level already cached in storage', async () => {
    // 回归测试：已缓存层级在新组件首帧即为 true（useState 初始化器读取 isLoaded）
    const opts = {
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin' as const,
      cache: { storage: 'localStorage' as const },
    };

    function Preload() {
      useForge({ level: 'public' });
      return null;
    }
    const first = render(
      <RouteForgeProvider options={opts}>
        <Preload />
      </RouteForgeProvider>,
    );
    await waitFor(() => expect(localStorage.getItem('route-forge:public')).toBeTruthy());
    first.unmount();

    const seen: boolean[] = [];
    function Late() {
      const bound = useForge({ level: 'public' }) as any;
      seen.push(bound.levelLoaded);
      return <div>{String(bound.levelLoaded)}</div>;
    }
    // 第二个树是全新 forge 实例，但从 localStorage 读到缓存 → 首帧即 true
    const second = render(
      <RouteForgeProvider options={opts}>
        <Late />
      </RouteForgeProvider>,
    );
    expect(seen[0]).toBe(true);
    second.unmount();
  });
});

describe('useForgeRoute reactivity (M3)', () => {
  it('recomputes url when params change after level loaded', async () => {
    const urls: string[] = [];
    function C({ uid }: { uid: number }) {
      const url = useForgeRoute('public', 'users.show', { user: uid });
      urls.push(url);
      return <div>{url || 'loading'}</div>;
    }
    const { rerender } = render(
      <RouteForgeProvider options={makeOptions()}>
        <C uid={42} />
      </RouteForgeProvider>,
    );
    await waitFor(() => expect(urls).toContain('/users/42'));
    // 参数变化：level 已加载，URL 应重新计算
    rerender(
      <RouteForgeProvider options={makeOptions()}>
        <C uid={99} />
      </RouteForgeProvider>,
    );
    await waitFor(() => expect(urls).toContain('/users/99'));
  });
});

describe('onSummaryReady via provider options (M5)', () => {
  it('fires after auto-discovery completes', async () => {
    const cb = vi.fn();
    render(
      <RouteForgeProvider
        options={{ endpoint: '/_forge/routes', levels: ['public'], adapter: 'builtin', onSummaryReady: cb }}
      >
        <div />
      </RouteForgeProvider>,
    );
    await waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  });
});
