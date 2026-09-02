/**
 * 自动发现（SPEC §4.1.1 + §5.3）：把摘要（网络拉取 / 页面内嵌 / 配置直供）折算出前端运行时有效配置。
 *
 * 摘要折算出的有效值（endpoint 兜底前缀 / urlPrefix / levels / eager / 各层级 route.uri / 全局 cache_ttl）
 * 集中在一个可变的 DiscoveryState 上，由工厂持有并在后续按属性实时读取，避免按值快照冻结结果。
 *
 * 本模块只提供纯计算函数（fetchSummary / applySummaryToState），不介入工厂启动时序。
 */

import { UnknownLevelError } from './errors.js';
import type { SummaryResponse } from './types.js';

/**
 * 特殊层级名：未命中任何层级的命名路由归此层级。后端始终在摘要 `levels` 中注入该层级，
 * 前端按其 route.uri 走正常 HTTP 懒加载（不再是"从顶层数组建虚拟层级"）。
 * @see .docs/SPEC.md §3.1.6
 */
export const UNASSIGNED_LEVEL = 'unassigned';

/** 层级明细端点自描述（来自摘要 levels[].route） */
export interface LevelRouteDescriptor {
  uri: string;
  methods: string[];
}

/** 摘要折算后的有效状态（工厂持有并实时读取） */
export interface DiscoveryState {
  /** 可用层级 = 后端真实层级（∩ 显式 levels）；含恒存在的 unassigned 层级 */
  levels: string[];
  /** 需预加载的 eager 层级 */
  eager: string[];
  /** 摘要/层级端点兜底前缀（后端 endpoint_prefix 权威覆盖）；层级懒加载优先用 levelRoutes[].uri */
  endpoint: string;
  /** 后端下发的 URL 前缀，生成业务 URL 时拼接（默认为空） */
  urlPrefix: string;
  /**
   * 全局缓存 TTL（秒），来自摘要 config.cache_ttl：
   * null = 不缓存；0 = 永久；正整数 = N 秒；undefined = 后端未下发该字段（用前端兜底 TTL）。
   */
  cacheTtl: number | null | undefined;
  /** 各层级明细端点自描述（level → {uri, methods}），供懒加载拼 URL */
  levelRoutes: Record<string, LevelRouteDescriptor>;
}

/** 用户显式声明的发现输入 */
export interface DiscoveryInputs {
  explicitLevels?: string[];
  explicitEager?: string[];
  /** 网络拉取来源时用户显式配置的摘要端点；内嵌/配置摘要下可为 undefined */
  explicitEndpoint: string | undefined;
}

/** 元信息拉取通道（由工厂注入 fetchMeta：走 adapter 原始通道，获得 timeout/降级/自定义 Fetcher 兼容） */
export type MetaFetcher = (routeTag: string, url: string, level?: string) => Promise<unknown>;

/**
 * 拉取摘要端点（网络级联来源）。URL = baseURL + 显式 endpoint。
 * 失败语义：显式传了 levels → 降级（warn + 返回 null，effective* 保持显式初值）；
 * 未传 levels → 无可用降级，抛 UnknownLevelError（ready() 将 reject）。
 */
export async function fetchSummary(
  inputs: DiscoveryInputs,
  baseURL: string,
  fetchMeta: MetaFetcher,
): Promise<SummaryResponse | null> {
  const { explicitLevels, explicitEndpoint } = inputs;
  if (!explicitEndpoint) {
    // 网络拉取要求有 endpoint；无 endpoint 的引导（内嵌/配置摘要）不会走到这里
    throw new UnknownLevelError('(auto-discovery)');
  }
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

/** config.cache_ttl 归一：负值降级为不缓存（null），与后端 RouteCache 口径一致。 */
function normalizeCacheTtl(raw: number | null | undefined): number | null | undefined {
  if (typeof raw === 'number' && raw < 0) return null;
  return raw;
}

/**
 * 把摘要折算进可变的 state（就地写回 endpoint/urlPrefix/levels/eager/levelRoutes/cacheTtl）。
 * 摘要来源可为网络拉取、页面内嵌或配置直供，折算逻辑一致。
 * summary 为 null（显式 levels 降级路径）时由调用方短路，不进入此函数。
 */
export function applySummaryToState(
  summary: SummaryResponse,
  state: DiscoveryState,
  inputs: DiscoveryInputs,
): void {
  const { explicitLevels, explicitEager, explicitEndpoint } = inputs;

  // 0. schemeVersion 向前兼容（DESIGN.md §6.3；拼写为 scheme 非 schema）
  const schemeVersion = summary.schemeVersion ?? 1;
  if (schemeVersion > 1) {
    console.warn(
      `[route-forge] backend schemeVersion=${schemeVersion} > client supported 1; some features may be unavailable`,
    );
  }

  // 1. endpoint 后端权威（层级懒加载优先用 route.uri，此值仅作兜底前缀）
  if (summary.config.endpoint_prefix && summary.config.endpoint_prefix !== explicitEndpoint) {
    if (explicitEndpoint) {
      console.warn(
        `[route-forge] backend endpoint_prefix "${summary.config.endpoint_prefix}" overrides frontend endpoint "${explicitEndpoint}"`,
      );
    }
    state.endpoint = summary.config.endpoint_prefix;
  }

  // 1a. url_prefix 后端权威：后端下发（非 null）时覆盖
  if (summary.config.url_prefix) {
    state.urlPrefix = summary.config.url_prefix.endsWith('/')
      ? summary.config.url_prefix.slice(0, -1)
      : summary.config.url_prefix;
  }

  // 1b. 全局 cache_ttl（后端权威）
  state.cacheTtl = normalizeCacheTtl(summary.config.cache_ttl);

  // 2. levels 概览：真实层级（含恒存在的 unassigned）+ 各层级 route.uri 自描述
  const backendLevels = Object.keys(summary.levels);
  const levelRoutes: Record<string, LevelRouteDescriptor> = {};
  for (const lvl of backendLevels) {
    const r = summary.levels[lvl]?.route;
    if (r && typeof r.uri === 'string') {
      levelRoutes[lvl] = { uri: r.uri, methods: r.methods ?? ['GET', 'HEAD'] };
    }
  }
  state.levelRoutes = levelRoutes;

  if (explicitLevels && explicitLevels.length > 0) {
    const intersection = explicitLevels.filter((l) => backendLevels.includes(l));
    const removed = explicitLevels.filter((l) => !backendLevels.includes(l));
    if (removed.length > 0) {
      console.warn(
        `[route-forge] levels not in backend summary and dropped: ${removed.join(', ')}`,
      );
    }
    state.levels = intersection;
  } else {
    state.levels = backendLevels.slice();
  }

  // 3. eager：未传时取后端 load:'eager' 层级；显式传入时取并集（SPEC §5.3）
  const backendEager = backendLevels.filter((lvl) => summary.levels[lvl]?.load === 'eager');
  if (!explicitEager) {
    state.eager = backendEager;
  } else {
    // 并集：后端 eager + 前端显式声明，去重
    const union = new Set([...backendEager, ...explicitEager]);
    state.eager = [...union];
  }
}
