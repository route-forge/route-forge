/**
 * 页面内嵌摘要 hydration + 摘要数据源级联（SPEC §4.1.1 / §3.1.8）。
 *
 * 覆盖：
 *   - window.__ROUTE_FORGE__ 一次性访问器：core 读取后跳过摘要 HTTP；构造后 route() 同步可用
 *   - module 级 memo：同页多实例（消费删除后）仍能复用摘要
 *   - 级联优先级：内嵌 > 配置 summary 字段 > 网络；三者皆缺抛 TypeError
 *   - 层级懒加载 URL 取自摘要 levels[].route.uri（自定义 uri 优先于 endpoint_prefix 拼接）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteForge, UnknownLevelError } from '../src/index.js';
import { __resetEmbeddedSummaryForTest } from '../src/embedded-summary.js';
import type { SummaryResponse } from '../src/types.js';
import { makeSummary } from './fixtures.js';

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as any;
}

const publicTable = {
  level: 'public',
  routes: {
    'user.show': { name: 'user.show', uri: 'users/{user}', methods: ['GET'], parameters: ['user'] },
  },
};

/** 模拟后端 @forgeSummary：在 window 上定义一次性、不可枚举、读后自删的访问器。 */
function injectEmbedded(summary: SummaryResponse): { reads: () => number } {
  let reads = 0;
  (globalThis as any).window = {};
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
  return { reads: () => reads };
}

describe('embedded summary hydration (window.__ROUTE_FORGE__)', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalWindow: unknown;

  beforeEach(() => {
    __resetEmbeddedSummaryForTest();
    originalFetch = globalThis.fetch;
    originalWindow = (globalThis as any).window;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    if (originalWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('consumes embedded summary, skips summary HTTP; route()/load() work without endpoint', async () => {
    const embedded = injectEmbedded(
      makeSummary({ levels: { public: { description: 'public', load: 'lazy', route_count: 1 } } }),
    );
    let summaryRequested = false;
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/_forge/routes') summaryRequested = true;
      return jsonResponse(publicTable);
    });

    // 无 endpoint：靠内嵌摘要引导
    const forge = createRouteForge({ adapter: 'builtin', levels: ['public'] });
    expect(embedded.reads()).toBe(1); // 构造即读一次
    expect(summaryRequested).toBe(false); // 不发摘要请求

    await forge.load('public');
    expect(summaryRequested).toBe(false); // 层级懒加载同样不触发摘要请求
    expect(forge.route('public', 'user.show', { user: 7 })).toContain('users/7');
  });

  it('module memo: a second instance reuses embedded summary after the global self-deletes', async () => {
    const embedded = injectEmbedded(
      makeSummary({ levels: { public: { description: 'public', load: 'lazy', route_count: 1 } } }),
    );
    (globalThis as any).fetch = vi.fn(async () => jsonResponse(publicTable));

    const forge1 = createRouteForge({ adapter: 'builtin', levels: ['public'] });
    // 一次性 getter 已自删全局；第二个实例从 memo 取回，不再读全局、不抛 TypeError
    const forge2 = createRouteForge({ adapter: 'builtin', levels: ['public'] });

    expect(embedded.reads()).toBe(1); // 只有第一次读触发 getter
    await forge2.load('public');
    expect(forge2.route('public', 'user.show', { user: 1 })).toContain('users/1');
  });

  it('cascade precedence: embedded wins over explicit summary option', async () => {
    // 内嵌摘要只声明 public；显式 summary 字段声明 admin。内嵌优先 → admin 不可用。
    injectEmbedded(makeSummary({ levels: { public: { description: 'public', load: 'lazy', route_count: 1 } } }));
    (globalThis as any).fetch = vi.fn(async () => jsonResponse(publicTable));
    const forge = createRouteForge({
      adapter: 'builtin',
      summary: makeSummary({ levels: { admin: { description: 'admin', load: 'lazy', route_count: 1 } } }),
    });
    expect(forge.hasRoute('public', 'user.show')).toBe(false);
    await forge.load('public'); // 内嵌里的 public 层级可加载
    expect(forge.hasRoute('public', 'user.show')).toBe(true);
    await expect(forge.load('admin')).rejects.toThrow(UnknownLevelError); // 显式 summary 被内嵌覆盖
  });

  it('level fetch URL uses route.uri over endpoint_prefix+level', async () => {
    const summary = makeSummary({
      levels: {
        admin: {
          description: 'admin',
          load: 'lazy',
          route_count: 1,
          route: { uri: '/custom/admin-routes', methods: ['GET', 'HEAD'] }, // 刻意不等于 endpoint_prefix/admin
        },
      },
    });
    const calls: string[] = [];
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse({ level: 'admin', routes: { 'a.b': { name: 'a.b', uri: 'a/b', methods: ['GET'], parameters: [] } } });
    });
    const forge = createRouteForge({ endpoint: '/_forge/routes', summary, adapter: 'builtin' });
    await forge.load('admin');
    expect(calls).toContain('/custom/admin-routes');
    expect(calls).not.toContain('/_forge/routes/admin');
  });

  it('throws TypeError when embedded, summary option, and endpoint are all absent', () => {
    // 无 window 内嵌、无 summary、无 endpoint
    expect(() => createRouteForge({ adapter: 'builtin' })).toThrow(TypeError);
  });
});
