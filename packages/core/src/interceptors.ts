/**
 * 拦截器（公共内部入口/桶）
 * @see .docs/SPEC.md §4.1.1, §4.1.3a
 *
 * 实现按职责拆分在 `interceptors/` 下，本文件仅 re-export，保持 `./interceptors.js` 导入路径稳定：
 *   - interceptors/manager.ts    注册存储：InterceptorManagerImpl / createInterceptorManager
 *   - interceptors/runner.ts     执行编排：runRequestInterceptors(LIFO) / runResponseInterceptors(FIFO)
 *   - interceptors/normalize.ts  创建时声明式入参归一：normalizeInterceptorDeclaration
 */

export { InterceptorManagerImpl, createInterceptorManager } from './interceptors/manager.js';
export { runRequestInterceptors, runResponseInterceptors } from './interceptors/runner.js';
export { normalizeInterceptorDeclaration } from './interceptors/normalize.js';
