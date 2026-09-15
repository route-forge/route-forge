/**
 * URL 构建与调用参数解析（公共内部入口/桶）
 *
 * 实现按职责拆分在 `url/` 下，本文件仅 re-export，保持 `./url-builder.js` 导入路径稳定：
 *   - url/endpoint.ts  层级元信息端点：buildUrl / EndpointContext
 *   - url/request.ts   业务请求 URL：buildRequestUrl / pickMethod / appendQuery / RequestUrlContext
 *   - url/params.ts    调用入参智能解析：resolveApiParams
 * 斜杠规范化原语（joinBaseAndPath 等）见 url/utils.ts（另经 ./url-utils.js 桶暴露）。
 * @see .docs/SPEC.md §4.1.3
 */

export { buildUrl, type EndpointContext } from './url/endpoint.js';
export {
  buildRequestUrl,
  pickMethod,
  appendQuery,
  type RequestUrlContext,
} from './url/request.js';
export { resolveApiParams } from './url/params.js';
