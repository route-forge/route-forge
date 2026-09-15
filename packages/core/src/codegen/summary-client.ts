/**
 * codegen 后端摘要 / 层级明细拉取（Node 环境，直接用全局 fetch）。
 *
 * 与运行时懒加载对齐：层级明细 URL 优先取摘要 `levels[].route.uri`（routeUri），
 * 缺省时回退 `endpoint/{level}` 兜底组合（等价于运行时 RouteStore.fetchLevel 的两分支）。
 */

import type { RouteMeta, SummaryResponse } from '../types.js';
import { joinBaseAndPath } from '../url-utils.js';

/** 拉取摘要端点（自动发现层级名 + 各层级 route.uri）。 */
export async function fetchSummary(endpoint: string): Promise<SummaryResponse> {
  const resp = await fetch(endpoint, { method: 'GET' });
  if (!resp.ok) {
    throw new Error(`summary endpoint ${endpoint} returned ${resp.status}`);
  }
  return (await resp.json()) as SummaryResponse;
}

/**
 * route.uri 是后端下发的绝对路径（如 `/_forge/routes/admin`）：
 * - endpoint 为绝对 URL（http(s)://host/...）→ 取其 origin 再拼 route.uri
 * - endpoint 为相对路径（无 origin，测试常用）→ route.uri 本身即完整路径，直接沿用
 */
function levelUrlFromUri(endpoint: string, uri: string): string {
  try {
    return joinBaseAndPath(new URL(endpoint).origin, uri);
  } catch {
    return uri;
  }
}

/**
 * 拉取单个层级的路由元信息。
 * @param routeUri 摘要 `levels[level].route.uri`（绝对路径）；缺省时回退 endpoint 拼接
 */
export async function fetchLevel(
  endpoint: string,
  level: string,
  routeUri?: string,
): Promise<{ routes: Record<string, RouteMeta> }> {
  const url = routeUri
    ? levelUrlFromUri(endpoint, routeUri)
    : `${endpoint.replace(/\/$/, '')}/${encodeURIComponent(level)}`;
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) {
    throw new Error(`level endpoint ${url} returned ${resp.status}`);
  }
  const data = (await resp.json()) as { routes?: Record<string, RouteMeta> };
  return { routes: data.routes ?? {} };
}
