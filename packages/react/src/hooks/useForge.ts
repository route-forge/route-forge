/**
 * useForge hook — 获取 forge 实例（React 特化：levelLoaded 为 boolean）
 * @see .docs/SPEC.md §4.1.7
 *
 *   - useForge() 不绑定层级：forge.api(level, name, params) 直接调用
 *   - useForge(level) 绑定层级：forge(name, params) 可直接调用（= api 快捷方式）
 *   - useForge(level, prefix) 绑定层级 + 前缀：forge(suffix, params) 自动拼接 prefix
 *
 * 类型推断：当 ForgeRouteMap 通过 codegen 或 module augmentation 定义时，
 * level / name / params 均自动推断，IDE 提供补全提示。
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type BoundForge, type RouteForge } from '@route-forge/core';
import { ForgeContext } from '../provider.js';

/** React 特化：levelLoaded 为 boolean（通过 useState 驱动重渲染） */
export type ReactBoundForge = BoundForge<boolean>;

/**
 * 获取 forge 实例。内部委托 core 的 forge.use()，将 levelLoaded 替换为 React boolean 状态。
 *
 * @example
 * ```ts
 * // 不绑定层级
 * const forge = useForge()
 * forge.api('admin', 'users.show', { user: 1 })
 *
 * // 绑定层级 — 可直接调用，也可通过 api/route/url
 * const forge = useForge('admin')
 * forge.level                    // → 'admin'
 * forge.levelLoaded              // boolean
 * forge('users.show', { user: 1 })
 * forge.route('users.show', { user: 1 })
 *
 * // 绑定层级 + 前缀 — 路由名自动拼接
 * const forge = useForge('admin', 'users')
 * forge('show', { user: 1 })
 * forge.route('show', { user: 1 })
 * ```
 */
export function useForge<L extends string>(level: L, prefix: string): ReactBoundForge;
export function useForge<L extends string>(level: L): ReactBoundForge;
export function useForge(): RouteForge;
export function useForge(level?: string, prefix?: string): RouteForge | ReactBoundForge {
  const forge = useContext(ForgeContext);
  if (!forge) {
    throw new Error(
      '[route-forge/react] useForge() must be used within a <RouteForgeProvider>',
    );
  }

  // 契约：level 为实例级静态绑定——在 hook 首次调用时求值并固定，不支持动态切换。
  // 因为层级与其前缀（prefix）/ 路由名解析语义绑定，中途换 level 会让 prefix 失去意义；
  // 需要指向另一层级时，请新建组件 / 新建一次 useForge 调用（新建实例的开销可接受）。

  // React 特化：levelLoaded → boolean，由 bound 上的 getter 读取 loadedRef 提供。
  // loadedRef 是唯一真值源，仅在渲染提交之后（effect / 异步回调）写入，渲染阶段绝不改；
  // state 只用于在值变化时驱动组件重渲染（getter 本身不触发渲染）。
  const loadedRef = useRef<boolean>(level !== undefined ? forge.isLoaded(level) : false);
  const [, setLoadedVersion] = useState(0);
  const markLoaded = useCallback((next: boolean) => {
    if (loadedRef.current === next) return;
    loadedRef.current = next;
    setLoadedVersion((v) => v + 1);
  }, []);

  const bound = useMemo(() => {
    if (level === undefined) return null;
    // 委托 core 的 use()（内部已触发 load；load 经 core inflight 去重，幂等）
    const b = forge.use(level, prefix);
    Object.defineProperty(b, 'levelLoaded', {
      get() { return loadedRef.current; },
      enumerable: true,
      configurable: true,
    });
    return b;
  }, [forge, level, prefix]);

  useEffect(() => {
    if (level === undefined || !bound) return;
    // level / forge 切换时先同步当前缓存状态（在 effect 内写 ref，渲染期无副作用）
    const current = forge.isLoaded(level);
    markLoaded(current);
    if (current) return;
    let cancelled = false;
    // forge.load 内部有 inflight 去重，与 createBoundForge 内部触发的 load 不会重复请求
    forge.load(level).then(
      () => { if (!cancelled) markLoaded(true); },
      () => { /* 加载失败时 levelLoaded 保持 false */ },
    );
    return () => {
      cancelled = true;
    };
  }, [bound, forge, level, markLoaded]);

  return level === undefined ? forge : (bound as unknown as ReactBoundForge);
}
