/**
 * useForge — 获取 forge 实例（Vue 特化：levelLoaded 为 Ref<boolean>）
 * @see .docs/SPEC.md §4.1.7
 *
 * 内部委托 core 的 forge.use()，仅将 levelLoaded 从 Promise<void> 替换为 Vue 响应式 Ref。
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

import { inject, ref, type Ref } from 'vue';
import { type BoundForge, type RouteForge } from '@route-forge/core';
import { FORGE_INJECTION_KEY } from '../plugin.js';

/** Vue 特化类型：levelLoaded 为 Ref<boolean> */
export type VueBoundForge = BoundForge<Ref<boolean>>;

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
    configurable: true,
  });

  return bound as unknown as VueBoundForge;
}
