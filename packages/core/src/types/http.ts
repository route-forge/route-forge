/**
 * 请求 / 响应 HTTP 层类型（拦截器、adapter、api 调用参数共用）
 * @see .docs/SPEC.md §4.1.3a, §4.3
 */

import type { RouteMeta } from './manifest.js';

/**
 * 请求拦截器接收/返回的配置对象（可变，返回修改后的版本）
 */
export interface RequestConfig {
  route: string;
  level: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  params: Record<string, unknown>;
  meta: RouteMeta;
  /** 请求超时毫秒数 */
  timeout?: number;
  /** 自定义 query 序列化函数 */
  paramsSerializer?: (params: Record<string, unknown>) => string;
  /** 请求取消信号（AbortSignal），用于取消已发出的请求 */
  signal?: AbortSignal;
}

/**
 * 响应拦截器首段接收的完整数据对象
 */
export interface ResponseData {
  route: string;
  level: string;
  method: string;
  url: string;
  status: number;
  headers: Headers;
  data: unknown;
  config: RequestConfig;
}

/**
 * forge.api() 返回的可取消请求对象。
 * 继承 Promise，附加 abort() 方法用于取消请求。
 * 内部自动创建 AbortController，用户无需手动管理。
 */
export interface ForgeRequest<T = unknown> extends Promise<T> {
  /** 取消请求。调用后请求将被中止，Promise reject 为 RequestAbortedError */
  abort(): void;
}

/**
 * forge.api(level, name, params) 调用参数
 *
 * 参数解析规则（智能消解）：
 *   1. `params` — 显式指定路径参数，优先级最高
 *   2. 平铺的 string | number 值 — 作为路径参数（含与 query/body/headers 同名的 key）
 *   3. `query` (对象) — 查询参数，序列化到 URL query string
 *   4. `body` (非 string/number) — 请求体
 *   5. `headers` (对象) — 自定义请求头
 *
 * 当路径参数名与 query/body/headers 冲突时：
 *   - 值为 string | number → 智能识别为路径参数
 *   - 同时提供 params 显式指定 → params 优先，固定 key 按原定义处理
 */
export interface ApiCallParams {
  /** 路径参数：填充到 URI 模板的 {name} 占位符 */
  [paramName: string]: unknown;

  /** 显式指定路径参数（优先级最高，解决路径参数名与 query/body/headers 冲突的场景） */
  params?: Record<string, unknown>;
  /**
   * 查询参数（对象 → query string）或路径参数（string | number → 填充 {query} 占位符）
   * @see .docs/SPEC.md §4.1.3 参数智能解析
   */
  query?: Record<string, unknown> | string | number;
  /**
   * 请求体（非基元值 → body）或路径参数（string | number → 填充 {body} 占位符）
   */
  body?: unknown;
  /**
   * 自定义请求头（对象 → headers）或路径参数（string | number → 填充 {headers} 占位符）
   */
  headers?: Record<string, string> | string | number;
  /**
   * 单次请求超时覆盖（毫秒）；不传时使用 createRouteForge({ timeout }) 全局值
   */
  timeout?: number;
}

/**
 * Adapter 选择值
 */
export type AdapterOption = 'auto' | 'axios' | 'builtin' | Fetcher;

/**
 * Fetcher 接口（自定义 adapter）
 * @see .docs/SPEC.md §4.3.3
 */
export interface Fetcher {
  request(config: RequestConfig): Promise<ResponseData>;
  interceptors?: {
    request?: InterceptorManager<RequestConfig, RequestConfig>;
    response?: InterceptorManager<ResponseData, unknown>;
  };
}

/**
 * 拦截器管理器接口（与 axios use/eject/clear API 一致）
 *
 * 双类型参数说明（对应 SPEC §4.1.3a）：
 *   - 请求拦截：TIn = TOut = RequestConfig（不可变换类型，仅修改字段）
 *   - 响应拦截：TIn = ResponseData, TOut = unknown（首段接收 ResponseData，
 *     后续段接收上一段返回值，返回类型由用户自行约束）
 */
export interface InterceptorManager<TIn, TOut = TIn> {
  use(
    onFulfilled?: (value: TIn) => TOut | Promise<TOut>,
    onRejected?: (error: unknown) => unknown | Promise<unknown>,
  ): number;
  eject(id: number): void;
  clear(): void;
  /** 内部使用：当前已注册拦截器快照 */
  forEach(fn: (handler: InterceptorHandler<TIn, TOut>) => void): void;
}

/**
 * 单个拦截器内部结构
 */
export interface InterceptorHandler<TIn, TOut = TIn> {
  id: number;
  onFulfilled?: (value: TIn) => TOut | Promise<TOut>;
  onRejected?: (error: unknown) => unknown | Promise<unknown>;
}
