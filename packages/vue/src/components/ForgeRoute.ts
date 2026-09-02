/**
 * ForgeRoute：URL 生成组件（通用形态），封装 useForgeRoute 的"先空串、后更新"异步行为
 * @see .docs/SPEC.md §4.1.7
 *
 * - 通过作用域插槽暴露 { href, loaded }，模板里自由决定渲染 <a>、RouterLink 或任意内容
 * - loaded = href !== ''（level 未加载与路由解析出错都降级为 ''，正好复用该哨兵值）
 * - 未加载且未传 loading 插槽时默认不渲染；每实例以 console.warn 提醒一次（防刷屏）
 * - 路由解析出错（UnknownRouteError 等）以 console.error 报告，渲染不中断
 * - level 为静态快照，name / params 保持响应式（值或 getter 函数双形态均可）
 */

import { defineComponent, inject, type SlotsType, type VNode } from 'vue';
import { FORGE_INJECTION_KEY } from '../plugin.js';
import { useForgeRoute } from '../composables/useForgeRoute.js';
import { forgeLinkProps, reportDegrade, warnUnloadedOnce } from './shared.js';
import type { RouteForge } from '@route-forge/core';

export const ForgeRoute = defineComponent({
  name: 'ForgeRoute',
  // 根节点是用户插槽内容，框架透传 attrs 落到插槽上没有意义，显式关闭
  inheritAttrs: false,
  props: forgeLinkProps,
  slots: Object as SlotsType<{
    default?: (props: { href: string; loaded: boolean }) => VNode[];
    loading?: () => VNode[];
  }>,
  setup(props, { slots }) {
    const forge = inject(FORGE_INJECTION_KEY) as RouteForge;
    // 统一收敛为 getter：name / params 双形态（值或函数）均保持响应式
    const nameGetter = () => (typeof props.name === 'function' ? props.name() : props.name);
    const paramsGetter = () =>
      typeof props.params === 'function' ? props.params() : props.params;
    const href = useForgeRoute(props.level, nameGetter, paramsGetter, {
      onDegrade: (e) => reportDegrade('ForgeRoute', e),
    });
    const unloadWarned = { value: false };

    return () => {
      const url = href.value;
      const loaded = url !== '';
      if (!loaded && !forge.isLoaded(props.level)) {
        warnUnloadedOnce('ForgeRoute', props.level, unloadWarned);
      }
      // 未加载/解析出错：loading 插槽优先（无则不渲染），与 ForgeLink 行为一致
      if (!loaded) return slots.loading ? slots.loading() : null;
      return slots.default ? slots.default({ href: url, loaded }) : null;
    };
  },
});

export type ForgeRouteProps = InstanceType<typeof ForgeRoute>['$props'];
