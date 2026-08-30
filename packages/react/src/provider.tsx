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
  // 实例版本：options 实际变化重建 forge 后递增，驱动 context value 更新
  const [version, setVersion] = useState(0);

  // lazy init（React 官方认可的幂等初始化模式）：首次渲染建实例。
  // 渲染期只做 null 检查 + 赋值，重复执行幂等（StrictMode 双渲染也只有一个实例）；
  // createRouteForge 内部立即发起摘要 fetch，但 core 层有缓存/inflight 去重兜底。
  if (ref.current === null) {
    ref.current = { options, forge: createRouteForge(options) };
  }

  // options 变化检测移到 effect（渲染期不换实例）：
  // 换实例延后一帧（渲染完成后），换取 concurrent/StrictMode 下渲染热路径无副作用。
  useEffect(() => {
    if (!optionsEqual(ref.current!.options, options)) {
      ref.current = { options, forge: createRouteForge(options) };
      setVersion((v) => v + 1);
    }
  }, [options]);

  // version 仅用于触发重渲染（读取 ref.current.forge 保证最新实例）；
  // context value 引用稳定性：同一实例期间 value 不变，避免全树无谓重渲染
  void version;
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

  // React 特化：levelLoaded → boolean，由 setState 驱动组件重渲染。
  // loadedRef 作为渲染期镜像，供 bound 上的 getter 读取最新值（bound 对象本身保持稳定）。
  const [loaded, setLoaded] = useState(() =>
    level !== undefined ? forge.isLoaded(level) : false,
  );
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const bound = useMemo(() => {
    if (level === undefined) return null;
    // 委托 core 的 use()（内部已触发 load）
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
    // level / forge 切换时先同步当前缓存状态
    const current = forge.isLoaded(level);
    if (loadedRef.current !== current) setLoaded(current);
    if (current) return;
    let cancelled = false;
    // forge.load 内部有 inflight 去重，与 createBoundForge 内部触发的 load 不会重复请求
    forge.load(level).then(
      () => { if (!cancelled) setLoaded(true); },
      () => { /* 加载失败时 levelLoaded 保持 false */ },
    );
    return () => {
      cancelled = true;
    };
  }, [bound, forge, level]);

  return level === undefined ? forge : (bound as unknown as ReactBoundForge);
}
