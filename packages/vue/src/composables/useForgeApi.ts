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
 *
 * pending 采用引用计数：并发多个 call 时，全部完成才置 false
 * （先完成的 call 不再把其他在途请求的 pending 提前清掉）。
 */

import type { Ref } from 'vue';
import { ref } from 'vue';
import { useForge } from '../plugin.js';
import type {
  BoundForge,
  RouteForge,
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
  const bound = level !== undefined ? useForge(level, prefix as string) : undefined;
  const unbound = bound === undefined ? useForge() : undefined;
  const pending = ref(false);
  const error = ref<unknown>(null);
  // 并发计数：setup 闭包变量（组件实例生命周期存活）
  let inflight = 0;

  async function call(...args: unknown[]): Promise<{ data: unknown; error: unknown }> {
    inflight++;
    pending.value = true;
    error.value = null;
    try {
      // 按绑定形态分发：bound 走 BoundForge.api(name, params)，unbound 走 RouteForge.api(level, name, params)
      // （窄断言替代 as any：重载签名已保证参数形状，此处仅消除联合类型/框架特化类型的分支歧义）
      const data = bound !== undefined
        ? await (bound as unknown as BoundForge).api(args[0] as string, args[1] as never)
        : await (unbound as RouteForge).api(args[0] as string, args[1] as string, args[2] as never);
      return { data, error: null };
    } catch (e) {
      error.value = e;
      return { data: undefined, error: e };
    } finally {
      inflight--;
      pending.value = inflight > 0;
    }
  }

  return { pending, error, call: call as unknown as UseForgeApiCall };
}
