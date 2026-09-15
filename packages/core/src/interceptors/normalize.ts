/**
 * 创建时声明式拦截器归一（SPEC §4.1.1）：把「单拦截器三写法」规整为 onFulfilled/onRejected 钩子对。
 * @see .docs/SPEC.md §4.1.1
 *
 * 与运行时存储（manager.ts）、执行编排（runner.ts）解耦——本文件只做入参形状归一。
 */

/**
 * 声明式入口只描述**一个**拦截器，支持三种写法：
 *   - `resolve`（函数）             → onFulfilled
 *   - `[resolve, reject]`（数组）    → 按位置映射 onFulfilled / onRejected；允许缺位
 *                                     （`[resolve]` 仅成功、`[undefined, reject]` 仅失败）
 *   - `{ resolve?, reject? }`（对象） → 具名映射 onFulfilled / onRejected
 *
 * 需要注册多个拦截器请改用运行时 `forge.interceptors.request/response.use()`（可多次调用）。
 *
 * @returns 归一后的钩子对；`{}`（两字段皆缺）表示未提供任何有效钩子。
 * @throws TypeError 值为不支持的类型，或 resolve/reject 存在但非函数时。
 */
export function normalizeInterceptorDeclaration<TIn, TOut = TIn>(
  value: unknown,
): {
  onFulfilled?: (value: TIn) => TOut | Promise<TOut>;
  onRejected?: (error: unknown) => unknown | Promise<unknown>;
} {
  if (value === null || value === undefined) return {};

  let rawResolve: unknown;
  let rawReject: unknown;

  if (typeof value === 'function') {
    rawResolve = value;
  } else if (Array.isArray(value)) {
    rawResolve = value[0];
    rawReject = value[1];
  } else if (typeof value === 'object') {
    const obj = value as { resolve?: unknown; reject?: unknown };
    rawResolve = obj.resolve;
    rawReject = obj.reject;
  } else {
    throw new TypeError(
      `Interceptor declaration must be a function, a [resolve, reject] tuple, or a { resolve, reject } object; received ${typeof value}.`,
    );
  }

  const handler: {
    onFulfilled?: (value: TIn) => TOut | Promise<TOut>;
    onRejected?: (error: unknown) => unknown | Promise<unknown>;
  } = {};

  if (rawResolve !== undefined && rawResolve !== null) {
    if (typeof rawResolve !== 'function') {
      throw new TypeError(
        `Interceptor "resolve" (onFulfilled) must be a function; received ${typeof rawResolve}.`,
      );
    }
    handler.onFulfilled = rawResolve as (value: TIn) => TOut | Promise<TOut>;
  }

  if (rawReject !== undefined && rawReject !== null) {
    if (typeof rawReject !== 'function') {
      throw new TypeError(
        `Interceptor "reject" (onRejected) must be a function; received ${typeof rawReject}.`,
      );
    }
    handler.onRejected = rawReject as (error: unknown) => unknown | Promise<unknown>;
  }

  return handler;
}
