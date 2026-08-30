/**
 * Adapter 入口
 * @see .docs/SPEC.md §4.3
 *
 * Route Forge 提供三种 adapter：
 *   1. 'auto'（默认）：动态 import 探测宿主 axios（防静态打包误判），检测到则用之；否则用内置 builtin adapter
 *   2. 'axios'：强制宿主 axios，未安装抛 AdapterNotFoundError
 *   3. 'builtin'：强制内置实现
 * 自定义 Fetcher 接口直接传入即可（绕过 auto 检测）。
 */

import type { Fetcher, InterceptorManager, RequestConfig, ResponseData } from '../types.js';
import { AdapterNotFoundError } from '../errors.js';
import { createBuiltinHttp } from './builtin-http.js';
import { wrapAxiosAdapter } from './axios.js';

export type ResolvedAdapter = {
  request: (config: RequestConfig) => Promise<ResponseData>;
  /**
   * 原始请求（跳过拦截链），可选。
   * 供层级元信息拉取使用：元信息解析不应被业务拦截器干扰。
   * 未提供时 forge.fetchLevel 回退到 request()。
   */
  requestRaw?: (config: RequestConfig) => Promise<ResponseData>;
  interceptors?: Fetcher['interceptors'];
  runsInterceptors?: boolean;
  /**
   * 便捷方法（可选）。
   * - builtin adapter 提供全部 5 个方法
   * - axios / 自定义 Fetcher 可不提供（调用方需先判断存在性）
   * @see .docs/SPEC.md §4.3.1
   */
  get?: (url: string, config?: Partial<RequestConfig>) => Promise<ResponseData>;
  post?: (url: string, config?: Partial<RequestConfig>) => Promise<ResponseData>;
  put?: (url: string, config?: Partial<RequestConfig>) => Promise<ResponseData>;
  patch?: (url: string, config?: Partial<RequestConfig>) => Promise<ResponseData>;
  delete?: (url: string, config?: Partial<RequestConfig>) => Promise<ResponseData>;
};

export interface ResolveAdapterOptions {
  adapter: 'auto' | 'axios' | 'builtin' | Fetcher;
  forgeInterceptors?: {
    request: InterceptorManager<RequestConfig, RequestConfig>;
    response: InterceptorManager<ResponseData, unknown>;
  };
}

/**
 * 解析 adapter 配置；同步阶段尝试 import('axios')，失败则降级。
 */
export async function resolveAdapter(opts: ResolveAdapterOptions): Promise<ResolvedAdapter> {
  const { adapter } = opts;

  if (adapter && typeof adapter === 'object') {
    return {
      request: (config: RequestConfig) => adapter.request(config),
      interceptors: adapter.interceptors,
    };
  }

  if (adapter === 'builtin') {
    return createBuiltinHttp(opts.forgeInterceptors);
  }

  if (adapter === 'axios') {
    const wrapped = await wrapAxiosAdapter();
    if (!wrapped) throw new AdapterNotFoundError('axios');
    return wrapped;
  }

  // auto: 优先尝试 axios，失败则 builtin
  const wrapped = await wrapAxiosAdapter().catch(() => null);
  if (wrapped) return wrapped;
  return createBuiltinHttp(opts.forgeInterceptors);
}
