/**
 * 拦截器管理器实现：use/eject/clear/forEach 的注册与快照存储（不含执行编排）。
 * @see .docs/SPEC.md §4.1.3a
 *
 * 执行顺序编排见 interceptors/runner.ts；创建时声明式入参归一见 interceptors/normalize.ts。
 */

import type { InterceptorHandler, InterceptorManager } from '../types.js';

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
 * 工厂函数：供自定义 Fetcher 复用同一套拦截器实现
 * @see .docs/SPEC.md §4.3.3
 */
export function createInterceptorManager<TIn, TOut = TIn>(): InterceptorManager<TIn, TOut> {
  return new InterceptorManagerImpl<TIn, TOut>();
}
