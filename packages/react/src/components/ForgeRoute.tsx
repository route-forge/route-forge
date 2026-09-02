/**
 * ForgeRoute：URL 生成组件（render-prop 形态），封装 useForgeRoute 的"先空串、后更新"异步行为
 * @see .docs/SPEC.md §4.1.7
 *
 * - children 为函数时传入 { href, loaded }（render-prop），自由渲染 <a>、Link 或任意内容
 * - loaded = href !== ''（level 未加载与路由解析出错都降级为 ''，正好复用该哨兵值）
 * - 未加载且非函数 children 时渲染 loading（默认 null，不渲染任何内容）；
 *   每实例以 console.warn 提醒一次（effect 内触发，防刷屏）
 * - 路由解析出错（UnknownRouteError 等）以 console.error 报告，渲染不中断
 * - level 为静态快照（实例级契约），name / params 变化自动重算 URL
 */

import { type ReactNode, useContext, useEffect, useRef } from 'react';
import { ForgeContext } from '../provider.js';
import { useForgeRoute } from '../hooks/useForgeRoute.js';
import { reportDegrade, warnUnloadedOnce } from './shared.js';
import type { RouteForge } from '@route-forge/core';

/** render-prop 回调入参 */
export interface ForgeRouteRenderState {
  /** 生成的 URL；未加载或解析出错时为 '' */
  href: string;
  /** href !== ''（level 已加载且路由解析成功） */
  loaded: boolean;
}

export interface ForgeRouteProps {
  /** 层级名：静态快照，首次渲染求值后固定，不支持中途切换 */
  level: string;
  /** 路由名 */
  name: string;
  /** 路由参数（内容变化触发 URL 重算；按 JSON 序列化比较，与 useForgeRoute 一致） */
  params?: Record<string, unknown>;
  /**
   * 函数 → render-prop：children({ href, loaded })；
   * 节点 → 已加载时直接渲染，未加载时渲染 loading（默认不渲染）
   */
  children?: ReactNode | ((state: ForgeRouteRenderState) => ReactNode);
  /** 未加载占位（仅非函数 children 时生效） */
  loading?: ReactNode;
}

export function ForgeRoute({ level, name, params, children, loading }: ForgeRouteProps) {
  const forge = useContext(ForgeContext) as RouteForge | null;
  const href = useForgeRoute(level, name, params, {
    onDegrade: (e) => reportDegrade('ForgeRoute', e),
  });
  const loaded = href !== '';

  // 未加载提示：每实例一次，在 effect 内判断与打印（渲染提交后，符合渲染期无副作用约定）
  const unloadWarnedRef = useRef(false);
  useEffect(() => {
    if (!loaded && forge && !forge.isLoaded(level) && !unloadWarnedRef.current) {
      unloadWarnedRef.current = true;
      warnUnloadedOnce('ForgeRoute', level);
    }
  }, [loaded, forge, level]);

  // 未加载/解析出错：loading 优先（默认不渲染），与 ForgeLink 行为一致
  if (!loaded) return <>{loading ?? null}</>;
  if (typeof children === 'function') {
    return <>{children({ href, loaded })}</>;
  }
  return <>{children}</>;
}
