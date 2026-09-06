/**
 * ForgeReady：ready 门闩组件——直接 mount 也能拿到 `ready().then(mount)` 同级的确定性。
 *
 * - ready() 未 resolve 时渲染 `fallback` 插槽（缺省不渲染任何内容），resolve 后渲染 default 插槽
 * - forge 已就绪（core `isReady()`）时同步开门，不产生多余的 fallback 首帧
 * - ready() reject：响亮 `console.error` 且保持闭门（与 `ready().then(mount).catch` 的语义对齐，
 *   不静默）——需要 reject 后继续渲染请勿使用本组件，改用 `ready().then(mount, onRejected)`
 *
 * @example
 * ```vue
 * <ForgeReady>
 *   <template #fallback><Splash /></template>
 *   <RouterView />
 * </ForgeReady>
 * ```
 */

import { defineComponent, ref, type SlotsType, type VNode } from 'vue';
import { useInjectedForge } from '../useInjectedForge.js';

export const ForgeReady = defineComponent({
  name: 'ForgeReady',
  slots: Object as SlotsType<{
    /** ready 后渲染的内容 */
    default?: () => VNode[];
    /** 门闩期间的占位 UI（缺省不渲染任何内容） */
    fallback?: () => VNode[];
  }>,
  setup(_, { slots }) {
    const forge = useInjectedForge('ForgeReady');
    const open = ref(forge.isReady());
    if (!open.value) {
      forge.ready().then(
        () => {
          open.value = true;
        },
        (err) => {
          console.error(
            '[route-forge] ForgeReady: ready() rejected — content stays gated (same as an unhandled ready().catch)',
            err,
          );
        },
      );
    }
    return () => (open.value ? slots.default?.() : (slots.fallback ? slots.fallback() : null));
  },
});

export type ForgeReadyProps = InstanceType<typeof ForgeReady>['$props'];
