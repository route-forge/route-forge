/**
 * 层级元信息端点 URL 构建（baseURL + endpoint + /{level}）。
 * @see .docs/SPEC.md §4.1.2
 */

import { joinBaseAndPath, withLeadingSlash } from './utils.js';

/** 层级元信息端点上下文（buildUrl 用） */
export interface EndpointContext {
  baseURL: string;
  endpoint: string;
}

/** 层级路由元信息拉取端点 URL：baseURL + endpoint + /level */
export function buildUrl(level: string, ctx: EndpointContext): string {
  return `${joinBaseAndPath(ctx.baseURL, withLeadingSlash(ctx.endpoint))}/${encodeURIComponent(level)}`;
}
