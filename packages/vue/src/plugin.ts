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

import type { App, InjectionKey, Plugin, Ref } from 'vue';
import { inject, ref } from 'vue';
import {
  type ApiCallParams,
  createRouteForge,
  type ForgeInstanceTyped,
  resolveRouteName,
  resolveRouteNameSync,
  type RouteForge,
  type RouteForgeOptions,
} from '@route-forge/core';
import { defineImmutableProps } from '@route-forge/core/internal';

export const FORGE_INJECTION_KEY: InjectionKey<RouteForge> = Symbol('route-forge');

export interface RouteForgePluginOptions extends RouteForgeOptions {}

/** 已绑定 level — 直接调用无需 level，api/route/url 的 name 自动限定到该层级 */
export type BoundForgeTyped<L extends string> = import('@route-forge/core').BoundForgeTyped<L, Ref<boolean>>;

/** 未绑定 level — 直接调用需要传 level（不提供 route/url/hasRoute/getRoutes 等同步方法） */
export type { ForgeInstanceTyped } from '@route-forge/core';

export function createRouteForgePlugin(options: RouteForgePluginOptions): Plugin<[]> & {
  ready: Promise<void>
} {
  const forge = createRouteForge(options);

  return {
    ready: forge.ready,
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
    // 自动触发 level 加载 + 响应式 levelLoaded 状态
    const levelLoaded = ref(forge.isLoaded(level));
    forge.load(level).then(() => {
      levelLoaded.value = true;
    }).catch(() => { /* 加载失败时 levelLoaded 保持 false */
    });
    // 订阅 level 加载完成事件（兜底：如果 load() 在 ref 赋值后才完成）
    const unsub = forge.onLevelLoaded(level, () => {
      levelLoaded.value = true;
      unsub();
    });

    const callable = prefix
      ? async (name: string, params?: ApiCallParams) =>
        forge.api(level, await resolveRouteName(forge, level, prefix, name), params)
      : (name: string, params?: ApiCallParams) =>
        forge.api(level, name, params);
    defineImmutableProps(callable, {
      level,
      // 未传 prefix 时不定义该属性，与 React 包行为保持一致（'prefix' in forge === false）
      ...(prefix !== undefined ? { prefix } : {}),
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
      isLoading: forge.isLoading.bind(forge),
      onLoadingChange: forge.onLoadingChange.bind(forge),
      getRoutes: forge.getRoutes.bind(forge),
    });
    // levelLoaded 需要保持响应式，不能通过 defineImmutableProps（会 Object.freeze）
    Object.defineProperty(callable, 'levelLoaded', {
      value: levelLoaded,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    return callable as unknown as BoundForgeTyped<string>;
  }

  const callable = (lvl: string, name: string, params?: ApiCallParams) =>
    forge.api(lvl, name, params);
  defineImmutableProps(callable, {
    api: forge.api.bind(forge),
    load: forge.load.bind(forge),
    invalidate: forge.invalidate.bind(forge),
    isLoaded: forge.isLoaded.bind(forge),
    isLoading: forge.isLoading.bind(forge),
    onLoadingChange: forge.onLoadingChange.bind(forge),
    ready: forge.ready,
    onLevelLoaded: forge.onLevelLoaded.bind(forge),
  });
  return callable as unknown as ForgeInstanceTyped;
}


