import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import {
  ForgeLink,
  ForgeRoute,
  RouteForgeProvider,
} from '../src/index.js';
import type { LevelRoutesResponse, SummaryResponse } from '@route-forge/core';

// ─── mock backend ───────────────────────────────────────────

const summary: SummaryResponse = {
  schemeVersion: 1,
  levels: {
    public: {
      description: 'public',
      load: 'lazy',
      route_count: 2,
      route: { uri: '/_forge/routes/public', methods: ['GET', 'HEAD'] },
    },
  },
  config: { strict_mode: false, endpoint_prefix: '/_forge/routes', url_prefix: null, cache_ttl: 3600 },
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

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const ep = summary.config.endpoint_prefix;
    if (url === ep) return jsonResponse(summary);
    if (url.startsWith(ep + '/')) return jsonResponse(levelRoutes);
    return jsonResponse({ success: true, echo: { url } });
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

function makeOptions() {
  return { endpoint: '/_forge/routes', levels: ['public'], adapter: 'builtin' as const };
}

/** 模拟任意路由库的 Link 组件（react-router 消费 to / next-link 消费 href，验证两者都传入） */
function FakeLink({ href, to, children, ...rest }: any) {
  return (
    <span data-testid="fake-link" data-href={href} data-to={to} {...rest}>
      {children}
    </span>
  );
}

// ─── ForgeLink ──────────────────────────────────────────────

describe('ForgeLink', () => {
  it('renders nothing while not loaded, then <a href> after load (rest props passthrough)', async () => {
    const { container } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeLink level="public" name="users.show" params={{ user: 7 }} className="btn" data-testid="link">
          查看用户
        </ForgeLink>
      </RouteForgeProvider>,
    );

    // 未加载：默认不渲染
    expect(container.querySelector('a')).toBeNull();
    await waitFor(() => {
      const a = container.querySelector('a');
      expect(a).not.toBeNull();
      expect(a!.getAttribute('href')).toBe('/users/7');
      expect(a!.textContent).toBe('查看用户');
      expect(a!.className).toBe('btn');
      expect(a!.getAttribute('data-testid')).toBe('link');
    });
  });

  it('renders loading prop while not loaded', async () => {
    const { container, getByText } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeLink level="public" name="users.index" loading={<span>loading…</span>}>
          列表
        </ForgeLink>
      </RouteForgeProvider>,
    );

    expect(getByText('loading…')).toBeTruthy();
    await waitFor(() => {
      const a = container.querySelector('a');
      expect(a).not.toBeNull();
      expect(a!.getAttribute('href')).toBe('/users');
      expect(a!.textContent).toBe('列表');
    });
  });

  it('renders injected custom Link via as prop with generated href', async () => {
    const { container } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeLink as={FakeLink} level="public" name="users.show" params={{ user: 7 }} className="rl">
          查看用户
        </ForgeLink>
      </RouteForgeProvider>,
    );

    await waitFor(() => {
      const rl = container.querySelector('[data-testid="fake-link"]') as HTMLElement | null;
      expect(rl).not.toBeNull();
      // href 与 to 同时注入（react-router 消费 to，next/link 消费 href）
      expect(rl!.getAttribute('data-href')).toBe('/users/7');
      expect(rl!.getAttribute('data-to')).toBe('/users/7');
      expect(rl!.textContent).toBe('查看用户');
      expect(rl!.className).toBe('rl');
    });
    // 注入 as 后不再渲染原生 <a>
    expect(container.querySelector('a')).toBeNull();
  });

  it('degrades to console.error (not crash) when route name is unknown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, getByText } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeLink level="public" name="nope.missing" loading={<span>fallback</span>} />
      </RouteForgeProvider>,
    );

    await waitFor(() => {
      expect(getByText('fallback')).toBeTruthy();
    });
    expect(container.querySelector('a')).toBeNull();
    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.join(' '))).toContain('ForgeLink 路由解析失败');
    });
    // 初次渲染时 level 确实未加载（"尚未加载" warn 属预期），且仅一次
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('尚未加载');
    });
  });

  it('warns once per instance while unloaded', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeLink level="public" name="users.index" />
      </RouteForgeProvider>,
    );

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('尚未加载');
    });

    // 等待加载完成后重渲染：不再 warn
    await act(async () => {});
    rerender(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeLink level="public" name="users.show" />
      </RouteForgeProvider>,
    );
    await act(async () => {});
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('reacts to params changes (content-level comparison, not reference)', async () => {
    const { container, rerender } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeLink level="public" name="users.show" params={{ user: 7 }} />
      </RouteForgeProvider>,
    );

    await waitFor(() => {
      expect(container.querySelector('a')!.getAttribute('href')).toBe('/users/7');
    });

    // 内容相同的新对象引用：不应触发多余更新（url 不变）
    rerender(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeLink level="public" name="users.show" params={{ user: 7 }} />
      </RouteForgeProvider>,
    );
    expect(container.querySelector('a')!.getAttribute('href')).toBe('/users/7');

    // 内容变化：URL 重算
    rerender(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeLink level="public" name="users.show" params={{ user: 8 }} />
      </RouteForgeProvider>,
    );
    await waitFor(() => {
      expect(container.querySelector('a')!.getAttribute('href')).toBe('/users/8');
    });
  });
});

// ─── ForgeRoute ─────────────────────────────────────────────

describe('ForgeRoute', () => {
  it('passes { href, loaded } to render-prop children; loading before load', async () => {
    const { container, getByText } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeRoute
          level="public"
          name="users.show"
          params={{ user: 7 }}
          loading={<span>loading…</span>}
        >
          {({ href, loaded }) => <a href={href}>{loaded ? 'ready' : 'not-ready'}</a>}
        </ForgeRoute>
      </RouteForgeProvider>,
    );

    expect(getByText('loading…')).toBeTruthy();
    await waitFor(() => {
      const a = container.querySelector('a');
      expect(a).not.toBeNull();
      expect(a!.getAttribute('href')).toBe('/users/7');
      expect(a!.textContent).toBe('ready');
    });
  });

  it('renders node children after load and loading before (non-function children)', async () => {
    const { container, getByText, queryByText } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeRoute level="public" name="users.index" loading={<span>pending</span>}>
          <span>content</span>
        </ForgeRoute>
      </RouteForgeProvider>,
    );

    expect(getByText('pending')).toBeTruthy();
    await waitFor(() => {
      expect(queryByText('pending')).toBeNull();
      expect(getByText('content')).toBeTruthy();
      expect(container.querySelector('a')).toBeNull();
    });
  });

  it('renders nothing without loading prop while not loaded', () => {
    const { container } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeRoute level="public" name="users.index">
          {() => <a href="x">never</a>}
        </ForgeRoute>
      </RouteForgeProvider>,
    );
    // 函数 children 由调用方自行根据 loaded 决定渲染，loading 缺省时不干预
    expect(container.querySelector('a')).toBeNull();
  });

  it('degrades to console.error when route resolution fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <RouteForgeProvider options={makeOptions()}>
        <ForgeRoute level="public" name="nope.missing">
          {({ href, loaded }) => (
            <span data-testid="state">{`${href}|${loaded}`}</span>
          )}
        </ForgeRoute>
      </RouteForgeProvider>,
    );

    // 解析失败降级为 ''（loaded=false）→ 未传 loading → 不渲染
    await waitFor(() => {
      expect(container.querySelector('[data-testid="state"]')).toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.join(' '))).toContain('ForgeRoute 路由解析失败');
    });
  });
});
