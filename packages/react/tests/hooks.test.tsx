import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useContext, useRef, useState } from 'react';
import {
  ForgeContext,
  RouteForgeProvider,
  useForge,
  useForgeApi,
  useForgeLevel,
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

  it('bound forge props are immutable, non-enumerable and interceptors are frozen', () => {
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
    expect(Object.isFrozen(bound.interceptors)).toBe(true);
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

// ─── useForgeLevel ──────────────────────────────────────────

describe('useForgeLevel', () => {
  it('auto-loads on mount and flips loaded to true', async () => {
    let state: any;
    let ctxForge: any;

    function C() {
      ctxForge = useContext(ForgeContext);
      state = useForgeLevel('public');
      return null;
    }

    render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    await waitFor(() => expect(state.loaded).toBe(true));
    expect(state.error).toBeNull();
    expect(ctxForge.isLoaded('public')).toBe(true);
  });

  it('load failure sets error, manual load() retries and recovers', async () => {
    backend.levelOk = false;
    let state: any;

    function C() {
      state = useForgeLevel('public');
      return null;
    }

    render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    await waitFor(() => expect(state.error).toBeTruthy());
    expect(state.loaded).toBe(false);

    // 后端恢复 → 手动重试
    backend.levelOk = true;
    await act(async () => {
      await state.load();
    });
    await waitFor(() => expect(state.loaded).toBe(true));
    expect(state.error).toBeNull();
  });

  it('load identity is stable across re-renders with unchanged level', () => {
    const loads: Array<() => Promise<void>> = [];

    function C() {
      const { load } = useForgeLevel('public');
      const first = useRef(load);
      loads.push(load);
      const [, force] = useState(0);
      // 触发一次重渲染
      if (loads.length === 1) force(1);
      return first.current === load ? null : <div data-changed="1" />;
    }

    const { container } = render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    expect(loads.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-changed]')).toBeNull();
  });
});

// ─── useForgeRoute ──────────────────────────────────────────

describe('useForgeRoute', () => {
  it('builds url after level auto-load', async () => {
    let url: string | undefined;

    function Outer() {
      const { loaded } = useForgeLevel('public');
      if (!loaded) return <div>loading</div>;
      return <Inner />;
    }

    function Inner() {
      url = useForgeRoute('public', 'users.show', { user: 42 });
      return null;
    }

    const { getByText } = render(
      <RouteForgeProvider options={makeOptions()}>
        <Outer />
      </RouteForgeProvider>,
    );
    getByText('loading');
    await waitFor(() => expect(url).toBe('/users/42'));
  });
});
