/**
 * ForgeLink：便捷链接组件，封装 useForgeRoute 的"先空串、后更新"异步行为
 * @see .docs/SPEC.md §4.1.7
 *
 * - loaded（href !== ''）时直接渲染链接：`as` prop 显式注入的组件优先（同时收到 href+to）；
 *   否则探测到 vue-router 全局注册的 RouterLink 则渲染 <RouterLink :to="href">（SPA 内部跳转），
 *   再否则渲染原生 <a :href="href">
 * - 三态分流：未加载 → loading 插槽；已加载但解析失败 → error 插槽（props { error }，
 *   未传回落 loading）；成功 → 链接
 * - 未加载且未传 loading 插槽时默认不渲染；每实例以 console.warn 提醒一次（防刷屏）
 * - 路由解析出错以 console.error 报告，渲染不中断
 * - attrs 透传到根元素（class / target / rel 等），生成的 href / to 优先于同名 attr
 * - level 为静态快照，name / params 保持响应式（值或 getter 函数双形态均可）
 */

import { defineComponent, h, type SlotsType, type VNode } from 'vue';
import { useInjectedForge } from '../useInjectedForge.js';
import { useForgeRouteState } from '../composables/useForgeRoute.js';
import {
  forgeLinkProps,
  reportDegrade,
  resolveRouterLink,
  warnUnloadedOnce,
} from './shared.js';

export const ForgeLink = defineComponent({
  name: 'ForgeLink',
  // attrs 透传到 <a> / RouterLink，但 href / to 必须以组件生成的 URL 为准（显式合并）
  inheritAttrs: false,
  props: forgeLinkProps,
  slots: Object as SlotsType<{
    /** 链接文本/内容 */
    default?: () => VNode[];
    /** 未加载占位 */
    loading?: () => VNode[];
    /** 解析失败（路由名不存在等）：props 携带错误对象；未传回落 loading 插槽 */
    error?: (props: { error: unknown }) => VNode[];
  }>,
  setup(props, { slots, attrs }) {
    const forge = useInjectedForge('ForgeLink');
    // 统一收敛为 getter：name / params 双形态（值或函数）均保持响应式
    const nameGetter = () => (typeof props.name === 'function' ? props.name() : props.name);
    const paramsGetter = () =>
      typeof props.params === 'function' ? props.params() : props.params;
    const state = useForgeRouteState(props.level, nameGetter, paramsGetter, {
      onDegrade: (e) => reportDegrade('ForgeLink', e),
    });
    const unloadWarned = { value: false };
    // 链接组件解析：显式 as prop 优先（同时收 href+to，对齐 react 包契约）；
    // 否则探测 RouterLink（app.use(router) 时全局注册，app 生命周期内不变，setup 时探测一次即可）
    const routerLink = resolveRouterLink();

    return () => {
      const url = state.href.value;
      const loaded = url !== '';
      if (!loaded && !forge.isLoaded(props.level)) {
        warnUnloadedOnce('ForgeLink', props.level, unloadWarned);
      }
      // 三态分流：未加载 → loading；解析失败 → error（未传回落 loading）
      if (!state.isLevelLoaded.value) return slots.loading ? slots.loading() : null;
      if (state.error.value != null) {
        return slots.error ? slots.error({ error: state.error.value }) : (slots.loading ? slots.loading() : null);
      }

      const children = slots.default ? slots.default() : undefined;
      if (props.as) {
        // 手动注入的链接组件：同时收到 href 与 to（对齐 @route-forge/react 的 as 契约）
        return h(
          props.as as object,
          { ...(attrs as Record<string, unknown>), to: url, href: url },
          { default: () => children },
        );
      }
      if (routerLink) {
        return h(
          routerLink,
          { ...(attrs as Record<string, unknown>), to: url },
          { default: () => children },
        );
      }
      return h('a', { ...(attrs as Record<string, unknown>), href: url }, children);
    };
  },
});

export type ForgeLinkProps = InstanceType<typeof ForgeLink>['$props'];
