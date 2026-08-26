/**
 * 智能路由名前缀解析
 *
 * 当前缀与后缀拼接产生歧义时（后缀本身已以前缀开头），
 * 通过查询已加载路由表来判定正确名称：
 *   - 优先尝试 prefix + sep + suffix（完整拼接）
 *   - 若不存在则回退到 suffix（视为已含前缀）
 *   - 均不存在则抛 UnknownRouteError
 *
 * @see .docs/SPEC.md §4.1.7
 */

import { UnknownRouteError } from './errors.js';

/**
 * 路由名解析所需的最小 forge 接口。
 * 仅依赖 load() 和 hasRoute()，不依赖拦截器等完整能力。
 * 兼容 RouteForge、BoundForgeTyped、ForgeInstanceTyped 等所有形态。
 */
export interface RouteResolver {
  load(level: string | string[]): Promise<void>;

  hasRoute(level: string, name: string): boolean;
}

/**
 * 异步版本：先确保层级已加载，再做歧义消解。
 * 适用于 api() 调用路径。
 */
export async function resolveRouteName(
  forge: RouteResolver,
  level: string,
  prefix: string,
  suffix: string,
  separator = '.',
): Promise<string> {
  // 后缀为空 → 直接返回前缀
  if (!suffix) return prefix;

  const joined = `${prefix}${separator}${suffix}`;

  // 后缀不以前缀开头 → 无歧义，直接拼接
  if (!suffix.startsWith(`${prefix}${separator}`)) return joined;

  // 歧义场景：先确保层级已加载
  await forge.load(level);

  // 优先尝试完整拼接
  if (forge.hasRoute(level, joined)) return joined;
  // 回退到后缀本身（视为已含前缀）
  if (forge.hasRoute(level, suffix)) return suffix;

  // 均不存在 → 报错
  throw new UnknownRouteError(joined, level);
}

/**
 * 同步版本：基于已加载缓存做歧义消解。
 * 适用于 route() / url() 调用路径（要求层级已加载）。
 */
export function resolveRouteNameSync(
  forge: RouteResolver,
  level: string,
  prefix: string,
  suffix: string,
  separator = '.',
): string {
  if (!suffix) return prefix;

  const joined = `${prefix}${separator}${suffix}`;
  if (!suffix.startsWith(`${prefix}${separator}`)) return joined;

  // 歧义场景：基于已加载缓存判定
  if (forge.hasRoute(level, joined)) return joined;
  if (forge.hasRoute(level, suffix)) return suffix;

  throw new UnknownRouteError(joined, level);
}
