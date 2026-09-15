/**
 * ApiCallParams 智能解析：分离路径参数 / query / body / headers。
 * @see .docs/SPEC.md §4.1.3 参数智能解析
 *
 * 与 URL 拼接（url/request.ts）解耦——本文件只负责把一次 api() 调用的入参归一为
 * buildRequestUrl/appendQuery 可直接消费的分组。
 */

import type { ApiCallParams } from '../types.js';

/**
 * 智能解析 ApiCallParams，分离路径参数 / query / body / headers。
 *
 * 规则：
 *   1. `params` 显式指定路径参数 → 优先级最高
 *   2. 平铺的 string | number 值（含与 query/body/headers 同名的 key）→ 路径参数
 *   3. `query` (对象) → 查询参数；`body` (非 string/number) → 请求体；`headers` (对象) → 请求头
 */
export function resolveApiParams(input: ApiCallParams): {
  pathParams: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
} {
  const {
    params: explicitParams,
    query: rawQuery,
    body: rawBody,
    headers: rawHeaders,
    timeout: perCallTimeout,
    ...flatRest
  } = input;

  // 1. params 显式指定 → 作为路径参数基础
  const pathParams: Record<string, unknown> = explicitParams
    ? { ...explicitParams }
    : {};

  // 2. 其余平铺 key → 路径参数（params 优先，不覆盖已存在的 key）
  for (const [k, v] of Object.entries(flatRest)) {
    if (!(k in pathParams)) {
      pathParams[k] = v;
    }
  }

  // 3. 固定 key 智能消解：string/number → 路径参数；对象 → 固定用途
  let query: Record<string, unknown> | undefined;
  let body: unknown;
  let headers: Record<string, string> | undefined;

  // query: 对象类型 → 查询参数；string/number → 路径参数
  if (rawQuery !== undefined) {
    if (typeof rawQuery === 'object' && rawQuery !== null) {
      query = rawQuery as Record<string, unknown>;
    } else if (!('query' in pathParams)) {
      pathParams.query = rawQuery;
    }
  }

  // body: 非 string/number → 请求体；string/number → 路径参数
  if (rawBody !== undefined) {
    if (typeof rawBody !== 'string' && typeof rawBody !== 'number') {
      body = rawBody;
    } else if (!('body' in pathParams)) {
      pathParams.body = rawBody;
    }
  }

  // headers: 对象类型 → 请求头；string/number → 路径参数
  if (rawHeaders !== undefined) {
    if (typeof rawHeaders === 'object' && rawHeaders !== null) {
      headers = rawHeaders as Record<string, string>;
    } else if (!('headers' in pathParams)) {
      pathParams.headers = rawHeaders;
    }
  }

  return { pathParams, query, body, headers, timeout: perCallTimeout };
}
