/**
 * useForgeRoute：响应式 URL 生成器，内部处理 level 加载状态
 * @see .docs/SPEC.md §4.1.7
 *
 * - level 未加载时返回空字符串 ''（不抛错，模板不崩）
 * - level 加载完成后自动重新计算并返回正确 URL
 * - 路由名不存在或必填参数缺失等渲染期错误：降级为 '' 保证渲染不中断，
 *   同时以醒目的样式化 warn 输出完整错误（含堆栈）——开发期可见，生产无副作用
 * - 用户无需关心 levelLoaded 状态，直接用即可
 */

import { computed, type ComputedRef, inject, onMounted, ref } from 'vue';
import { FORGE_INJECTION_KEY } from '../plugin.js';
import type { RouteForge } from '@route-forge/core';

/** 渲染期错误降级输出：橙色加粗标签 + 完整错误对象，控制台一眼可见 */
function warnRenderError(error: unknown): void {
  console.warn(
    '%c[route-forge]%c useForgeRoute 渲染期错误（已降级为空字符串，渲染未中断）',
    'color:#e67e22;font-weight:bold',
    'color:inherit',
    error,
  );
}

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
    try {
      return forge.route(l, n, p);
    } catch (e) {
      warnRenderError(e);
      return '';
    }
  });
}
