/**
 * Vue 3 插件入口
 * @see .docs/SPEC.md §4.1.7
 *
 * 提供：
 *   - 全局属性 $forge（route() 工具）
 *   - inject symbol 注入 RouteForge 实例供 composable 使用
 *   - useForge() / useForge(level) / useForge(level, prefix) 返回统一方法的 forge 实例
 *     • 不传 level：forge(level, name, params?) 直接调用
 *     • 传 level：forge(name, params?) 直接调用，自动绑定层级
 *     • 传 level + prefix：forge(suffix, params?) 自动拼接 prefix
 *
 * 类型推断：
 *   当 ForgeRouteMap 通过 codegen 或 module augmentation 定义时，
 *   level / name / params 均自动推断，IDE 提供补全提示。
 */

import type { App, InjectionKey, Plugin } from 'vue';
import { inject, reactive, readonly } from 'vue';
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

export const FORGE_INJECTION_KEY: InjectionKey<RouteForge> = Symbol('route-forge');

export interface RouteForgePluginOptions extends RouteForgeOptions {}

/** 只读拦截器管理器：仅暴露查询方法，隐藏 use/eject/clear */
interface ReadOnlyInterceptorManager<TIn, TOut = TIn> {
  readonly size: number;

  forEach(fn: (handler: InterceptorHandler<TIn, TOut>) => void): void;
}

/**
 * 共享方法集（level 已绑定时的方法签名）
 * .api() / .route() / .url() — name 和 params 根据 ForgeRouteMap 自动推断
 * .load() / .invalidate() / .isLoaded() / .interceptors
 */
export interface BoundForgeMethods<L extends string = string> {
  interceptors: {
    request: ReadOnlyInterceptorManager<RequestConfig>;
    response: ReadOnlyInterceptorManager<ResponseData>;
  };

  api(name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): Promise<ForgeApiResponse<L, ForgeRouteName<L>>>;

  route(name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): string;

  url(name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): string;

  load(level: string | string[]): Promise<void>;

  invalidate(level?: string | string[]): void;

  isLoaded(level?: string): boolean;

  hasRoute(level: string, name: string): boolean;

  /** 获取指定层级下全部路由元信息（深拷贝，修改不影响内部缓存） */
  getRoutes(level: string): Record<string, RouteMeta>;
}

/** 已绑定 level — 直接调用无需 level，api/route/url 的 name 自动限定到该层级 */
export interface BoundForgeTyped<L extends string> extends BoundForgeMethods<L> {
  (name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): Promise<ForgeApiResponse<L, ForgeRouteName<L>>>;
  /** 当前绑定的 level 值 */
  readonly level: L;
  /** 路由名前缀（仅在 useForge(level, prefix) 传入 prefix 时存在） */
  readonly prefix?: string;
}

/** 未绑定 level — 直接调用需要传 level */
export interface ForgeInstanceTyped extends Omit<BoundForgeMethods<string>, 'api' | 'route' | 'url' | 'hasRoute' | 'getRoutes'> {
  (level: string, name: string, params?: ApiCallParams): Promise<unknown>;
  api(level: string, name: string, params?: ApiCallParams): Promise<unknown>;
  route(level: string, name: string, params?: Record<string, unknown>): string;
  url(level: string, name: string, params?: Record<string, unknown>): string;

  hasRoute(level: string, name: string): boolean;

  /** 获取全部层级路由（深拷贝）；传 level 时仅返回该层级 */
  getRoutes(): Record<string, Record<string, RouteMeta>>;
  getRoutes(level: string): Record<string, RouteMeta>;
}

export function createRouteForgePlugin(options: RouteForgePluginOptions): Plugin<[]> {
  const forge = createRouteForge(options);

  return {
    install(app: App) {
      app.provide(FORGE_INJECTION_KEY, forge);
      app.config.globalProperties.$forge = {
        route: (level: string, name: string, params?: Record<string, unknown>) =>
          forge.route(level, name, params),
      };
    },
  };
}

/**
 * 获取 forge 实例。
 *
 * @example
 * // 不绑定层级
 * const forge = useForge()
 * forge('admin', 'users.show', { user: 1 })
 * forge.api('admin', 'users.show')
 *
 * @example
 * // 绑定层级 — 直接调用和 api/route/url 均无需传 level
 * const forge = useForge('admin')
 * forge.level                    // → 'admin'
 * forge('users.show', { user: 1 })
 * forge.api('users.show')
 *
 * @example
 * // 绑定层级 + 前缀 — 路由名自动拼接
 * const forge = useForge('admin', 'users')
 * forge.level                    // → 'admin'
 * forge.prefix                   // → 'users'
 * forge('show', { user: 1 })           // → forge.api('admin', 'users.show', ...)
 * forge.api('index')                   // → forge.api('admin', 'users.index')
 * forge.route('show', { user: 1 })     // → forge.route('admin', 'users.show', ...)
 */
export function useForge<L extends string>(level: L, prefix: string): BoundForgeTyped<L>;
export function useForge<L extends string>(level: L): BoundForgeTyped<L>;
export function useForge(): ForgeInstanceTyped;
export function useForge(level?: string, prefix?: string): ForgeInstanceTyped | BoundForgeTyped<string> {
  const forge = inject(FORGE_INJECTION_KEY);
  if (!forge) {
    throw new Error(
      '[route-forge/vue] useForge() must be used inside an app with createRouteForgePlugin() installed',
    );
  }

  if (level !== undefined) {
    const callable = prefix
      ? async (name: string, params?: ApiCallParams) =>
        forge.api(level, await resolveRouteName(forge, level, prefix, name), params)
      : (name: string, params?: ApiCallParams) =>
        forge.api(level, name, params);
    defineImmutableProps(callable, {
      level,
      prefix,
      api: prefix
        ? async (name: string, params?: ApiCallParams) =>
          forge.api(level, await resolveRouteName(forge, level, prefix, name), params)
        : (name: string, params?: ApiCallParams) => forge.api(level, name, params),
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
    return callable as unknown as BoundForgeTyped<string>;
  }

  const callable = (lvl: string, name: string, params?: ApiCallParams) =>
    forge.api(lvl, name, params);
  defineImmutableProps(callable, {
    api: forge.api.bind(forge),
    route: forge.route.bind(forge),
    url: forge.url.bind(forge),
    load: forge.load.bind(forge),
    invalidate: forge.invalidate.bind(forge),
    isLoaded: forge.isLoaded.bind(forge),
    hasRoute: forge.hasRoute.bind(forge),
    getRoutes: forge.getRoutes.bind(forge),
    interceptors: forge.interceptors,
  });
  return callable as ForgeInstanceTyped;
}

export { readonly, reactive };

/**
 * 以不可变、不可枚举、不可重配置的方式将属性挂载到目标对象上。
 * 相比 Object.assign 更安全——外部无法通过遍历/删除/重写篡改这些方法。
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
