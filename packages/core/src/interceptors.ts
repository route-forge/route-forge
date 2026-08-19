/**
 * 拦截器管理器实现
 * @see .docs/SPEC.md §4.1.3a, §4.1.1
 *
 * 执行顺序约定：所有拦截器（请求 / 响应 / 错误）统一按注册顺序（先注册先执行）正序消费。
 * 与 axios 差异：axios 请求拦截逆序、响应拦截正序；Route Forge 统一正序以简化心智模型。
 *
 * 串联实现：采用标准 Promise 链语义
 *   `Promise.resolve(initial).then(f0, r0).then(f1, r1).then(f2, r2)...`
 *   - onFulfilled 抛错 → 下一组 onRejected 接住
 *   - onRejected 返回值 → 后续 onFulfilled 继续执行（恢复为正常流程）
 *   - onRejected 抛错 → 下一组 onRejected 接住 / 进入调用方 catch
 */

import type {
  InterceptorHandler,
  InterceptorManager,
  RequestConfig,
  ResponseData,
} from './types.js';
import { InvalidInterceptorReturnError } from './errors.js';

export class InterceptorManagerImpl<TIn, TOut = TIn> implements InterceptorManager<TIn, TOut> {
  private handlers: InterceptorHandler<TIn, TOut>[] = [];
  private nextId = 0;

  use(
    onFulfilled?: (value: TIn) => TOut | Promise<TOut>,
    onRejected?: (error: unknown) => unknown | Promise<unknown>,
  ): number {
    const id = this.nextId++;
    this.handlers.push({ id, onFulfilled, onRejected });
    return id;
  }

  eject(id: number): void {
    const idx = this.handlers.findIndex((h) => h.id === id);
    if (idx >= 0) this.handlers.splice(idx, 1);
  }

  clear(): void {
    this.handlers = [];
  }

  forEach(fn: (handler: InterceptorHandler<TIn, TOut>) => void): void {
    for (const h of this.handlers) fn(h);
  }

  /** 测试用：当前注册数量 */
  get size(): number {
    return this.handlers.length;
  }
}

/**
 * 串联请求拦截器（注册顺序正序）。
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
 * 串联响应拦截器（注册顺序正序）。
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

/**
 * 工厂函数：供自定义 Fetcher 复用同一套拦截器实现
 * @see .docs/SPEC.md §4.3.3
 */
export function createInterceptorManager<TIn, TOut = TIn>(): InterceptorManager<TIn, TOut> {
  return new InterceptorManagerImpl<TIn, TOut>();
}
