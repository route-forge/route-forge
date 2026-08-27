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
  type BoundForge,
  createRouteForge,
  type RouteForge,
  type RouteForgeOptions,
} from '@route-forge/core';

export const FORGE_INJECTION_KEY: InjectionKey<RouteForge> = Symbol('route-forge');

export interface RouteForgePluginOptions extends RouteForgeOptions {}

/** Vue 特化类型：levelLoaded 为 Ref<boolean> */
export type VueBoundForge = BoundForge<Ref<boolean>>;

export function createRouteForgePlugin(options: RouteForgePluginOptions): Plugin<[]> & {
  ready: RouteForge['ready']
} {
  const forge = createRouteForge(options);

  return {
    ready: forge.ready.bind(forge),
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
 * 获取 forge 实例。内部委托 core 的 forge.use()，仅将 levelLoaded 替换为 Vue 响应式 Ref。
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
 * forge.levelLoaded              // Ref<boolean>
 * forge('users.show', { user: 1 })
 * forge.route('users.show', { user: 1 })
 *
 * @example
 * // 绑定层级 + 前缀 — 路由名自动拼接
 * const forge = useForge('admin', 'users')
 * forge('show', { user: 1 })           // → forge.api('admin', 'users.show', ...)
 * forge.route('show', { user: 1 })     // → forge.route('admin', 'users.show', ...)
 */
export function useForge<L extends string>(level: L, prefix: string): VueBoundForge;
export function useForge<L extends string>(level: L): VueBoundForge;
export function useForge(): RouteForge;
export function useForge(level?: string, prefix?: string): RouteForge | VueBoundForge {
  const forge = inject(FORGE_INJECTION_KEY);
  if (!forge) {
    throw new Error(
      '[route-forge/vue] useForge() must be used inside an app with createRouteForgePlugin() installed',
    );
  }

  if (level === undefined) {
    return forge;
  }

  // 委托 core 的 use()，获取 BoundForge（levelLoaded 为 Promise<void>）
  const bound = forge.use(level, prefix);

  // 将 levelLoaded 从 Promise<void> 替换为 Ref<boolean>
  const levelLoadedRef = ref(false);
  bound.levelLoaded.then(() => {
    levelLoadedRef.value = true;
  }).catch(() => { /* 加载失败时 levelLoaded 保持 false */ });

  Object.defineProperty(bound, 'levelLoaded', {
    value: levelLoadedRef,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  return bound as unknown as VueBoundForge;
}
