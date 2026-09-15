/**
 * 拦截器执行编排（对齐 axios）：请求 LIFO、响应 FIFO。
 * @see .docs/SPEC.md §4.1.3a
 *
 * 串联实现采用标准 Promise 链语义：
 *   `Promise.resolve(initial).then(f0, r0).then(f1, r1).then(f2, r2)...`
 *   - onFulfilled 抛错 → 下一组 onRejected 接住
 *   - onRejected 返回值 → 后续 onFulfilled 继续执行（恢复为正常流程）
 *   - onRejected 抛错 → 下一组 onRejected 接住 / 进入调用方 catch
 *
 * 与存储层（manager.ts）解耦：本文件只消费 InterceptorManager.forEach 快照。
 */

import type {
  InterceptorHandler,
  InterceptorManager,
  RequestConfig,
  ResponseData,
} from '../types.js';
import { InvalidInterceptorReturnError } from '../errors.js';

/**
 * 串联请求拦截器（LIFO，对齐 axios）。
 *
 * - onFulfilled 必须返回对象（RequestConfig）；非对象抛 InvalidInterceptorReturnError
 * - onFulfilled 抛错 → 同管理器的 onRejected 链；某段 onRejected 返回值则恢复正序流程
 * - 仍未消化则向上抛，不发请求
 */
export async function runRequestInterceptors(
  manager: InterceptorManager<RequestConfig, RequestConfig>,
  initial: RequestConfig,
): Promise<RequestConfig> {
  const handlers: InterceptorHandler<RequestConfig, RequestConfig>[] = [];
  manager.forEach((h) => handlers.push(h));
  // 请求拦截器 LIFO（对齐 axios）：后注册先执行
  handlers.reverse();

  let p: Promise<unknown> = Promise.resolve(initial);
  for (const h of handlers) {
    const onF = h.onFulfilled;
    const onR = h.onRejected;
    p = p.then(
      async (v) => {
        if (!onF) return v;
        const result = await onF(v as RequestConfig);
        if (result === null || typeof result !== 'object') {
          throw new InvalidInterceptorReturnError();
        }
        return result;
      },
      (e) => (onR ? onR(e) : Promise.reject(e)),
    );
  }
  return p as Promise<RequestConfig>;
}

/**
 * 串联响应拦截器（FIFO，对齐 axios）。
 *
 * - HTTP 非 2xx 或任一 onFulfilled 抛错 → onRejected 链；onRejected 返回值则恢复正序流程
 * - 首段 onFulfilled 接收 ResponseData；后续段接收上一段返回值（类型由用户约束）
 * - 末段返回值即 forge.api() 的 resolve 值
 *
 * @param source 已包含 HTTP 错误转换逻辑的 ResponseData Promise
 *              （HTTP 非 2xx 时 reject 为 HTTPError；网络层错误 reject 为 NetworkError）
 */
export async function runResponseInterceptors(
  manager: InterceptorManager<ResponseData, unknown>,
  source: Promise<ResponseData>,
): Promise<unknown> {
  const handlers: InterceptorHandler<ResponseData, unknown>[] = [];
  manager.forEach((h) => handlers.push(h));

  let p: Promise<unknown> = source;
  for (const h of handlers) {
    const onF = h.onFulfilled;
    const onR = h.onRejected;
    p = p.then(
      (v) => (onF ? onF(v as ResponseData) : v),
      (e) => (onR ? onR(e) : Promise.reject(e)),
    );
  }
  return p;
}
