/**
 * 业务请求 URL 构建：由路由元信息 + 传参拼最终请求 URL，并选方法、追加 query。
 *
 * 均为纯函数（不读取工厂闭包状态）：需要 baseURL / urlPrefix 的通过 ctx 在调用时传入，
 * 由调用方实时读取（含自动发现回填后的值），避免快照冻结。
 * @see .docs/SPEC.md §4.1.3
 */

import { InvalidPathParamError, MissingRouteParamError } from '../errors.js';
import type { RouteMeta } from '../types.js';
import { joinBaseAndPath, trimTrailingSlash, withLeadingSlash } from './utils.js';

/** 业务请求 URL 上下文（buildRequestUrl 用）；urlPrefix 为后端下发的实时值 */
export interface RequestUrlContext {
  baseURL: string;
  urlPrefix: string;
}

/**
 * 由路由元信息 + 传参构建最终请求 URL（含路径参数替换、可选参数清理、前缀拼接）。
 * 抛错语义：缺失必填参数 → MissingRouteParamError；路径参数为对象 → InvalidPathParamError（同为 RF_FE_003）。
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
    // 附 URI 模板：用户无需翻缓存即可对照该传哪些参数
    throw new MissingRouteParamError(meta.name, missingRequired, meta.uri);
  }

  // 2. 单次遍历替换所有占位符：避免参数值中的 "{other}" 文本被后续参数二次替换（占位符注入）
  let uri = meta.uri.replace(/\{([^{}]+)\}/g, (match, raw: string) => {
    const optional = raw.endsWith('?');
    const name = optional ? raw.slice(0, -1) : raw;
    if (values[name] !== undefined) {
      const val = values[name];
      if (typeof val === 'object') {
        throw new InvalidPathParamError(meta.name, name, val);
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
    const prefix = trimTrailingSlash(ctx.urlPrefix);
    return uri.startsWith('/') ? `${prefix}${uri}` : `${prefix}/${uri}`;
  }
  const base = trimTrailingSlash(ctx.baseURL);
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
