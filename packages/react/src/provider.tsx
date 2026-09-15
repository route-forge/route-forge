/**
 * React Provider — 注入 RouteForge 实例的 Context + Provider
 * @see .docs/SPEC.md §4.1.7
 *
 * 提供：
 *   - RouteForgeProvider：React Context Provider，注入 RouteForge 实例
 *   - ForgeContext：供高级用户直接 useContext 的 Context 本体
 *
 * useForge / useForgeApi / useForgeRoute 等消费 hook 见 hooks/ 下各文件。
 */

import { createContext, type ReactNode, useRef, useState, useEffect } from 'react';
import {
  createRouteForge,
  type RouteForge,
  type RouteForgeOptions,
} from '@route-forge/core';
import { optionsEqual } from './internal/options-equal.js';

// ─── Context ────────────────────────────────────────────────

const ForgeContext = createContext<RouteForge | null>(null);

export interface RouteForgeProviderProps {
  /** 可省略：页面内嵌 window.__ROUTE_FORGE__ 提供摘要时，<RouteForgeProvider> 可不传 options */
  options?: RouteForgeOptions;
  /**
   * 外部传入的 forge 实例（复用模式）：传入时忽略 `options`、不在本组件内创建/重建实例，
   * 供在非组件代码（SSR 入口、单例模块）中持有实例的场景，避免 ready-gate 双实例重复请求摘要。
   * 传入时 `onInterceptors` 不会触发（外部持有引用，可直接注册）。
   */
  forge?: RouteForge;
  /**
   * ready 门闩：true 时在 `ready()` resolve 前渲染 `gateFallback`（缺省 null）、resolve 后放行
   * children——直接 mount 也能拿到 `ready().then(mount)` 同级的确定性（首帧路由数据必然就绪）。
   * options 变更重建实例时重新闭门；ready() reject 时响亮 console.error 且保持闭门（与
   * `then(mount)` 的 catch 语义对齐，不静默）。
   */
  gate?: boolean;
  /** 门闩期间的占位 UI（仅 `gate` 为 true 时生效，缺省不渲染任何内容） */
  gateFallback?: ReactNode;
  /**
   * 创建期拦截器钩子：每个 forge 实例触发**一次**（首次创建 + options 变更重建时），
   * 用于在挂载前同步注册请求/响应拦截器，无需钻到子组件 useForge() 里挂。
   * 属"初始化"语义而非响应式 effect——仅回调 identity 变化而 options 不变时不会重跑。
   * 请求/响应拦截链只影响后续 api() 调用，eager 元信息预加载走 requestRaw 不受影响，故无需等待就绪。
   */
  onInterceptors?: (interceptors: RouteForge['interceptors']) => void;
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
 *
 * @example
 * ```tsx
 * // 创建期注册拦截器（每实例一次）——无需钻到子组件 useForge() 里挂
 * <RouteForgeProvider
 *   options={{ endpoint: '/_forge/routes' }}
 *   onInterceptors={(i) => {
 *     i.request.use((c) => ({ ...c, headers: { ...c.headers, Authorization: token() } }))
 *     i.response.use((r) => r.data, (e) => { reportError(e); return Promise.reject(e) })
 *   }}
 * >
 *   <App />
 * </RouteForgeProvider>
 * ```
 */
export function RouteForgeProvider({ options, forge: externalForge, gate, gateFallback, onInterceptors, children }: RouteForgeProviderProps) {
  const ref = useRef<{ options: RouteForgeOptions; forge: RouteForge } | null>(null);
  // 实例版本：options 实际变化重建 forge 后递增，驱动 context value 更新
  const [version, setVersion] = useState(0);

  // lazy init（React 官方认可的幂等初始化模式）：首次渲染建实例。
  // 渲染期只做 null 检查 + 赋值，重复执行幂等（StrictMode 双渲染也只有一个实例）；
  // createRouteForge 内部立即发起摘要 fetch，但 core 层有缓存/inflight 去重兜底。
  // options 省略时归一为 {}：完全靠页面内嵌 window.__ROUTE_FORGE__ 提供摘要。
  // 外部传入 forge 实例时直接复用（忽略 options），不在本组件内创建。
  if (ref.current === null) {
    if (externalForge) {
      ref.current = { options: {}, forge: externalForge };
    } else {
      const init = options ?? {};
      ref.current = { options: init, forge: createRouteForge(init) };
      // 创建期钩子：null 守卫使其在 StrictMode 双渲染下也只触发一次（第二次 ref.current 已非空跳过）
      onInterceptors?.(ref.current.forge.interceptors);
    }
  }

  // ready 门闩状态：已就绪（含构造前即就绪的复用实例）直接开门，避免多余的 fallback 首帧
  const [gateOpen, setGateOpen] = useState(() => !gate || ref.current!.forge.isReady());

  // options 变化检测移到 effect（渲染期不换实例）：
  // 换实例延后一帧（渲染完成后），换取 concurrent/StrictMode 下渲染热路径无副作用。
  useEffect(() => {
    // 外部实例：仅跟随引用变化更新 context value，永不重建
    if (externalForge) {
      if (ref.current!.forge !== externalForge) {
        ref.current = { options: {}, forge: externalForge };
        setVersion((v) => v + 1);
      }
    } else {
      const next = options ?? {};
      if (!optionsEqual(ref.current!.options, next)) {
        ref.current = { options: next, forge: createRouteForge(next) };
        setVersion((v) => v + 1);
        // 实例重建 → 拦截器随新实例重新注册一次（与 effect 同步的当前闭包回调）
        onInterceptors?.(ref.current.forge.interceptors);
      }
    }
    // ready 门闩：跟随当前实例。实例重建 → 重新闭门等待新实例 ready；
    // ready() reject 响亮报告且保持闭门（错误级 console.error 永不静音，与 then(mount) 的 catch 对齐）
    if (gate) {
      const f = ref.current!.forge;
      let cancelled = false;
      if (f.isReady()) {
        setGateOpen(true);
      } else {
        setGateOpen(false);
        f.ready().then(
          () => {
            if (!cancelled) setGateOpen(true);
          },
          (err) => {
            console.error(
              '[route-forge] gate: ready() rejected — children stay gated (same as an unhandled ready().catch)',
              err,
            );
          },
        );
      }
      return () => {
        cancelled = true;
      };
    }
    // 依赖刻意仅含 options / 外部实例 / gate：这是"每实例一次"的初始化钩子，回调 identity 单独变化不应重跑
  }, [options, externalForge, gate]);

  // version 仅用于触发重渲染（读取 ref.current.forge 保证最新实例）；
  // context value 引用稳定性：同一实例期间 value 不变，避免全树无谓重渲染
  void version;
  const content = gate && !gateOpen ? (gateFallback ?? null) : children;
  return <ForgeContext.Provider value={ref.current.forge}>{content}</ForgeContext.Provider>;
}

/** React Context — 供高级用户直接 useContext(ForgeContext) 使用 */
export { ForgeContext };
