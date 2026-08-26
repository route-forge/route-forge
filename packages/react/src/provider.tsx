/**
 * React Provider + useForge hook
 * @see .docs/SPEC.md §4.1.7
 *
 * 提供：
 *   - RouteForgeProvider：React Context Provider，注入 RouteForge 实例
 *   - useForge() / useForge({ level }) / useForge({ level, prefix }) 返回统一方法的 forge 实例
 *     • 不传 level：forge.api(level, name, params?) 直接调用
 *     • 传 level：forge(name, params?) 可直接调用（= api 快捷方式），自动绑定层级
 *     • 传 level + prefix：forge(suffix, params?) 自动拼接 prefix
 *
 * 类型推断：
 *   当 ForgeRouteMap 通过 codegen 或 module augmentation 定义时，
 *   level / name / params 均自动推断，IDE 提供补全提示。
 */

import { createContext, type ReactNode, useContext, useMemo, useRef } from 'react';
import {
  type ApiCallParams,
  type BoundForgeTyped as CoreBoundForgeTyped,
  createRouteForge,
  type ForgeInstanceTyped,
  resolveRouteName,
  resolveRouteNameSync,
  type RouteForge,
  type RouteForgeOptions,
} from '@route-forge/core';
import { defineImmutableProps } from '@route-forge/core/internal';

// ─── Context ────────────────────────────────────────────────

const ForgeContext = createContext<RouteForge | null>(null);

export interface RouteForgeProviderProps {
  options: RouteForgeOptions;
  children?: ReactNode;
}

/**
 * RouteForge Provider — 替代 Vue 的 createRouteForgePlugin
 *
 * 实例稳定性：仅当 options 实际变化（浅比较，含数组元素与 cache 嵌套字段）时才重建 forge，
 * 避免父组件重渲染时内联 options 字面量导致每次渲染都重建实例（重复拉取摘要/丢失缓存）。
 *
 * @example
 * ```tsx
 * import { RouteForgeProvider } from '@route-forge/react'
 *
 * ReactDOM.createRoot(document.getElementById('root')!).render(
 *   <RouteForgeProvider options={{ endpoint: '/_forge/routes' }}>
 *     <App />
 *   </RouteForgeProvider>,
 * )
 * ```
 */
export function RouteForgeProvider({ options, children }: RouteForgeProviderProps) {
  const ref = useRef<{ options: RouteForgeOptions; forge: RouteForge } | null>(null);
  if (ref.current === null || !optionsEqual(ref.current.options, options)) {
    ref.current = { options, forge: createRouteForge(options) };
  }
  return <ForgeContext.Provider value={ref.current.forge}>{children}</ForgeContext.Provider>;
}

/** 比较两个 options 是否等价：原始值按 ===，数组逐元素 ===，嵌套纯对象（如 cache）浅比较 */
function optionsEqual(a: RouteForgeOptions, b: RouteForgeOptions): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = (a as unknown as Record<string, unknown>)[k];
    const vb = (b as unknown as Record<string, unknown>)[k];
    if (va === vb) continue;
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length || !va.every((v, i) => v === vb[i])) return false;
      continue;
    }
    if (
      va !== null && vb !== null &&
      typeof va === 'object' && typeof vb === 'object' &&
      !Array.isArray(va) && !Array.isArray(vb)
    ) {
      const vaObj = va as Record<string, unknown>;
      const vbObj = vb as Record<string, unknown>;
      const vak = Object.keys(vaObj);
      if (vak.length !== Object.keys(vbObj).length) return false;
      if (!vak.every((kk) => vaObj[kk] === vbObj[kk])) return false;
      continue;
    }
    return false;
  }
  return true;
}

/** React Context — 供高级用户直接 useContext(ForgeContext) 使用 */
export { ForgeContext };

// ─── React 特化类型别名 ──────────────────────────────────────

/** 已绑定 level — 可直接调用（= api 快捷方式），无需传 level */
export type BoundForgeTyped<L extends string> = CoreBoundForgeTyped<L, boolean>;

