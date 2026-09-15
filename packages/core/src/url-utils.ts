/**
 * URL 基础拼接工具（公共内部入口/桶）
 *
 * 实现见 url/utils.ts，本文件仅 re-export，保持 `./url-utils.js` 导入路径稳定。
 */

export { trimTrailingSlash, withLeadingSlash, joinBaseAndPath } from './url/utils.js';
