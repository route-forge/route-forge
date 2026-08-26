/**
 * useForgeApi：包装 forge.api()，自动管理 loading/error 状态
 * @see .docs/SPEC.md §4.1.7
 *
 * 支持：
 *   - useForgeApi()             — call(level, name, params)
 *   - useForgeApi(level)        — call(name, params)，自动绑定层级
 *   - useForgeApi(level, prefix) — call(suffix, params)，自动绑定层级 + 拼接前缀
 *
 * 类型推断：
 *   当 ForgeRouteMap 通过 codegen 或 module augmentation 定义时，
 *   level / name / params 均自动推断，IDE 提供补全提示。
 */

import type { Ref } from 'vue';
import { ref } from 'vue';
import { useForge } from '../plugin.js';
import type {
  UseForgeApiBoundCall,
  UseForgeApiBoundReturn,
  UseForgeApiCall,
  UseForgeApiReturn,
} from '@route-forge/core';

// Vue 特化类型：pending/error 为 Ref
export type { UseForgeApiCall, UseForgeApiBoundCall };
export type UseForgeApiReturnVue = UseForgeApiReturn<Ref<boolean>, Ref<unknown>>;
export type UseForgeApiBoundReturnVue<L extends string> = UseForgeApiBoundReturn<L, Ref<boolean>, Ref<unknown>>;

/** 不绑定层级 — call 需要传 level */
export function useForgeApi(): UseForgeApiReturnVue;
/** 绑定层级 — call 无需传 level */
export function useForgeApi<L extends string>(level: L): UseForgeApiBoundReturnVue<L>;
/** 绑定层级 + 前缀 — call 无需传 level，路由名自动拼接 prefix */
export function useForgeApi<L extends string>(level: L, prefix: string): UseForgeApiBoundReturnVue<L>;
export function useForgeApi(level?: string, prefix?: string): UseForgeApiReturnVue | UseForgeApiBoundReturnVue<string> {
  const forge = level !== undefined ? useForge(level, prefix as string) : useForge();
  const pending = ref(false);
  const error = ref<unknown>(null);

  async function call(...args: unknown[]): Promise<{ data: unknown; error: unknown }> {
    pending.value = true;
    error.value = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await (forge as any).api(...args);
      return { data, error: null };
    } catch (e) {
      error.value = e;
      return { data: undefined, error: e };
    } finally {
      pending.value = false;
    }
  }

  return { pending, error, call: call as any };
}
