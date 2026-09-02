/**
 * ForgeLink：便捷链接组件，封装 useForgeRoute 的"先空串、后更新"异步行为
 * @see .docs/SPEC.md §4.1.7
 *
 * - loaded（href !== ''）时直接渲染链接：检测到 vue-router 全局注册的 RouterLink
 *   则渲染 <RouterLink :to="href">（SPA 内部跳转），否则渲染原生 <a :href="href">
 * - 未加载（或路由解析出错）时渲染 loading 插槽，未传则默认不渲染；
 *   每实例以 console.warn 提醒一次（防刷屏）
 * - 路由解析出错以 console.error 报告，渲染不中断
 * - attrs 透传到根元素（class / target / rel 等），生成的 href / to 优先于同名 attr
 * - level 为静态快照，name / params 保持响应式（值或 getter 函数双形态均可）
 */

import { defineComponent, h, inject, type SlotsType, type VNode } from 'vue';
import { FORGE_INJECTION_KEY } from '../plugin.js';
import { useForgeRoute } from '../composables/useForgeRoute.js';
import {
  forgeLinkProps,
  reportDegrade,
  resolveRouterLink,
  warnUnloadedOnce,
} from './shared.js';
import type { RouteForge } from '@route-forge/core';

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
  }>,
  setup(props, { slots, attrs }) {
    const forge = inject(FORGE_INJECTION_KEY) as RouteForge;
    // 统一收敛为 getter：name / params 双形态（值或函数）均保持响应式
    const nameGetter = () => (typeof props.name === 'function' ? props.name() : props.name);
    const paramsGetter = () =>
      typeof props.params === 'function' ? props.params() : props.params;
    const href = useForgeRoute(props.level, nameGetter, paramsGetter, {
      onDegrade: (e) => reportDegrade('ForgeLink', e),
    });
    const unloadWarned = { value: false };
    // RouterLink 在 app.use(router) 时全局注册，app 生命周期内不变，setup 时探测一次即可
    const routerLink = resolveRouterLink();

    return () => {
      const url = href.value;
      const loaded = url !== '';
      if (!loaded && !forge.isLoaded(props.level)) {
        warnUnloadedOnce('ForgeLink', props.level, unloadWarned);
      }
      if (!loaded) return slots.loading ? slots.loading() : null;

      const children = slots.default ? slots.default() : undefined;
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
