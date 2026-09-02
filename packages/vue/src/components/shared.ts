/**
 * ForgeRoute / ForgeLink 共享内部实现：props 定义、降级报告、RouterLink 探测
 * （非公共 API，不进包入口导出）
 */

import { getCurrentInstance, type PropType } from 'vue';
import type { RouteForge } from '@route-forge/core';

/** ForgeRoute / ForgeLink 共享 props：level 静态快照，name / params 双形态响应式 */
// as const：防止 required: true 被宽化为 boolean，导致 defineComponent 推断出 string | undefined
export const forgeLinkProps = {
  /** 层级名：静态快照，setup 求值一次后固定，不支持中途切换 */
  level: { type: String, required: true },
  /** 路由名：string 或 getter 函数，保持响应式 */
  name: {
    type: [String, Function] as PropType<string | (() => string)>,
    required: true,
  },
  /** 路由参数：对象或 getter 函数，保持响应式 */
  params: {
    type: [Object, Function] as PropType<Record<string, unknown> | (() => Record<string, unknown>)>,
    required: false,
    default: undefined,
  },
} as const;

/** 解析出错降级报告：红色加粗标签 + 完整错误对象，控制台一眼可见（error 级，每次出错都报） */
export function reportDegrade(component: string, error: unknown): void {
  console.error(
    `%c[route-forge]%c ${component} 路由解析失败（已降级为空字符串，渲染未中断）`,
    'color:#c0392b;font-weight:bold',
    'color:inherit',
    error,
  );
}

/** level 未加载提示：每实例仅一次（warned 为组件实例内的可变标记），避免正常加载瞬态刷屏 */
export function warnUnloadedOnce(component: string, level: string, warned: { value: boolean }): void {
  if (warned.value) return;
  warned.value = true;
  console.warn(
    `[route-forge] ${component}: level "${level}" 尚未加载，链接暂不渲染（加载完成后自动出现）`,
  );
}

/**
 * 从 app 全局组件中探测 vue-router 的 RouterLink（零依赖：不 import vue-router）。
 * vue-router 在 app.use(router) 时会把 RouterLink / router-link 注册到全局组件表；
 * 仅在父组件局部注册 RouterLink 的场景探测不到，此时降级渲染原生 <a>（README 有说明）。
 */
export function resolveRouterLink(): object | null {
  const inst = getCurrentInstance();
  const comps = inst?.appContext.components as Record<string, object> | undefined;
  return comps?.RouterLink ?? comps?.['router-link'] ?? null;
}

export type { RouteForge };
