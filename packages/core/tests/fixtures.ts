/**
 * 测试共享夹具：把「后端契约形状」的构造收敛到一处。
 *
 * makeSummary 接受"松类型"的覆盖项并归一化为当前 SummaryResponse 契约：
 *   - 自动为每个层级补 route.uri（缺省 `/{endpoint_prefix}/{level}`），忽略遗留的 per-level `cache`；
 *   - config 深度合并，缺省 url_prefix=null、cache_ttl=3600；
 *   - 接受 `schemaVersion` 别名（旧拼写）与顶层 `unassigned`（旧形状，现忽略——它是 levels 中的真实层级）。
 * 让迁移期的大量旧 fixture 调用点保持可读、少改动。
 */

import type { LevelRoutesResponse, RouteMeta, SummaryResponse } from '../src/index.js';

type LooseRoute = { uri: string; methods: string[] };
type LooseLevel = {
  description?: string;
  load?: 'lazy' | 'eager';
  route_count?: number;
  route?: LooseRoute;
  /** 遗留字段：per-level cache，现忽略（TTL 统一来自 config.cache_ttl） */
  cache?: number | null;
};
export type SummaryOverrides = {
  schemeVersion?: number;
  /** 遗留拼写别名 */
  schemaVersion?: number;
  levels?: Record<string, LooseLevel>;
  config?: Partial<SummaryResponse['config']>;
  /** 遗留形状：顶层 unassigned，现忽略（unassigned 是 levels 中的真实层级） */
  unassigned?: unknown;
};

const DEFAULT_PREFIX = '/_forge/routes';

export function makeSummary(overrides: SummaryOverrides = {}): SummaryResponse {
  const endpointPrefix = overrides.config?.endpoint_prefix ?? DEFAULT_PREFIX;

  const levels: SummaryResponse['levels'] = {};
  for (const [lvl, cfg] of Object.entries(overrides.levels ?? {})) {
    levels[lvl] = {
      description: cfg.description ?? '',
      load: cfg.load ?? 'lazy',
      route_count: cfg.route_count ?? 0,
      route: cfg.route ?? { uri: `${endpointPrefix}/${lvl}`, methods: ['GET', 'HEAD'] },
    };
  }

  return {
    schemeVersion: overrides.schemeVersion ?? overrides.schemaVersion ?? 1,
    levels,
    config: {
      strict_mode: overrides.config?.strict_mode ?? false,
      endpoint_prefix: endpointPrefix,
      url_prefix: overrides.config?.url_prefix ?? null,
      // 显式 null（不缓存）不能被 ?? 折叠成兜底值，须区分"给了 null"与"没给"
      cache_ttl:
        overrides.config && 'cache_ttl' in overrides.config
          ? overrides.config.cache_ttl ?? null
          : 3600,
    },
  };
}

/** 构造层级路由表响应（后端 {level, routes} 形状，无 cache 字段）。 */
export function makeLevel(
  level: string,
  routes: Record<string, Omit<RouteMeta, 'level'> | RouteMeta>,
): LevelRoutesResponse {
  return { level, routes: routes as Record<string, RouteMeta> };
}
