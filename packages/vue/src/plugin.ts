/**
 * Vue 3 插件入口
 * @see .docs/SPEC.md §4.1.7
 *
 * 提供：
 *   - 全局属性 $forge（route() 工具）
 *   - inject symbol 注入 RouteForge 实例供 composable 使用
 */

import type { App, InjectionKey } from 'vue';
import { inject, reactive, readonly } from 'vue';
import {
  createRouteForge,
  type RouteForge,
  type RouteForgeOptions,
} from '@route-forge/core';

export const FORGE_INJECTION_KEY: InjectionKey<RouteForge> = Symbol('route-forge');

export interface RouteForgePluginOptions extends RouteForgeOptions {}

export function createRouteForgePlugin(options: RouteForgePluginOptions) {
  const forge = createRouteForge(options);

  return {
    install(app: App) {
      app.provide(FORGE_INJECTION_KEY, forge);
      app.config.globalProperties.$forge = {
        route: (name: string, params?: Record<string, unknown>) =>
          forge.route(name, params),
      };
    },
  };
}

export function useForge(): RouteForge {
  const forge = inject(FORGE_INJECTION_KEY);
  if (!forge) {
    throw new Error(
      '[route-forge/vue] useForge() must be used inside an app with createRouteForgePlugin() installed',
    );
  }
  return forge;
}

export { readonly, reactive };
