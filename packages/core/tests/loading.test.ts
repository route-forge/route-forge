import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import type { LoadingChangeEvent } from '../src/loading.js';
import { LoadingTracker } from '../src/loading.js';
import { createRouteForge } from '../src/index.js';
import type { LevelRoutesResponse, SummaryResponse } from '../src/types.js';
import { makeSummary as normalizeSummary, type SummaryOverrides } from './fixtures.js';

// ─── LoadingTracker 单元测试 ────────────────────────────────────────────────────

describe('LoadingTracker', () => {
  it('starts with no active loading', () => {
    const tracker = new LoadingTracker();
    expect(tracker.isLoading()).toBe(false);
    expect(tracker.getCount()).toBe(0);
  });

  it('start increments count and triggers subscribers', () => {
    const tracker = new LoadingTracker();
    const events: LoadingChangeEvent[] = [];
    tracker.subscribe((e) => events.push(e));

    tracker.start();

    expect(tracker.isLoading()).toBe(true);
    expect(tracker.getCount()).toBe(1);
    expect(events).toEqual([{ loading: true, count: 1 }]);
  });

  it('multiple starts accumulate count', () => {
    const tracker = new LoadingTracker();
    tracker.start();
    tracker.start();

    expect(tracker.getCount()).toBe(2);
    expect(tracker.isLoading()).toBe(true);
  });

  it('stop decrements count', () => {
    const tracker = new LoadingTracker();
    tracker.start();
    tracker.start();
    tracker.stop();

    expect(tracker.getCount()).toBe(1);
    expect(tracker.isLoading()).toBe(true);
  });

  it('stop to zero clears and notifies loading=false', () => {
    const tracker = new LoadingTracker();
    const events: LoadingChangeEvent[] = [];
    tracker.subscribe((e) => events.push(e));

    tracker.start();
    tracker.stop();

    expect(tracker.getCount()).toBe(0);
    expect(tracker.isLoading()).toBe(false);
    expect(events[1]).toEqual({ loading: false, count: 0 });
  });

  it('stop below zero clamps to zero', () => {
    const tracker = new LoadingTracker();
    tracker.stop();
    expect(tracker.getCount()).toBe(0);
    expect(tracker.isLoading()).toBe(false);
  });

  it('subscribe returns unsubscribe function', () => {
    const tracker = new LoadingTracker();
    const events: LoadingChangeEvent[] = [];
    const unsub = tracker.subscribe((e) => events.push(e));

    tracker.start();
    expect(events.length).toBe(1);

    unsub();
    tracker.stop();
    expect(events.length).toBe(1); // no more events
  });

  it('subscriber exception does not affect others', () => {
    const tracker = new LoadingTracker();
    const events: LoadingChangeEvent[] = [];

    tracker.subscribe(() => {
      throw new Error('bad');
    });
    tracker.subscribe((e) => events.push(e));

    tracker.start();
    expect(events.length).toBe(1);
  });
});

// ─── forge 集成测试 ─────────────────────────────────────────────────────────────

// Helper: 模拟摘要端点响应
function makeSummary(overrides: SummaryOverrides = {}): SummaryResponse {
  return normalizeSummary({
    levels: {
      public: { description: 'public', load: 'lazy', route_count: 1 },
    },
    ...overrides,
  });
}

