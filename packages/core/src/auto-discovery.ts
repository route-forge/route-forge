/**
 * 自动发现（SPEC §4.1.1 + §5.3）：从后端摘要端点折算出前端运行时有效配置。
 *
 * 摘要端点回填的有效值（endpoint / urlPrefix / levels / eager / 虚拟 unassigned
 * 层级）集中在一个可变的 DiscoveryState 上，由工厂持有并在后续按属性实时读取，
 * 避免按值快照冻结自动发现结果。
 *
 * 本模块只提供纯计算函数（fetchSummary / applySummaryToState），
 * 不介入工厂的启动时序（由工厂侧的 whenSummary 挂起队列 + 微任务启动负责）。
 */

import { UnknownLevelError } from './errors.js';
import type { SummaryResponse } from './types.js';

/**
 * 后端摘要端点返回的未分配层级路由，前端作为虚拟层级 "unassigned" 消费
 * @see .docs/SPEC.md §3.1.6
 */
export const UNASSIGNED_LEVEL = 'unassigned';

/** 自动发现回填的有效状态（工厂持有并实时读取） */
export interface DiscoveryState {
  /** 可用层级 = 后端真实层级（∩ 显式 levels）+ 虚拟 unassigned 层级 */
  levels: string[];
  /** 需预加载的 eager 层级 */
  eager: string[];
  /** 层级路由表端点前缀（后端 endpoint_prefix 权威覆盖） */
  endpoint: string;
  /** 后端下发的 URL 前缀，生成业务 URL 时拼接（默认为空） */
  urlPrefix: string;
  /** 摘要端点的 unassigned 路由；仅虚拟层级启用时有值 */
  summaryUnassigned?: SummaryResponse['unassigned'];
  /** 后端是否将 unassigned 作为真实层级注册；若是则走正常 HTTP 拉取，不走虚拟层级 */
  backendHasUnassignedLevel: boolean;
}

/** 用户显式声明的发现输入 */
export interface DiscoveryInputs {
  explicitLevels?: string[];
  explicitEager?: string[];
  explicitEndpoint: string;
}

/** 元信息拉取通道（由工厂注入 fetchMeta：走 adapter 原始通道，获得 timeout/降级/自定义 Fetcher 兼容） */
export type MetaFetcher = (routeTag: string, url: string, level?: string) => Promise<unknown>;

/**
 * 拉取摘要端点（用于 endpoint / levels / eager 自动发现）。
 * URL = baseURL + 显式 endpoint（此时后端权威 endpoint 尚未获取，用用户显式配置）。
 * 失败语义：显式传了 levels → 降级（warn + 返回 null，effective* 保持显式初值）；
 * 未传 levels → 无可用降级，抛 UnknownLevelError（ready() 将 reject）。
 */
export async function fetchSummary(
  inputs: DiscoveryInputs,
  baseURL: string,
  fetchMeta: MetaFetcher,
): Promise<SummaryResponse | null> {
  const { explicitLevels, explicitEndpoint } = inputs;
  try {
    const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const ep = explicitEndpoint.startsWith('/') ? explicitEndpoint : `/${explicitEndpoint}`;
    const data = await fetchMeta('__forge__.summary', `${base}${ep}`);
    return data as SummaryResponse;
  } catch (e) {
    if (explicitLevels && explicitLevels.length > 0) {
      console.warn(
        `[route-forge] summary endpoint unreachable: ${(e as Error).message}; using explicit levels`,
      );
      return null;
    }
    throw new UnknownLevelError('(auto-discovery)');
  }
}

/**
 * 把摘要响应折算进可变的 state（就地写回 endpoint/urlPrefix/levels/eager/unassigned）。
 * summary 为 null（显式 levels 降级路径）时由调用方短路，不进入此函数。
 */
export function applySummaryToState(
  summary: SummaryResponse,
  state: DiscoveryState,
  inputs: DiscoveryInputs,
): void {
  const { explicitLevels, explicitEager, explicitEndpoint } = inputs;

  // 0. schemaVersion 向前兼容（DESIGN.md §6.3）
  const schemaVersion = summary.schemaVersion ?? 1;
  if (schemaVersion > 1) {
    console.warn(
      `[route-forge] backend schemaVersion=${schemaVersion} > client supported 1; some features may be unavailable`,
    );
  }

  // 1. endpoint 后端权威
  if (summary.config.endpoint_prefix && summary.config.endpoint_prefix !== explicitEndpoint) {
    console.warn(
      `[route-forge] backend endpoint_prefix "${summary.config.endpoint_prefix}" overrides frontend endpoint "${explicitEndpoint}"`,
    );
    state.endpoint = summary.config.endpoint_prefix;
  }

  // 1a. url_prefix 后端权威：后端下发时覆盖
  if (summary.config.url_prefix) {
    state.urlPrefix = summary.config.url_prefix.endsWith('/')
      ? summary.config.url_prefix.slice(0, -1)
      : summary.config.url_prefix;
  }

  // 2. levels 取交集或自动发现
  const backendLevels = Object.keys(summary.levels);

  // 3a. 捕获摘要端点的 unassigned 字段，作为虚拟层级 "unassigned" 消费（SPEC §3.1.6）
  // 仅当后端未将 unassigned 作为真实层级注册时才启用虚拟层级
  state.backendHasUnassignedLevel = backendLevels.includes(UNASSIGNED_LEVEL);
  if (
    Array.isArray(summary.unassigned) &&
    summary.unassigned.length > 0 &&
    !state.backendHasUnassignedLevel
  ) {
    state.summaryUnassigned = summary.unassigned;
  }

  // 可用层级 = 后端真实层级 + 虚拟 unassigned 层级（若有未分配路由）
  const availableLevels = backendLevels.slice();
  if (state.summaryUnassigned && !state.backendHasUnassignedLevel) {
    availableLevels.push(UNASSIGNED_LEVEL);
  }

  if (explicitLevels && explicitLevels.length > 0) {
    const intersection = explicitLevels.filter((l) => availableLevels.includes(l));
    const removed = explicitLevels.filter((l) => !availableLevels.includes(l));
    if (removed.length > 0) {
      console.warn(
        `[route-forge] levels not in backend summary and dropped: ${removed.join(', ')}`,
      );
    }
    state.levels = intersection;
  } else {
    state.levels = availableLevels;
  }

  // 4. eager：未传时取后端 load:'eager' 层级；显式传入时取并集（SPEC §5.3）
  const backendEager = backendLevels.filter((lvl) => summary.levels[lvl]?.load === 'eager');
  if (!explicitEager) {
    state.eager = backendEager;
  } else {
    // 并集：后端 eager + 前端显式声明，去重
    const union = new Set([...backendEager, ...explicitEager]);
    state.eager = [...union];
  }
}
