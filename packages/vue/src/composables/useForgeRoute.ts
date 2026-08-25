/**
 * useForgeRoute：响应式 URL 生成器，内部处理 level 加载状态
 * @see .docs/SPEC.md §4.1.7
 *
 * - level 未加载时返回空字符串 ''（不抛错，模板不崩）
 * - level 加载完成后自动重新计算并返回正确 URL
 * - 用户无需关心 levelLoaded 状态，直接用即可
 */

import { computed, type ComputedRef, inject, onMounted, ref } from 'vue';
import { FORGE_INJECTION_KEY } from '../plugin.js';
import type { RouteForge } from '@route-forge/core';

export function useForgeRoute(
  level: string | (() => string),
  name: string | (() => string),
  params?: () => Record<string, unknown>,
): ComputedRef<string> {
  const forge = inject(FORGE_INJECTION_KEY) as RouteForge;

  // 响应式追踪 level 加载状态（computed 依赖此 ref 触发重新计算）
  const levelLoaded = ref(forge.isLoaded(typeof level === 'function' ? level() : level));

  const lvl = typeof level === 'function' ? level() : level;
  if (!levelLoaded.value) {
    onMounted(() => {
      forge.load(lvl).then(() => {
        levelLoaded.value = true;
      }).catch(() => { /* 加载失败时 computed 返回 '' */
      });
    });
  }

  return computed(() => {
    // level 未加载 → 返回空字符串，不抛错
    if (!levelLoaded.value) return '';
    const l = typeof level === 'function' ? level() : level;
    const n = typeof name === 'function' ? name() : name;
    const p = params ? params() : undefined;
    return forge.route(l, n, p);
  });
}
