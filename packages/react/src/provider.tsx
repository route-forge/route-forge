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

import { createContext, type ReactNode, useContext, useMemo } from 'react';
import {
  type ApiCallParams,
  createRouteForge,
  type ForgeApiParams,
  type ForgeApiResponse,
  type ForgeRouteName,
  type InterceptorHandler,
  type RequestConfig,
  type ResponseData,
  type RouteForge,
  type RouteForgeOptions,
  type RouteMeta,
} from '@route-forge/core';
import { resolveRouteName, resolveRouteNameSync } from './utils/resolveRouteName.js';

// ─── Context ────────────────────────────────────────────────

const ForgeContext = createContext<RouteForge | null>(null);

export interface RouteForgeProviderProps {
  options: RouteForgeOptions;
  children?: ReactNode;
}

/**
 * RouteForge Provider — 替代 Vue 的 createRouteForgePlugin
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
  const forge = useMemo(() => createRouteForge(options), [options]);
  return <ForgeContext.Provider value={forge}>{children}</ForgeContext.Provider>;
}

/** React Context — 供高级用户直接 useContext(ForgeContext) 使用 */
export { ForgeContext };

// ─── 只读拦截器类型 ──────────────────────────────────────────

/** 只读拦截器管理器：仅暴露查询方法，隐藏 use/eject/clear */
interface ReadOnlyInterceptorManager<TIn, TOut = TIn> {
  forEach(fn: (handler: InterceptorHandler<TIn, TOut>) => void): void;
}

// ─── 返回类型 ────────────────────────────────────────────────

/**
 * 共享方法集（level 已绑定时的方法签名）
 * .api() / .route() / .url() — name 和 params 根据 ForgeRouteMap 自动推断
 * .load() / .invalidate() / .isLoaded() / .interceptors
 */
export interface BoundForgeMethods<L extends string = string> {
  interceptors: {
    request: ReadOnlyInterceptorManager<RequestConfig, RequestConfig>;
    response: ReadOnlyInterceptorManager<ResponseData, unknown>;
  };

  api(name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): Promise<ForgeApiResponse<L, ForgeRouteName<L>>>;

  route(name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): string;

  url(name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): string;

  load(level: string | string[]): Promise<void>;

  invalidate(level?: string): void;

  isLoaded(level?: string): boolean;

  hasRoute(level: string, name: string): boolean;

  /** 获取指定层级下全部路由元信息（深拷贝，修改不影响内部缓存） */
  getRoutes(level: string): Record<string, RouteMeta>;
}

/** 已绑定 level — 可直接调用（= api 快捷方式），无需传 level */
export interface BoundForgeTyped<L extends string> extends BoundForgeMethods<L> {
  /** 直接调用 = forge.api() 快捷方式，自动带绑定的 level */
  (name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): Promise<ForgeApiResponse<L, ForgeRouteName<L>>>;
  /** 当前绑定的 level 值 */
  readonly level: L;
  /** 路由名前缀（仅在 useForge({ level, prefix }) 传入 prefix 时存在） */
  readonly prefix?: string;
}

/** 未绑定 level — 直接调用需要传 level */
export interface ForgeInstanceTyped extends Omit<BoundForgeMethods<string>, 'api' | 'route' | 'url' | 'hasRoute' | 'getRoutes'> {
  api(level: string, name: string, params?: ApiCallParams): Promise<unknown>;

  route(level: string, name: string, params?: Record<string, unknown>): string;

  url(level: string, name: string, params?: Record<string, unknown>): string;

  hasRoute(level: string, name: string): boolean;

  /** 获取全部层级路由（深拷贝）；传 level 时仅返回该层级 */
  getRoutes(): Record<string, Record<string, RouteMeta>>;

  getRoutes(level: string): Record<string, RouteMeta>;
}

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
        getRoutes: forge.getRoutes.bind(forge),
        interceptors: forge.interceptors,
      });
      return callable;
    }

    const instance: ForgeInstanceTyped = {
      api: forge.api.bind(forge),
      route: forge.route.bind(forge),
      url: forge.url.bind(forge),
      load: forge.load.bind(forge),
      invalidate: forge.invalidate.bind(forge),
      isLoaded: forge.isLoaded.bind(forge),
      hasRoute: forge.hasRoute.bind(forge),
      getRoutes: forge.getRoutes.bind(forge),
      interceptors: forge.interceptors,
    };
    return instance;
  }, [forge, level, prefix]);
}

/**
 * 以不可变、不可枚举、不可重配置的方式将属性挂载到目标对象上。
 * 与 Vue 包的 defineImmutableProps 行为一致。
 * 对象类型的值会浅冻结（Object.freeze），防止内部键被增删改。
 */
function defineImmutableProps<T extends object>(target: T, props: Record<string, unknown>): T {
  for (const key of Object.keys(props)) {
    const val = props[key];
    Object.defineProperty(target, key, {
      value: val !== null && typeof val === 'object' ? Object.freeze(val) : val,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
  return target;
}
