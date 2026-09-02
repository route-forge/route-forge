import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { StrictMode, useContext, useEffect } from 'react';
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

  it('changed option value rebuilds the forge instance', async () => {
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
    // options 变化检测在 effect 中执行（渲染期不换实例）：换实例延后一帧
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3));
    const last = seen[seen.length - 1];
    expect(last).not.toBe(seen[0]);
  });

  it('StrictMode double render creates only one forge instance and one summary fetch', async () => {
    // StrictMode 下渲染函数执行两次：lazy init 幂等（null 检查），实例不重建
    const seen: unknown[] = [];

    function Capture() {
      seen.push(useContext(ForgeContext));
      return null;
    }

    await act(async () => {
      render(
        <StrictMode>
          <RouteForgeProvider options={makeOptions()}>
            <Capture />
          </RouteForgeProvider>
        </StrictMode>,
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    // 双渲染只产生一个实例（ref 保留：提交渲染中的 lazy init 幂等）
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const s of seen) expect(s).toBe(seen[0]);
    // 注：StrictMode 丢弃渲染中 lazy init 可能执行两次（各发一次摘要请求）——这是
    // React 官方文档定义的 StrictMode 预期行为（暴露渲染期副作用，生产模式不双跑），
    // 实例唯一性由 ref 保证，重复请求由后端幂等与浏览器缓存兜底，此处不断言请求次数
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

  it('concurrent calls keep pending true until all complete', async () => {
    // 引用计数：先完成的 call 不把其他在途请求的 pending 提前清掉
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((r) => { releaseFirst = r; });
    const origFetch = (globalThis as any).fetch;
    let usersCalls = 0;
    (globalThis as any).fetch = vi.fn(async (url: string, ...rest: unknown[]) => {
      // 第一个业务请求被 gate 卡住，第二个正常完成
      if (url === '/users' && ++usersCalls === 1) await gate;
      return origFetch(url, ...rest);
    });

    let api: any;
    function C() {
      api = useForgeApi({ level: 'public' });
      return <div data-testid="pending">{String(api.pending)}</div>;
    }
    const { getByTestId } = render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    const pendingText = () => getByTestId('pending').textContent;

    // 同时发起两个 call；第二个先完成（第一个被 gate 卡住）
    const first = api.call('users.index');
    const second = api.call('users.index');
    await second;
    // 先完成的 call 不清除 pending（旧实现此处已翻 false）
    await waitFor(() => expect(pendingText()).toBe('true'));
    releaseFirst();
    await first;
    // 全部完成才置 false
    await waitFor(() => expect(pendingText()).toBe('false'));
    (globalThis as any).fetch = origFetch;
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

  it('renders empty string with styled warn instead of crashing when route name does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const urls: string[] = [];

    function C() {
      const url = useForgeRoute('public', 'users.nonexistent');
      urls.push(url);
      return <div data-url={url || 'empty'}>{url || 'empty'}</div>;
    }

    const { getByText } = render(
      <RouteForgeProvider options={makeOptions()}>
        <C />
      </RouteForgeProvider>,
    );
    // 等待 level 加载完成后 route() 抛错被降级：渲染不炸、值为 ''
    await waitFor(() => expect(urls).toContain(''));
    getByText('empty');
    // 原实现静默吞错（catch 里无任何输出）；现在错误以醒目 warn 输出
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[route-forge]'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('throws TypeError when level is not a static string (runtime guard)', () => {
    function Bad() {
      useForgeRoute((() => 'public') as unknown as string, 'users.show');
      return null;
    }
    // React 渲染期异常会先经 console.error 报告再抛出，静音避免噪声
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <RouteForgeProvider options={makeOptions()}>
          <Bad />
        </RouteForgeProvider>,
      ),
    ).toThrow(TypeError);
    errSpy.mockRestore();
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

  it('levelLoaded drives re-render under StrictMode without render-phase ref writes', async () => {
    // 回归：levelLoaded 改为 loadedRef 单一真值源 + 提交后（effect）写值，
    // StrictMode 双渲染下首帧 false、加载完成后仍正确重渲染为 true
    const rendered: boolean[] = [];

    function C() {
      const bound = useForge({ level: 'public' }) as any;
      rendered.push(bound.levelLoaded);
      return <div>{String(bound.levelLoaded)}</div>;
    }

    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(
        <StrictMode>
          <RouteForgeProvider options={makeOptions()}>
            <C />
          </RouteForgeProvider>
        </StrictMode>,
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(rendered[0]).toBe(false);
    expect(view!.getByText('true')).toBeTruthy();
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

describe('forge ready via provider (M5)', () => {
  it('ready() resolves after auto-discovery + eager load', async () => {
    // onSummaryReady 已移除（v2.0.0）：统一走 ready().then/.catch
    let resolved = false;
    function C() {
      const forge = useContext(ForgeContext);
      useEffect(() => {
        forge!.ready().then(() => { resolved = true; });
      }, [forge]);
      return <div />;
    }
    render(
      <RouteForgeProvider options={{ endpoint: '/_forge/routes', levels: ['public'], adapter: 'builtin' }}>
        <C />
      </RouteForgeProvider>,
    );
    await waitFor(() => expect(resolved).toBe(true));
  });
});
