/**
 * revalidate（强制刷新，无空窗）+ onRoutesChange（数据版本订阅）行为测试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouteForge, HTTPError, type RouteForge } from '../src/index.js';
import type { RouteMeta, SummaryResponse } from '../src/types.js';
import { makeSummary } from './fixtures.js';

interface Harness {
  forge: RouteForge;
  /** 各层级被 HTTP 拉取的次数 */
  fetchCounts: Record<string, number>;
  /** 修改服务端下发的某层级路由表（模拟后端更新） */
  setServerRoutes: (level: string, routes: Record<string, RouteMeta>) => void;
  /** 让某层级下一次拉取返回 500（模拟刷新失败） */
  failNextFetch: (level: string) => void;
  json: (data: unknown, status?: number) => unknown;
}

function meta(name: string, uri: string): RouteMeta {
  return { name, uri, methods: ['GET'], parameters: [] };
}

function makeHarness(summaryLevels: string[]): Harness {
  const serverRoutes: Record<string, Record<string, RouteMeta>> = {};
  for (const lvl of summaryLevels) serverRoutes[lvl] = {};
  const fetchCounts: Record<string, number> = {};
  const failOnce = new Set<string>();

  const summary: SummaryResponse = makeSummary({
    levels: Object.fromEntries(summaryLevels.map((l) => [l, { description: l, load: 'lazy', route_count: 1 }])),
  });

  const json = (data: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'content-type': 'application/json' }),
  });

  (globalThis as any).fetch = vi.fn(async (url: string) => {
    if (url === summary.config.endpoint_prefix) return json(summary);
    const lvl = summaryLevels.find((l) => url === `/_forge/routes/${l}`);
    if (lvl) {
      fetchCounts[lvl] = (fetchCounts[lvl] ?? 0) + 1;
      if (failOnce.has(lvl)) {
        failOnce.delete(lvl);
        return json({}, 500);
      }
      return json({ level: lvl, routes: serverRoutes[lvl] });
    }
    return json({}, 404);
  });

  const forge = createRouteForge({ summary, levels: summaryLevels, adapter: 'builtin' });

  return {
    forge,
    fetchCounts,
    json,
    setServerRoutes: (level, routes) => {
      serverRoutes[level] = routes;
    },
    failNextFetch: (level) => failOnce.add(level),
  };
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('revalidate（强制刷新，无空窗）', () => {
  it('load 命中缓存后短路；revalidate 绕过短路重新拉取并覆盖', async () => {
    const h = makeHarness(['public']);
    h.setServerRoutes('public', { 'a': meta('a', 'a-v1') });
    await h.forge.load('public');
    expect(h.forge.route('public', 'a')).toBe('/a-v1');
    expect(h.fetchCounts.public).toBe(1);

    // 再次 load：命中缓存短路，不再发请求
    await h.forge.load('public');
    expect(h.fetchCounts.public).toBe(1);

    // 后端更新
    h.setServerRoutes('public', { 'a': meta('a', 'a-v2') });
    await h.forge.revalidate('public');
    expect(h.fetchCounts.public).toBe(2); // revalidate 强制重拉
    expect(h.forge.route('public', 'a')).toBe('/a-v2'); // 缓存被覆盖
  });

  it('刷新失败 → reject 且保留旧缓存（无空窗）', async () => {
    const h = makeHarness(['public']);
    h.setServerRoutes('public', { 'a': meta('a', 'a-v1') });
    await h.forge.load('public');

    h.failNextFetch('public'); // 下一次拉取 500
    await expect(h.forge.revalidate('public')).rejects.toBeInstanceOf(HTTPError);

    // 旧数据仍在（revalidate 不清空、失败不覆盖）
    expect(h.forge.route('public', 'a')).toBe('/a-v1');
    expect(h.forge.isLoaded('public')).toBe(true);
  });

  it('并发 revalidate 去重：同一层级只发一次请求', async () => {
    const h = makeHarness(['public']);
    h.setServerRoutes('public', { 'a': meta('a', 'a-v1') });
    await h.forge.revalidate('public');
    const before = h.fetchCounts.public ?? 0;
    await Promise.all([h.forge.revalidate('public'), h.forge.revalidate('public')]);
    expect(h.fetchCounts.public).toBe(before + 1); // 两个并发合并为一次
  });

  it('revalidate 支持多层级数组', async () => {
    const h = makeHarness(['public', 'admin']);
    h.setServerRoutes('public', { p: meta('p', 'p1') });
    h.setServerRoutes('admin', { a: meta('a', 'a1') });
    await h.forge.revalidate(['public', 'admin']);
    expect(h.fetchCounts.public).toBe(1);
    expect(h.fetchCounts.admin).toBe(1);
  });
});

describe('onRoutesChange（数据版本订阅）', () => {
  it('load 提交 / revalidate 提交 / invalidate 各广播变更层级', async () => {
    const h = makeHarness(['public', 'admin']);
    const seen: string[] = [];
    const unsub = h.forge.onRoutesChange((lvl) => seen.push(lvl));

    await h.forge.load('public'); // 首次写入 → public
    h.setServerRoutes('public', { 'a': meta('a', 'a2') });
    await h.forge.revalidate('public'); // 刷新写入 → public
    h.forge.invalidate('admin'); // 失效 → admin（合批：下一个微任务投递）
    await Promise.resolve(); // 让 invalidate 的微任务 flush 先执行

    expect(seen).toEqual(['public', 'public', 'admin']);
    unsub();
  });

  it('unsubscribe 后不再收到广播', async () => {
    const h = makeHarness(['public']);
    let n = 0;
    const unsub = h.forge.onRoutesChange(() => n++);
    await h.forge.load('public');
    const afterLoad = n;
    unsub();
    h.setServerRoutes('public', { 'a': meta('a', 'x') });
    await h.forge.revalidate('public');
    expect(n).toBe(afterLoad); // 取消订阅后 revalidate 不再触达
  });

  it('revalidate 失败不发广播（未提交）', async () => {
    const h = makeHarness(['public']);
    h.setServerRoutes('public', { 'a': meta('a', 'a1') });
    await h.forge.load('public');
    let n = 0;
    h.forge.onRoutesChange(() => n++);
    h.failNextFetch('public');
    await expect(h.forge.revalidate('public')).rejects.toBeInstanceOf(HTTPError);
    expect(n).toBe(0); // 失败未写入 → 不通知
  });

  it('同 tick 并发 revalidate 同一层级：合批后只投一次', async () => {
    const h = makeHarness(['public']);
    h.setServerRoutes('public', { 'a': meta('a', 'a1') });
    await h.forge.load('public');
    const seen: string[] = [];
    h.forge.onRoutesChange((lvl) => seen.push(lvl));
    // 同一 tick 并发多次 revalidate → 共享 inflight，仅一次提交、仅一次通知
    await Promise.all([
      h.forge.revalidate('public'),
      h.forge.revalidate('public'),
      h.forge.revalidate('public'),
    ]);
    await Promise.resolve(); // flush
    expect(seen).toEqual(['public']);
    expect(h.fetchCounts.public).toBe(2); // load 1 次 + revalidate 合并为 1 次
  });
});
