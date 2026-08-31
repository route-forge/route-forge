/**
 * URL 构建与调用参数解析：全部为纯函数（不读取工厂闭包状态）。
 *
 * 需要 baseURL / endpoint / urlPrefix 的函数通过 ctx 参数在调用时传入，
 * 由调用方实时读取（含自动发现回填后的值），避免快照冻结。
 *
 * @see .docs/SPEC.md §4.1.3
 */

import { ForgeError, MissingRouteParamError } from './errors.js';
import type { ApiCallParams, RouteMeta } from './types.js';

/** 层级元信息端点上下文（buildUrl 用） */
export interface EndpointContext {
  baseURL: string;
  endpoint: string;
}

/** 业务请求 URL 上下文（buildRequestUrl 用）；urlPrefix 为后端下发的实时值 */
export interface RequestUrlContext {
  baseURL: string;
  urlPrefix: string;
}

/** 层级路由元信息拉取端点 URL：baseURL + endpoint + /level */
export function buildUrl(level: string, ctx: EndpointContext): string {
  const base = ctx.baseURL.endsWith('/') ? ctx.baseURL.slice(0, -1) : ctx.baseURL;
  const ep = ctx.endpoint.startsWith('/') ? ctx.endpoint : `/${ctx.endpoint}`;
  return `${base}${ep}/${encodeURIComponent(level)}`;
}

/**
 * 由路由元信息 + 传参构建最终请求 URL（含路径参数替换、可选参数清理、前缀拼接）。
 * 抛错语义：缺失必填参数 → MissingRouteParamError；路径参数为对象 → ForgeError(RF_FE_003)。
 */
export function buildRequestUrl(
  meta: RouteMeta,
  params: Record<string, unknown>,
  ctx: RequestUrlContext,
): string {
  const defaults = meta.parameter_defaults ?? {};
  const missingRequired: string[] = [];

  // 1. 预解析每个声明参数的最终值（显式传参 > 后端默认值），并收集缺失的必填参数
  const values: Record<string, unknown> = {};
  for (const p of meta.parameters) {
    let v = params[p];
    // 参数未传时回退到后端下发的默认值
    if ((v === undefined || v === null) && p in defaults) {
      v = defaults[p];
    }
    if (v === undefined || v === null) {
      // 可选参数（URI 中 {param?}）：稍后替换为空字符串；其余记为缺失
      if (!meta.uri.includes(`{${p}?}`)) {
        missingRequired.push(p);
      }
    } else {
      values[p] = v;
    }
  }
  if (missingRequired.length > 0) {
    throw new MissingRouteParamError(meta.name, missingRequired);
  }

  // 2. 单次遍历替换所有占位符：避免参数值中的 "{other}" 文本被后续参数二次替换（占位符注入）
  let uri = meta.uri.replace(/\{([^{}]+)\}/g, (match, raw: string) => {
    const optional = raw.endsWith('?');
    const name = optional ? raw.slice(0, -1) : raw;
    if (values[name] !== undefined) {
      const val = values[name];
      if (typeof val === 'object') {
        throw new ForgeError(
          `Path parameter "${name}" must be a primitive value (string, number, boolean), got ${typeof val}`,
          { code: 'RF_FE_003', route: meta.name, context: { param: name, value: val } },
        );
      }
      return encodeURIComponent(String(val));
    }
    // 值缺失：可选参数替换为空，未声明的占位符保持原样（不在 parameters 中）
    return optional ? '' : match;
  });
  // 清理可选参数移除后残留的连续 / 或尾部 /
  uri = uri.replace(/\/+/g, '/').replace(/\/$/, '');
  // url_prefix 含协议（如 https://api.example.com）时直接作为完整基础 URL，跳过 baseURL
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(ctx.urlPrefix)) {
    const prefix = ctx.urlPrefix.endsWith('/') ? ctx.urlPrefix.slice(0, -1) : ctx.urlPrefix;
    return uri.startsWith('/') ? `${prefix}${uri}` : `${prefix}/${uri}`;
  }
  const base = ctx.baseURL.endsWith('/') ? ctx.baseURL.slice(0, -1) : ctx.baseURL;
  const prefix = ctx.urlPrefix;
  return uri.startsWith('/') ? `${base}${prefix}${uri}` : `${base}${prefix}/${uri}`;
}

/** 选取实际请求方法：跳过 HEAD，取首个非 HEAD 方法，兜底 GET。 */
export function pickMethod(meta: RouteMeta): string {
  const m = meta.methods.find((x) => x.toUpperCase() !== 'HEAD');
  return (m ?? meta.methods[0] ?? 'GET').toUpperCase();
}

/** 追加查询参数到 URL（跳过 undefined/null，无有效参数时原样返回）。 */
export function appendQuery(url: string, query?: Record<string, unknown>): string {
  if (!query) return url;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    usp.append(k, String(v));
  }
  const qs = usp.toString();
  if (!qs) return url;
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

/**
 * 智能解析 ApiCallParams，分离路径参数 / query / body / headers。
 *
 * 规则：
 *   1. `params` 显式指定路径参数 → 优先级最高
 *   2. 平铺的 string | number 值（含与 query/body/headers 同名的 key）→ 路径参数
 *   3. `query` (对象) → 查询参数；`body` (非 string/number) → 请求体；`headers` (对象) → 请求头
 *
 * @see .docs/SPEC.md §4.1.3
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
