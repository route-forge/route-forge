/**
 * useForgeApi：包装 forge.api()，自动管理 loading/error 状态
 * @see .docs/SPEC.md §4.1.7
 *
 * 支持：
 *   - useForgeApi()             — call(level, name, params)
 *   - useForgeApi({ level })    — call(name, params)，自动绑定层级
 *   - useForgeApi({ level, prefix }) — call(suffix, params)，自动绑定层级 + 拼接前缀
 *
 * 类型推断：
 *   当 ForgeRouteMap 通过 codegen 或 module augmentation 定义时，
 *   level / name / params 均自动推断，IDE 提供补全提示。
 */

import { useCallback, useState } from 'react';
import { useForge } from '../provider.js';
import type {
  ApiCallParams,
  ForgeApiParams,
  ForgeApiResponse,
  ForgeRouteName,
} from '@route-forge/core';

/** call 函数签名 — 未绑定 level，需要显式传入 */
export interface UseForgeApiCall {
  (level: string, name: string, params?: ApiCallParams): Promise<{
    data: unknown;
    error: unknown;
  }>;
}

/** call 函数签名 — 已绑定 level，无需再传 */
export interface UseForgeApiBoundCall<L extends string> {
  (name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): Promise<{
    data: ForgeApiResponse<L, ForgeRouteName<L>>;
    error: unknown;
  }>;
}

export interface UseForgeApiReturn {
  pending: boolean;
  error: unknown;
  call: UseForgeApiCall;
}

export interface UseForgeApiBoundReturn<L extends string> {
  pending: boolean;
  error: unknown;
  call: UseForgeApiBoundCall<L>;
}

/** 不绑定层级 — call 需要传 level */
export function useForgeApi(): UseForgeApiReturn;
/** 绑定层级 — call 无需传 level */
export function useForgeApi<L extends string>(options: { level: L }): UseForgeApiBoundReturn<L>;
/** 绑定层级 + 前缀 — call 无需传 level，路由名自动拼接 prefix */
export function useForgeApi<L extends string>(options: {
  level: L;
  prefix: string
}): UseForgeApiBoundReturn<L>;
export function useForgeApi(opts?: {
  level?: string;
  prefix?: string
}): UseForgeApiReturn | UseForgeApiBoundReturn<string> {
  const forge = opts?.level !== undefined
    ? useForge({ level: opts.level, prefix: opts.prefix as string })
    : useForge();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const call = useCallback(async (...args: unknown[]): Promise<{
    data: unknown;
    error: unknown
  }> => {
    setPending(true);
    setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await (forge as any).api(...args);
      setError(null);
      return { data, error: null };
    } catch (e) {
      setError(e);
      return { data: undefined, error: e };
    } finally {
      setPending(false);
    }
  }, [forge]);

  return { pending, error, call: call as any };
}
