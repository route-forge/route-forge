/**
 * 生命周期与时序测试：自动发现 / ready / BoundForge / invalidate 竞态
 *
 * 覆盖审计项：
 *   - H3：invalidate() 失效代数——加载期间被 invalidate 后，在途响应不回写缓存
 *   - H4：后端将 unassigned 注册为真实层级时走 HTTP 拉取（不走虚拟层级）
 *   - H5：BoundForge.useRoutePrefix() 返回绑定新前缀的 BoundForge
 *   - H5b：前缀尾部 separator 归一化——prefix='users.' 拼接不产生 'users..x'
 *   - H6：ready() 回调重载；auto-discovery 失败时 ready 永不 resolve
 *   - H7：ready() 在 eager load 完成后才 resolve（onSummaryReady 已移除）
 *   - M4：schemaVersion > 1 告警
 *   - M7：请求前已 abort → 不发出业务请求
 *   - M8：ready() resolve 值为 forge 实例自身
 *   - M9：显式 eager 与后端 load:'eager' 取并集
 *   - L1：forge.use() 不传 level 返回自身引用
 *   - L2：BoundForge.isLoading / onLoadingChange
 *   - L3：onLevelLoaded 的 onRejected 分支（加载失败时）
 *   - L8：discovery 守卫豁免——load/isLoaded/invalidate 不受 RF_FE_010 影响
 *   - L10：unassigned 虚拟层级缓存使用前端 cache.ttl 兜底
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRouteForge,
  ForgeError,
  RequestAbortedError,
} from '../src/index.js';
import type { LevelRoutesResponse, SummaryResponse } from '../src/types.js';
import { makeSummary as normalizeSummary, type SummaryOverrides } from './fixtures.js';

function makeSummary(overrides: SummaryOverrides = {}): SummaryResponse {
  return normalizeSummary({
    levels: {
      public: { description: 'public', load: 'lazy', route_count: 2 },
      admin: { description: 'admin', load: 'eager', route_count: 1 },
    },
    ...overrides,
  });
}

const publicRoutes: LevelRoutesResponse = {
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

const adminRoutes: LevelRoutesResponse = {
  level: 'admin',
  routes: {
    'settings.index': { name: 'settings.index', uri: 'settings', methods: ['GET'], parameters: [] },
  },
};

/** 全功能 fetch mock：摘要 + 层级 + 业务请求（回显），可选层级延迟 */
function mockBackend(
  summary: SummaryResponse,
  levelRoutes: Record<string, LevelRoutesResponse>,
  opts: { levelGate?: Promise<void> } = {},
) {
  const calls: string[] = [];
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    const ep = summary.config.endpoint_prefix;
    if (url === ep) {
      return jsonResponse(summary);
    }
    if (url.startsWith(ep + '/')) {
      if (opts.levelGate) await opts.levelGate;
      const level = decodeURIComponent(url.slice(ep.length + 1).split('/')[0]!);
      const lr = levelRoutes[level];
      if (!lr) return jsonResponse({ message: 'not found' }, 404);
      return jsonResponse(lr);
    }
    // 业务请求回显
    return jsonResponse({ biz: true, url, method: init?.method ?? 'GET' });
  });
  return calls;
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as any;
}

// ─── 内存版 Storage 替身（node 环境无浏览器 storage，约定同 cache.test.ts） ───

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  (globalThis as any).localStorage = new FakeStorage();
});
afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  delete (globalThis as any).localStorage;
  vi.restoreAllMocks();
});

// ─── H3：invalidate 失效代数 ────────────────────────────────

describe('invalidate invalidation generation (H3)', () => {
  it('in-flight level response does not write back after invalidate during load', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const summary = makeSummary();
    const calls = mockBackend(summary, { public: publicRoutes }, { levelGate: gate });

    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    const loading = forge.load('public');
    // 等待层级请求真正发出（在途）
    await vi.waitFor(() => expect(calls).toContain('/_forge/routes/public'));
    // 在途期间失效
    forge.invalidate('public');
    release();
    await loading;
    // 旧响应不回写：仍未加载
    expect(forge.isLoaded('public')).toBe(false);

    // 再次加载：重新发起请求且成功
    await forge.load('public');
    expect(forge.isLoaded('public')).toBe(true);
    expect(calls.filter((u) => u === '/_forge/routes/public').length).toBe(2);
  });
});

// ─── H4：后端注册 unassigned 为真实层级 ─────────────────────

