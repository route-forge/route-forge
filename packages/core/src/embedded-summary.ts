/**
 * 页面内嵌摘要（Blade hydration）读取层（SPEC §4.1.1 / §3.1.8）。
 *
 * route-forge-laravel 的 `@forgeSummary` 指令在 SSR 的 HTML `<head>` 内，用
 * `Object.defineProperty(window, '__ROUTE_FORGE__', { get, enumerable:false, configurable:true })`
 * 注入一次性访问器：值 = 与摘要端点逐字段一致的 SummaryResponse，读后立即 `delete`。
 * 目的是让 core 在浏览器初始化时直接吃这份数据、省掉首屏的一次摘要 HTTP 往返。
 *
 * 本模块负责消费侧：读一次 + 触发全局自删 + module 级 memo 兜住"同页多实例"
 * （React StrictMode 双调用、第二个 RouteForgeProvider 会各自 new 一个 forge）。
 */

import type { SummaryResponse } from './types.js';

/** 与后端 route-forge-laravel `ForgeSummaryRenderer::GLOBAL_KEY` 对齐，勿单方面改。 */
export const EMBEDDED_GLOBAL_KEY = '__ROUTE_FORGE__';

/** undefined = 尚未读取；null = 无内嵌；对象 = 已读到的内嵌摘要。 */
let memo: SummaryResponse | null | undefined;

/**
 * 读取页面内嵌摘要。命中优先级由工厂决定（内嵌 > 配置 summary > 网络），本函数只负责"内嵌"这一层。
 * - 非浏览器（`typeof window === 'undefined'`）或无内嵌或值非对象 → 返回 null；
 * - 首次读取会触发后端注入的 getter（读后 `delete`，window 上不再残留）；结果 memo 化，
 *   后续同 realm 内再次调用直接复用缓存，解决多实例下的"一次性"冲突。
 */
export function readEmbeddedSummary(): SummaryResponse | null {
  if (memo !== undefined) return memo;
  if (typeof window === 'undefined') {
    memo = null;
    return null;
  }
  let raw: unknown;
  try {
    raw = (window as unknown as Record<string, unknown>)[EMBEDDED_GLOBAL_KEY];
  } catch {
    raw = undefined;
  }
  memo = raw !== null && typeof raw === 'object' ? (raw as SummaryResponse) : null;
  return memo;
}

/** 仅测试用：重置 memo，模拟新页面 / 新 JS realm。 */
export function __resetEmbeddedSummaryForTest(): void {
  memo = undefined;
}
