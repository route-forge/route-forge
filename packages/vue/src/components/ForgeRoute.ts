/**
 * ForgeRoute：URL 生成组件（通用形态），封装 useForgeRoute 的"先空串、后更新"异步行为
 * @see .docs/SPEC.md §4.1.7
 *
 * - 通过作用域插槽暴露 { href, loaded }，模板里自由决定渲染 <a>、RouterLink 或任意内容
 * - loaded = href !== ''（level 未加载与路由解析出错都降级为 ''，正好复用该哨兵值）
 * - 三态分流：未加载 → loading 插槽；已加载但解析失败 → error 插槽（props { error }，
 *   未传回落 loading）；成功 → default 插槽
 * - 未加载且未传 loading 插槽时默认不渲染；每实例以 console.warn 提醒一次（防刷屏）
 * - 路由解析出错（UnknownRouteError 等）以 console.error 报告，渲染不中断
 * - level 为静态快照，name / params 保持响应式（值或 getter 函数双形态均可）
 */

import { defineComponent, type SlotsType, type VNode } from 'vue';
import { useInjectedForge } from '../useInjectedForge.js';
import { useForgeRouteState } from '../composables/useForgeRoute.js';
import { forgeLinkProps, reportDegrade, warnUnloadedOnce } from './shared.js';

export const ForgeRoute = defineComponent({
  name: 'ForgeRoute',
  // 根节点是用户插槽内容，框架透传 attrs 落到插槽上没有意义，显式关闭
  inheritAttrs: false,
  props: forgeLinkProps,
  slots: Object as SlotsType<{
    default?: (props: { href: string; loaded: boolean }) => VNode[];
    loading?: () => VNode[];
    /** 解析失败（路由名不存在等）：props 携带错误对象；未传回落 loading 插槽 */
    error?: (props: { error: unknown }) => VNode[];
  }>,
  setup(props, { slots }) {
    const forge = useInjectedForge('ForgeRoute');
    // 统一收敛为 getter：name / params 双形态（值或函数）均保持响应式
    const nameGetter = () => (typeof props.name === 'function' ? props.name() : props.name);
    const paramsGetter = () =>
      typeof props.params === 'function' ? props.params() : props.params;
    const state = useForgeRouteState(props.level, nameGetter, paramsGetter, {
      onDegrade: (e) => reportDegrade('ForgeRoute', e, forge.warnings),
    });
    const unloadWarned = { value: false };

    return () => {
      const url = state.href.value;
      const loaded = url !== '';
      if (!loaded && !forge.isLoaded(props.level)) {
        warnUnloadedOnce('ForgeRoute', props.level, unloadWarned);
      }
      // 三态分流：未加载 → loading；解析失败 → error（未传回落 loading）
      if (!state.isLevelLoaded.value) return slots.loading ? slots.loading() : null;
      if (state.error.value != null) {
        return slots.error ? slots.error({ error: state.error.value }) : (slots.loading ? slots.loading() : null);
      }
      return slots.default ? slots.default({ href: url, loaded }) : null;
    };
  },
});

export type ForgeRouteProps = InstanceType<typeof ForgeRoute>['$props'];