/** 未绑定 level — 直接调用需要传 level（不提供 route/url/hasRoute/getRoutes 等同步方法） */
export type { ForgeInstanceTyped } from '@route-forge/core';

// ─── useForge hook ───────────────────────────────────────────

/**
 * 获取 forge 实例。
 *
 * @example
 * ```ts
 * // 不绑定层级
 * const forge = useForge()
 * forge.api('admin', 'users.show', { user: 1 })
 *
 * // 绑定层级 — 可直接调用，也可通过 api/route/url
 * const forge = useForge({ level: 'admin' })
 * forge.level                    // → 'admin'
 * forge('users.show', { user: 1 })         // 直接调用 = forge.api() 快捷方式
 * forge.api('users.show', { user: 1 })
 * forge.route('users.show', { user: 1 })
 *
 * // 绑定层级 + 前缀 — 路由名自动拼接
 * const forge = useForge({ level: 'admin', prefix: 'users' })
 * forge.level                    // → 'admin'
 * forge.prefix                   // → 'users'
 * forge.api('show', { user: 1 })           // → forge.api('admin', 'users.show', ...)
 * forge.route('show', { user: 1 })         // → forge.route('admin', 'users.show', ...)
 * ```
 */
export function useForge<L extends string>(options: {
  level: L;
  prefix: string
}): BoundForgeTyped<L>;
export function useForge<L extends string>(options: { level: L }): BoundForgeTyped<L>;
export function useForge(): ForgeInstanceTyped;
export function useForge(opts?: {
  level?: string;
  prefix?: string
}): ForgeInstanceTyped | BoundForgeTyped<string> {
  const forge = useContext(ForgeContext);
  if (!forge) {
    throw new Error(
      '[route-forge/react] useForge() must be used within a <RouteForgeProvider>',
    );
  }

  const level = opts?.level;
  const prefix = opts?.prefix;

  return useMemo(() => {
    if (level !== undefined) {
      // 自动触发 level 加载（在 useMemo 内发起，确保仅执行一次）
      forge.load(level).catch(() => { /* 加载失败时 levelLoaded 保持 false */
      });

      const apiFn = prefix
        ? (name: string, params?: ApiCallParams) =>
          resolveRouteName(forge, level, prefix, name).then(
            (resolved) => forge.api(level, resolved, params),
          )
        : (name: string, params?: ApiCallParams) => forge.api(level, name, params);

      // 返回 callable 函数（与 Vue useForge 对齐）：直接调用 = api 快捷方式
      const callable = apiFn as unknown as BoundForgeTyped<string>;
      defineImmutableProps(callable, {
        level,
        ...(prefix !== undefined ? { prefix } : {}),
        api: apiFn,
        route: prefix
          ? (name: string, params?: Record<string, unknown>) =>
            forge.route(level, resolveRouteNameSync(forge, level, prefix, name), params)
          : (name: string, params?: Record<string, unknown>) => forge.route(level, name, params),
        url: prefix
          ? (name: string, params?: Record<string, unknown>) =>
            forge.route(level, resolveRouteNameSync(forge, level, prefix, name), params)
          : (name: string, params?: Record<string, unknown>) => forge.route(level, name, params),
        load: forge.load.bind(forge),
        invalidate: forge.invalidate.bind(forge),
        isLoaded: forge.isLoaded.bind(forge),
        hasRoute: forge.hasRoute.bind(forge),
        isLoading: forge.isLoading.bind(forge),
        onLoadingChange: forge.onLoadingChange.bind(forge),
        getRoutes: forge.getRoutes.bind(forge),
        levelLoaded: forge.isLoaded(level),
      });
      return callable;
    }

    const instance: ForgeInstanceTyped = {
      api: forge.api.bind(forge),
      load: forge.load.bind(forge),
      invalidate: forge.invalidate.bind(forge),
      isLoaded: forge.isLoaded.bind(forge),
      isLoading: forge.isLoading.bind(forge),
      onLoadingChange: forge.onLoadingChange.bind(forge),
      ready: forge.ready,
      onLevelLoaded: forge.onLevelLoaded.bind(forge),
    };
    return instance;
  }, [forge, level, prefix]);
}
