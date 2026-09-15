/**
 * Vue 3 插件入口
 * @see .docs/SPEC.md §4.1.7
 *
 * 提供：
 *   - createRouteForgePlugin：装配插件，install 时经 inject symbol 注入 RouteForge 实例
 *   - 返回对象上的 interceptors（转发实例拦截器）：创建后即可同步注册，无需等待 ready()
 *
 * useForge / useForgeApi / useForgeRoute 等消费 composable 见 composables/ 下各文件。
 *
 * 注：v3.0.0 起不再注入 `$forge` 全局属性（残缺 facade，仅 route() 且未 ready 时抛错断渲染）；
 * 模板内生成链接用 useForgeRoute / ForgeLink / ForgeRoute，命令式场景用 useForge()。
 */

import type { App, InjectionKey, Plugin } from 'vue';
import {
  createRouteForge,
  type RouteForge,
  type RouteForgeOptions,
} from '@route-forge/core';

export const FORGE_INJECTION_KEY: InjectionKey<RouteForge> = Symbol('route-forge');

export interface RouteForgePluginOptions extends RouteForgeOptions {}

export function createRouteForgePlugin(
  forgeOrOptions: RouteForge | RouteForgePluginOptions = {},
): Plugin<[]> & {
  ready: RouteForge['ready']
  /** 转发实例上的拦截器管理器：创建后即可同步注册，无需等待 ready()（请求/响应拦截链仅影响后续 api() 调用，eager 元信息预加载走 requestRaw 不受影响） */
  interceptors: RouteForge['interceptors']
} {
  // 复用模式：直接传入 forge 实例（在非组件代码 / SSR 入口持有实例的场景），
  // 忽略 options、不再创建；与 react <RouteForgeProvider forge?> 对称
  const forge = isRouteForge(forgeOrOptions) ? forgeOrOptions : createRouteForge(forgeOrOptions);

  return {
    ready: forge.ready.bind(forge),
    interceptors: forge.interceptors,
    install(app: App) {
      app.provide(FORGE_INJECTION_KEY, forge);
      // v3.0.0 起不再注入 $forge 全局属性（残缺 facade 已移除，见 CHANGELOG）
    },
  };
}

/** 判定入参是否为 forge 实例（而非 options）：api + ready 双函数特征 */
function isRouteForge(x: unknown): x is RouteForge {
  return (
    typeof x === 'object' && x !== null &&
    typeof (x as RouteForge).api === 'function' &&
    typeof (x as RouteForge).ready === 'function'
  );
}