describe('unassigned as real backend level (H4)', () => {
  it('goes through HTTP fetch instead of virtual summary build', async () => {
    const summary = makeSummary({
      levels: {
        public: { description: 'public', load: 'lazy', cache: 300, route_count: 1 },
        unassigned: { description: 'unassigned', load: 'lazy', cache: null, route_count: 1 },
      },
      // 摘要里即使带 unassigned 数组，真实层级优先
      unassigned: [
        { name: 'should.not.use', uri: 'x', methods: ['GET'], parameters: [] },
      ],
    });
    const unassignedRoutes: LevelRoutesResponse = {
      level: 'unassigned',
      routes: {
        'legacy.page': { name: 'legacy.page', uri: 'legacy', methods: ['GET'], parameters: [] },
      },
    };
    const calls = mockBackend(summary, { public: publicRoutes, unassigned: unassignedRoutes });

    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'unassigned'],
      adapter: 'builtin',
    });
    await forge.load('unassigned');

    // 走了 HTTP 拉取（不是虚拟构建）
    expect(calls).toContain('/_forge/routes/unassigned');
    expect(forge.hasRoute('unassigned', 'legacy.page')).toBe(true);
    // 摘要里的未分配数组未被使用
    expect(forge.hasRoute('unassigned', 'should.not.use')).toBe(false);
  });
});

// ─── H5：useRoutePrefix ─────────────────────────────────────

describe('BoundForge.useRoutePrefix (H5)', () => {
  it('returns a new BoundForge bound to the same level with the given prefix', async () => {
    mockBackend(makeSummary(), { public: publicRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    const base = forge.use('public');
    const prefixed = base.useRoutePrefix('users');

    expect(prefixed.level).toBe('public');
    expect(prefixed.prefix).toBe('users');
    expect(prefixed).not.toBe(base);

    // 直接调用：后缀自动拼接前缀
    const result = (await prefixed('show', { user: 9 })) as any;
    expect(result.data.url).toBe('/users/9');
    // route() 同样生效
    await prefixed.load();
    expect(prefixed.route('index')).toBe('/users');
  });

  it('replaces an existing prefix rather than stacking', async () => {
    mockBackend(makeSummary(), { public: publicRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    const once = forge.use('public', 'users');
    const twice = once.useRoutePrefix('users');
    expect(twice.prefix).toBe('users');
    const result = (await twice('show', { user: 1 })) as any;
    expect(result.data.url).toBe('/users/1');
  });
});

// ─── H5b：前缀尾部 separator 归一化 ─────────────────────────

describe('BoundForge prefix trailing separator (H5b)', () => {
  async function makeBound(prefix: string) {
    mockBackend(makeSummary(), { public: publicRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    return forge.use('public', prefix);
  }

  it("prefix='users.' 时 api() 拼接不产生重复 separator", async () => {
    const bound = await makeBound('users.');
    const result = (await bound('show', { user: 9 })) as any;
    expect(result.data.url).toBe('/users/9');
  });

  it("prefix='users.' 时 route() 同步路径同样归一化", async () => {
    const bound = await makeBound('users.');
    await bound.load();
    expect(bound.route('index')).toBe('/users');
    expect(bound.route('show', { user: 2 })).toBe('/users/2');
  });

  it("尾 separator 的歧义回退仍成立（suffix 已含前缀）", async () => {
    const bound = await makeBound('users.');
    await bound.load();
    // suffix='users.index' 以归一化前缀 'users.' 开头 → 走消解回退命中自身
    expect(bound.route('users.index')).toBe('/users');
  });

  it('连续多个尾 separator 也被剥干净', async () => {
    const bound = await makeBound('users..');
    const result = (await bound('index')) as any;
    expect(result.data.url).toBe('/users');
  });

  it('空 suffix 返回归一化后的名字（错误中不含尾点）', async () => {
    const bound = await makeBound('users.');
    await bound.load();
    // 'users' 本身不是已注册路由 → 抛 UnknownRouteError；错误中的路由名不带尾点
    const err = await bound('').catch((e: unknown) => e);
    expect((err as { code: string }).code).toBe('RF_FE_001');
    expect((err as { route: string }).route).toBe('users');
  });
});

// ─── H6 / M8：ready() 语义 ──────────────────────────────────

describe('ready() semantics (H6 / M8)', () => {
  it('resolves with the forge instance itself (chainable)', async () => {
    mockBackend(makeSummary(), { public: publicRoutes, admin: adminRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'admin'],
      adapter: 'builtin',
    });
    const resolved = await forge.ready();
    expect(resolved).toBe(forge);
  });

  it('callback overloads fire with forge and still return Promise<forge>', async () => {
    mockBackend(makeSummary(), { public: publicRoutes, admin: adminRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'admin'],
      adapter: 'builtin',
    });
    const seen: unknown[] = [];
    const p = forge.ready((f) => { seen.push(f); });
    const result = await p;
    expect(seen).toEqual([forge]);
    expect(result).toBe(forge);
  });

  it('rejects with the original error when auto-discovery fails without explicit levels', async () => {
    // fetch 直接网络错误且未传 levels → summaryPromise 抛 UnknownLevelError → ready() reject
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const onFulfilled = vi.fn();
    const onRejected = vi.fn();
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      adapter: 'builtin',
    });
    // 回调重载：onRejected 分支触发并携带原始错误
    void forge.ready(onFulfilled, onRejected);
    await new Promise((r) => setTimeout(r, 50));
    expect(onFulfilled).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledTimes(1);
    // 无参模式：reject 携带错误（不再永久挂起）
    await expect(forge.ready()).rejects.toThrow();
    // 错误在 load 调用时同样重新抛出（不丢失）
    await expect(forge.load('public')).rejects.toThrow();
  });

  it('rejects when summary endpoint returns non-2xx without explicit levels', async () => {
    // 摘要端点 HTTP 500 且无显式 levels → 无可用降级，ready() reject（原行为是谎报 resolve）
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => '',
      headers: new Headers(),
    }));
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      adapter: 'builtin',
    });
    await expect(forge.ready()).rejects.toThrow();
  });

  it('eager load failure does not block ready, and direct calls retry then throw', async () => {
    // eager 层级加载失败：ready 仍 resolve，异常以 console.error 抛出；
    // 失败不缓存——直接调用 load()/api() 时重试，再失败向调用方抛出
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let levelFetchCalls = 0;
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/_forge/routes') {
        const summary = makeSummary(); // admin 为 eager
        return {
          ok: true, status: 200,
          json: async () => summary,
          text: async () => JSON.stringify(summary),
          headers: new Headers({ 'content-type': 'application/json' }),
        } as any;
      }
      // admin 层级拉取始终失败
      levelFetchCalls++;
      return {
        ok: false, status: 500,
        json: async () => ({}),
        text: async () => '',
        headers: new Headers(),
      } as any;
    });

    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      adapter: 'builtin',
    });
    // eager 失败不阻塞：ready 照常 resolve
    const resolved = await forge.ready();
    expect(resolved).toBe(forge);
    // 异常已抛出到控制台（含层级名）
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('eager load failed for level "admin"'),
      expect.any(Error),
    );
    expect(levelFetchCalls).toBe(1);
    // 开发者忽略异常后直接调用：重试加载（再次发请求），再失败时向调用方抛出
    await expect(forge.load('admin')).rejects.toThrow();
    expect(levelFetchCalls).toBe(2);
    error.mockRestore();
  });
});

