/**
 * useForgeRoute：响应式 URL 生成器，内部处理 level 加载状态
 * @see .docs/SPEC.md §4.1.7
 *
 * - level 未加载时返回空字符串 ''（不抛错，模板不崩）
 * - level 加载完成后自动重新计算并返回正确 URL
 * - 路由名不存在或必填参数缺失等渲染期错误：降级为 '' 保证渲染不中断，
 *   同时以醒目的样式化 warn 输出完整错误（含堆栈）——开发期可见，生产无副作用
 * - level 为静态字符串（层级是确定性声明，不支持 `() => string` 函数形式）：
 *   不支持中途动态切换 level
 *   （需要另一个层级请在别的组件 / 别的 useForgeRoute 调用里分别使用，与 useForge 契约一致）
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

/** 降级报告钩子：组件层（ForgeRoute/ForgeLink）用它把默认 warn 升级为 error，避免双重打印 */
export interface ForgeRouteDegradeHooks {
  onDegrade?: (error: unknown) => void;
}

export function useForgeRoute(
  level: string,
  name: string | (() => string),
  params?: () => Record<string, unknown> | undefined,
  hooks?: ForgeRouteDegradeHooks,
): ComputedRef<string> {
  // 运行时守卫：level 必须是静态字符串（类型收窄后防 JS 用户误用静默降级为空链接）
  if (typeof level !== 'string') {
    throw new TypeError(
      '[route-forge/vue] useForgeRoute(): level must be a static string — ' +
      'getter form is not supported (levels are deterministic declarations; ' +
      'create another useForgeRoute call for another level)',
    );
  }

  const forge = inject(FORGE_INJECTION_KEY) as RouteForge;

  // level 为静态字符串（层级是确定性声明）：绑定即固定，不支持中途动态切换
  //（需要另一个层级请在别的组件 / 别的 useForgeRoute 调用里分别使用，与 useForge 契约一致）。
  // name / params 仍保持响应式。
  const lvl = level;

  // 响应式追踪该 level 的加载状态（computed 依赖此 ref 触发重算）
  const levelLoaded = ref(forge.isLoaded(lvl));

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
    // lvl 为 setup 快照（静态）；name / params 每次重算读取，保持响应式
    const n = typeof name === 'function' ? name() : name;
    const p = params ? params() : undefined;
    try {
      return forge.route(lvl, n, p);
    } catch (e) {
      (hooks?.onDegrade ?? warnRenderError)(e);
      return '';
    }
  });
}