// Helper: 同时 mock 摘要端点与层级路由拉取 + api 调用
function mockFull(
  summary: SummaryResponse,
  levelRoutes: Record<string, LevelRoutesResponse>,
) {
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const ep = summary.config.endpoint_prefix;
    if (url === ep) {
      const body = JSON.stringify(summary);
      return {
        ok: true, status: 200,
        json: async () => summary,
        text: async () => body,
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    }
    if (url.startsWith(ep + '/')) {
      const level = url.slice(ep.length + 1).split('/')[0]!.split('?')[0]!;
      const lr = levelRoutes[level];
      if (!lr) {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => '',
          headers: new Headers(),
        } as any;
      }
      const body = JSON.stringify(lr);
      return {
        ok: true, status: 200,
        json: async () => lr,
        text: async () => body,
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    }
    // api() 调用：返回 200
    return {
      ok: true, status: 200,
      json: async () => ({ success: true }),
      text: async () => JSON.stringify({ success: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as any;
  });
}

describe('forge loading integration', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const summary = makeSummary();
  const publicRoutes = {
    public: {
      level: 'public',
      routes: {
        'users.index': {
          name: 'users.index',
          uri: 'users',
          methods: ['GET'],
          parameters: [],
        },
      },
    },
  };

  it('always tracks loading state without config', async () => {
    mockFull(summary, publicRoutes);
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');

    const events: LoadingChangeEvent[] = [];
    forge.onLoadingChange((e) => events.push(e));

    await forge.api('public', 'users.index');

    // start + stop = 2 events
    expect(events.length).toBe(2);
    expect(events[0]).toEqual({ loading: true, count: 1 });
    expect(events[1]).toEqual({ loading: false, count: 0 });
    expect(forge.isLoading()).toBe(false);
  });

  it('loading stops even when request fails', async () => {
    // Mock: api 调用返回 500
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      const ep = summary.config.endpoint_prefix;
      if (url === ep) {
        const body = JSON.stringify(summary);
        return {
          ok: true,
          status: 200,
          json: async () => summary,
          text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      if (url.startsWith(ep + '/')) {
        const level = url.slice(ep.length + 1).split('/')[0]!.split('?')[0]!;
        const lr = publicRoutes[level as keyof typeof publicRoutes];
        if (!lr) return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => '',
          headers: new Headers(),
        } as any;
        const body = JSON.stringify(lr);
        return {
          ok: true,
          status: 200,
          json: async () => lr,
          text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      // api 调用返回 500
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => '',
        headers: new Headers(),
      } as any;
    });

    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');

    const events: LoadingChangeEvent[] = [];
    forge.onLoadingChange((e) => events.push(e));

    await expect(forge.api('public', 'users.index')).rejects.toThrow();

    // start + stop 都应该触发
    expect(events.length).toBe(2);
    expect(events[0]!.loading).toBe(true);
    expect(events[1]!.loading).toBe(false);
    expect(forge.isLoading()).toBe(false);
  });

  it('concurrent requests accumulate count correctly', async () => {
    let resolveFetch!: () => void;
    const fetchPromise = new Promise<void>((r) => {
      resolveFetch = r;
    });

    (globalThis as any).fetch = vi.fn(async (url: string) => {
      const ep = summary.config.endpoint_prefix;
      if (url === ep) {
        const body = JSON.stringify(summary);
        return {
          ok: true,
          status: 200,
          json: async () => summary,
          text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      if (url.startsWith(ep + '/')) {
        const level = url.slice(ep.length + 1).split('/')[0]!.split('?')[0]!;
        const lr = publicRoutes[level as keyof typeof publicRoutes];
        if (!lr) return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => '',
          headers: new Headers(),
        } as any;
        const body = JSON.stringify(lr);
        return {
          ok: true,
          status: 200,
          json: async () => lr,
          text: async () => body,
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      // 阻塞直到手动 resolve
      await fetchPromise;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '{"ok":true}',
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    });

    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');

    const events: LoadingChangeEvent[] = [];
    forge.onLoadingChange((e) => events.push(e));

    // 并发两个请求
    const p1 = forge.api('public', 'users.index');
    const p2 = forge.api('public', 'users.index');
    // 等待所有微任务排空，确保 loadingTracker.start() 已执行
    await setTimeoutAsync(0);

    // 此时两个请求都在进行中
    expect(events.length).toBe(2);
    expect(events[0]).toEqual({ loading: true, count: 1 });
    expect(events[1]).toEqual({ loading: true, count: 2 });
    expect(forge.isLoading()).toBe(true);

    // 解除阻塞
    resolveFetch();
    await Promise.all([p1, p2]);

    // 两个请求都结束
    expect(events.length).toBe(4);
    expect(events[2]).toEqual({ loading: true, count: 1 });
    expect(events[3]).toEqual({ loading: false, count: 0 });
    expect(forge.isLoading()).toBe(false);
  });

  it('onLoadingChange unsubscribe stops notifications', async () => {
    mockFull(summary, publicRoutes);
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await forge.load('public');

    const events: LoadingChangeEvent[] = [];
    const unsub = forge.onLoadingChange((e) => events.push(e));

    await forge.api('public', 'users.index');
    expect(events.length).toBe(2);

    unsub();
    await forge.api('public', 'users.index');
    expect(events.length).toBe(2); // 不再收到事件
  });
});
