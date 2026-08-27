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

import { createContext, type ReactNode, useContext, useMemo, useRef, useState, useEffect } from 'react';
import {
  type BoundForge,
  createRouteForge,
  type RouteForge,
  type RouteForgeOptions,
} from '@route-forge/core';

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

/** React 特化：levelLoaded 为 boolean（通过 useState 驱动重渲染） */
export type ReactBoundForge = BoundForge<boolean>;

// ─── useForge hook ───────────────────────────────────────────

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
 * const forge = useForge({ level: 'admin' })
 * forge.level                    // → 'admin'
 * forge.levelLoaded              // boolean
 * forge('users.show', { user: 1 })
 * forge.route('users.show', { user: 1 })
 *
 * // 绑定层级 + 前缀 — 路由名自动拼接
 * const forge = useForge({ level: 'admin', prefix: 'users' })
 * forge('show', { user: 1 })
 * forge.route('show', { user: 1 })
 * ```
 */
export function useForge(options: {
  level: string;
  prefix: string
}): ReactBoundForge;
export function useForge(options: { level: string }): ReactBoundForge;
export function useForge(): RouteForge;
export function useForge(opts?: {
  level?: string;
  prefix?: string
}): RouteForge | ReactBoundForge {
  const forge = useContext(ForgeContext);
  if (!forge) {
    throw new Error(
      '[route-forge/react] useForge() must be used within a <RouteForgeProvider>',
    );
  }

  const level = opts?.level;
  const prefix = opts?.prefix;

  return useMemo(() => {
    if (level === undefined) {
      return forge;
    }

    // 委托 core 的 use()
    const bound = forge.use(level, prefix);

    // React 特化：将 levelLoaded 从 Promise 替换为 boolean（通过闭包 + getter/setter 驱动）
    // 先保存原始 Promise 以便异步更新
    const originalPromise = bound.levelLoaded as Promise<void>;
    let loadedValue = forge.isLoaded(level);
    const boundWithBoolean = bound as unknown as ReactBoundForge;

    Object.defineProperty(boundWithBoolean, 'levelLoaded', {
      get() { return loadedValue; },
      set(v: boolean) { loadedValue = v; },
      enumerable: true,
      configurable: true,
    });

    // 异步更新：level 加载完成后更新 boolean 值
    originalPromise.then(() => {
      loadedValue = true;
    }).catch(() => { /* 加载失败保持 false */ });

    return boundWithBoolean;
  }, [forge, level, prefix]);
}
