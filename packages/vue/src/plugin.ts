/**
 * Vue 3 插件入口
 * @see .docs/SPEC.md §4.1.7
 *
 * 提供：
 *   - 全局属性 $forge（route() 工具）
 *   - inject symbol 注入 RouteForge 实例供 composable 使用
 *   - useForge() / useForge(level) 返回统一方法的 forge 实例
 *     • 不传 level：forge(level, name, params?) 直接调用
 *     • 传 level：forge(name, params?) 直接调用，自动绑定层级
 */

import type { App, InjectionKey, Plugin } from 'vue';
import { inject, reactive, readonly } from 'vue';
import {
  type ApiCallParams,
  createRouteForge,
  type RouteForge,
  type RouteForgeOptions,
} from '@route-forge/core';

export const FORGE_INJECTION_KEY: InjectionKey<RouteForge> = Symbol('route-forge');

export interface RouteForgePluginOptions extends RouteForgeOptions {}

/**
 * forge 实例统一接口（传 / 不传 level 方法集一致）：
 *   .api() / .route() / .url() — 传 level 后自动绑定，无需重复传
 *   .load() / .invalidate() / .isLoaded() / .interceptors
 *
 * 直接调用签名因是否绑定 level 而异，见 ForgeCallable / BoundForgeCallable
 */
export interface ForgeMethods extends Omit<RouteForge, 'api' | 'route'> {
  /** 调用 API；绑定层级后无需传 level */
  api(level: string, name: string, params?: ApiCallParams): Promise<unknown>;

  api(name: string, params?: ApiCallParams): Promise<unknown>;

  /** 生成 URL；绑定层级后无需传 level */
  route(level: string, name: string, params?: Record<string, unknown>): string;

  route(name: string, params?: Record<string, unknown>): string;

  /** route() 语义别名；绑定层级后无需传 level */
  url(level: string, name: string, params?: Record<string, unknown>): string;

  url(name: string, params?: Record<string, unknown>): string;
}

/** 未绑定 level — 直接调用需要传 level */
export interface ForgeInstance extends ForgeMethods {
  (level: string, name: string, params?: ApiCallParams): Promise<unknown>;
}

/** 已绑定 level — 直接调用无需 level */
export interface BoundForge extends ForgeMethods {
  (name: string, params?: ApiCallParams): Promise<unknown>;
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
 * forge('users.show', { user: 1 })
 * forge.api('users.show')
 * forge.route('users.show')
 * forge.url('users.show')
 */
export function useForge(level: string): BoundForge;
export function useForge(): ForgeInstance;
export function useForge(level?: string): ForgeInstance | BoundForge {
  const forge = inject(FORGE_INJECTION_KEY);
  if (!forge) {
    throw new Error(
      '[route-forge/vue] useForge() must be used inside an app with createRouteForgePlugin() installed',
    );
  }

  if (level !== undefined) {
    const callable = (name: string, params?: ApiCallParams) =>
      forge.api(level, name, params);
    Object.assign(callable, {
      api: (name: string, params?: ApiCallParams) => forge.api(level, name, params),
      route: (name: string, params?: Record<string, unknown>) => forge.route(level, name, params),
      url: (name: string, params?: Record<string, unknown>) => forge.route(level, name, params),
      load: forge.load.bind(forge),
      invalidate: forge.invalidate.bind(forge),
      isLoaded: forge.isLoaded.bind(forge),
      interceptors: forge.interceptors,
    });
    return callable as BoundForge;
  }

  const callable = (lvl: string, name: string, params?: ApiCallParams) =>
    forge.api(lvl, name, params);
  Object.assign(callable, {
    api: forge.api.bind(forge),
    route: forge.route.bind(forge),
    url: forge.url.bind(forge),
    load: forge.load.bind(forge),
    invalidate: forge.invalidate.bind(forge),
    isLoaded: forge.isLoaded.bind(forge),
    interceptors: forge.interceptors,
  });
  return callable as ForgeInstance;
}

export { readonly, reactive };