// ─── H7：ready() 时序（onSummaryReady 已移除，统一走 ready） ──

describe('ready() timing (H7)', () => {
  it('resolves only after discovery AND eager levels are loaded', async () => {
    mockBackend(makeSummary(), { public: publicRoutes, admin: adminRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'admin'],
      adapter: 'builtin',
    });
    await forge.ready();
    // ready resolve 后：eager 层级（admin）必然已完成加载；lazy 层级（public）未被触发
    // （旧 onSummaryReady 在 eager 之前触发，挂载场景下反而是坑——见 v2.0.0 变更记录）
    expect(forge.isLoaded('admin')).toBe(true);
    expect(forge.isLoaded('public')).toBe(false);
  });
});

// ─── M4 / M9：schemaVersion 告警与 eager 并集 ───────────────

describe('summary edge behaviors (M4 / M9)', () => {
  it('schemeVersion > 1 warns about forward compatibility', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockBackend(makeSummary({ schemaVersion: 2 }), { public: publicRoutes, admin: adminRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'admin'],
      adapter: 'builtin',
    });
    await forge.ready();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('schemeVersion=2'));
    warn.mockRestore();
  });

  it('explicit eager merges with backend load:eager levels (union)', async () => {
    mockBackend(makeSummary(), { public: publicRoutes, admin: adminRoutes });
    // 后端 eager: admin；前端显式追加 public
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public', 'admin'],
      eager: ['public'],
      adapter: 'builtin',
    });
    await forge.ready();
    expect(forge.isLoaded('admin')).toBe(true);
    expect(forge.isLoaded('public')).toBe(true);
  });
});

// ─── M7：abort 短路 ─────────────────────────────────────────

