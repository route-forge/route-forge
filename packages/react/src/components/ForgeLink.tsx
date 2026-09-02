/**
 * ForgeLink：便捷链接组件，封装 useForgeRoute 的"先空串、后更新"异步行为
 * @see .docs/SPEC.md §4.1.7
 *
 * - loaded（href !== ''）时直接渲染链接：默认原生 <a href>；
 *   通过 as prop 注入任意自定义 Link 组件（react-router 的 Link、next/link 等），
 *   注入后渲染 <as href={...}>（零依赖：本包不 import 任何路由库）
 * - 未加载（或路由解析出错）时渲染 loading（默认不渲染任何内容）；
 *   每实例以 console.warn 提醒一次（effect 内触发，防刷屏）
 * - 路由解析出错以 console.error 报告，渲染不中断
 * - 其余 props（className / target / rel 等）透传到链接元素
 * - level 为静态快照（实例级契约），name / params 变化自动重算 URL
 */

import {
  type AnchorHTMLAttributes,
  type ElementType,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { ForgeContext } from '../provider.js';
import { useForgeRoute } from '../hooks/useForgeRoute.js';
import { reportDegrade, warnUnloadedOnce } from './shared.js';
import type { RouteForge } from '@route-forge/core';

export interface ForgeLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** 层级名：静态快照，首次渲染求值后固定，不支持中途切换 */
  level: string;
  /** 路由名 */
  name: string;
  /** 路由参数（内容变化触发 URL 重算；按 JSON 序列化比较，与 useForgeRoute 一致） */
  params?: Record<string, unknown>;
  /**
   * 自定义链接组件（如 react-router 的 Link、next/link）。
   * 注入后渲染 <as href={生成的URL} to={生成的URL}>（两个 prop 同时提供：
   * react-router 的 Link 消费 to，next/link 等消费 href），
   * 由该组件决定 SPA 内部跳转语义
   */
  as?: ElementType;
  /** 链接文本/内容 */
  children?: ReactNode;
  /** 未加载占位（默认不渲染任何内容） */
  loading?: ReactNode;
}

export function ForgeLink({ level, name, params, as, loading, children, ...rest }: ForgeLinkProps) {
  const forge = useContext(ForgeContext) as RouteForge | null;
  const href = useForgeRoute(level, name, params, {
    onDegrade: (e) => reportDegrade('ForgeLink', e),
  });
  const loaded = href !== '';

  // 未加载提示：每实例一次，在 effect 内判断与打印（渲染提交后，符合渲染期无副作用约定）
  const unloadWarnedRef = useRef(false);
  useEffect(() => {
    if (!loaded && forge && !forge.isLoaded(level) && !unloadWarnedRef.current) {
      unloadWarnedRef.current = true;
      warnUnloadedOnce('ForgeLink', level);
    }
  }, [loaded, forge, level]);

  if (!loaded) return <>{loading ?? null}</>;
  if (as) {
    const Comp = as as ElementType;
    // 同时传 href / to：react-router 的 Link 用 to，next/link 等用 href，
    // 两类路由库的 Link 组件都可直接注入；rest 在前，生成的 URL 不可被同名 prop 覆盖
    return <Comp {...rest} href={href} to={href}>{children}</Comp>;
  }
  return <a href={href} {...rest}>{children}</a>;
}