describe('abort short-circuit (M7)', () => {
  it('abort() before dispatch prevents the business request entirely', async () => {
    const summary = makeSummary();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const calls = mockBackend(summary, { public: publicRoutes }, { levelGate: gate });

    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    const req = forge.api('public', 'users.show', { user: 5 });
    // 层级加载仍在途时取消
    req.abort();
    // 放行层级加载：恢复后 api 应在发业务请求前检查 signal 并短路
    release();
    await expect(req).rejects.toBeInstanceOf(RequestAbortedError);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).not.toContain('/users/5');
  });
});

// ─── L1 / L2：use() 自身返回与 BoundForge loading ───────────

describe('BoundForge misc (L1 / L2)', () => {
  it('forge.use() without level returns the forge instance itself', () => {
    mockBackend(makeSummary(), { public: publicRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    expect(forge.use()).toBe(forge);
  });

  it('bound isLoading / onLoadingChange track business requests', async () => {
    mockBackend(makeSummary(), { public: publicRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    const bound = forge.use('public');
    expect(bound.isLoading()).toBe(false);
    const events: boolean[] = [];
    const unsub = bound.onLoadingChange((e) => events.push(e.loading));
    await bound('users.index');
    expect(events).toEqual([true, false]);
    expect(bound.isLoading()).toBe(false);
    unsub();
  });
});

// ─── L3：onLevelLoaded onRejected ───────────────────────────

describe('onLevelLoaded failure branch (L3)', () => {
  it('onRejected fires when level load fails; callback form still resolves with bound', async () => {
    // 层级拉取 500 → load reject
    const summary = makeSummary();
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      const ep = summary.config.endpoint_prefix;
      if (url === ep) return jsonResponse(summary);
      return jsonResponse({ message: 'boom' }, 500);
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    const bound = forge.use('public');
    const onRejected = vi.fn();
    const result = await bound.onLevelLoaded(() => {}, onRejected);
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(result).toBe(bound);
    // Promise 形式：reject 可被捕获
    const bound2 = forge.use('public');
    await expect(bound2.onLevelLoaded()).rejects.toThrow();
  });
});

// ─── L8：discovery 守卫豁免 ─────────────────────────────────

describe('discovery guard exemptions (L8)', () => {
  it('load/isLoaded/invalidate never throw RF_FE_010; route() still guards', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/_forge/routes') {
        await gate;
        return jsonResponse(makeSummary());
      }
      if (url === '/_forge/routes/public') return jsonResponse(publicRoutes);
      return jsonResponse({ biz: true }, 200);
    });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      adapter: 'builtin',
    });
    // discovery 未完成：这些方法不抛守卫错误
    expect(() => forge.isLoaded('public')).not.toThrow();
    expect(() => forge.invalidate()).not.toThrow();
    const loadPromise = forge.load('public'); // 等待 discovery 后加载
    // route() 同步守卫仍然生效
    try {
      forge.route('public', 'users.index');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ForgeError);
      expect((e as ForgeError).code).toBe('RF_FE_010');
    }
    release();
    await loadPromise;
    expect(forge.route('public', 'users.index')).toBe('/users');
  });
});

// ─── L10：层级缓存 TTL 来自摘要 config.cache_ttl ────────────

describe('level cache TTL from summary config.cache_ttl (L10)', () => {
  it('positive cache_ttl writes storage ttl = min(backend, frontend fallback)', async () => {
    const summary = makeSummary({
      config: { strict_mode: false, endpoint_prefix: '/_forge/routes', cache_ttl: 5000 },
    });
    mockBackend(summary, { public: publicRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      cache: { storage: 'localStorage', ttl: 1234 },
    });
    await forge.load('public');
    // 后端为上限，前端兜底更短 → 取前端 1234
    const raw = JSON.parse(localStorage.getItem('route-forge:public')!);
    expect(raw.ttl).toBe(1234);
    expect(raw.routes['users.index']).toBeDefined();
  });

  it('cache_ttl=null（不缓存）只留内存镜像、不写 storage', async () => {
    const summary = makeSummary({
      config: { strict_mode: false, endpoint_prefix: '/_forge/routes', cache_ttl: null },
    });
    mockBackend(summary, { public: publicRoutes });
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
      cache: { storage: 'localStorage', ttl: 1234 },
    });
    await forge.load('public');
    expect(forge.hasRoute('public', 'users.index')).toBe(true); // 内存可读
    expect(localStorage.getItem('route-forge:public')).toBeNull(); // 不落存储
  });
});
