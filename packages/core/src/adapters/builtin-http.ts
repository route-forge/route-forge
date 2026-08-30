/**
 * 内置类 axios 精简实现（builtin adapter）
 * @see .docs/SPEC.md §4.3.1
 *
 * 设计目标：
 * - API 兼容 axios（use/eject/clear、request/get/post/...）便于业务代码零成本切换
 * - 拦截器执行顺序对齐 axios（请求 LIFO、响应 FIFO），与 SPEC §4.1.3a 一致
 * - 仅实现 Route Forge 调用链需要的能力：拦截器、JSON、超时、取消
 * - 零依赖，仅基于宿主原生 fetch（Node 18+ / 现代浏览器原生支持）
 * - 体积目标：min+gzip < 3KB，仅作为兜底，不追求覆盖 axios 全部 API
 *
 * 结构：纯 fetch 底座（超时/序列化/非 2xx 转换）提取在 fetch-core.ts，
 * 本文件只负责拦截器编排 + axios 兼容门面。
 */

import type { InterceptorManager, RequestConfig, ResponseData } from '../types.js';
import {
  createInterceptorManager,
  runRequestInterceptors,
  runResponseInterceptors,
} from '../interceptors.js';
import { rawFetch } from './fetch-core.js';

export function createBuiltinHttp(forgeInterceptors?: {
  request: InterceptorManager<RequestConfig, RequestConfig>;
  response: InterceptorManager<ResponseData, unknown>;
}) {
  const requestMgr = forgeInterceptors?.request ?? createInterceptorManager<RequestConfig>();
  const responseMgr = forgeInterceptors?.response ?? createInterceptorManager<ResponseData>();

  /**
   * 原始请求：不经过请求/响应拦截链。
   * 供元信息拉取使用（forge.ts 的 fetchLevel / 摘要端点）——元信息解析不能被
   * 业务拦截器（如解包 resp.data 的响应拦截器）干扰，与 axios 路径
   * 「元信息不走 forge 拦截链」的行为保持一致。
   */
  const requestRaw = rawFetch;

  async function request(config: RequestConfig): Promise<ResponseData> {
    // 1. 执行请求拦截器（LIFO，对齐 axios）
    const finalConfig = await runRequestInterceptors(requestMgr, config);

    // 2. 原始请求（超时/序列化/fetch/解析/非 2xx 转 HTTPError）
    const source: Promise<ResponseData> = Promise.resolve(finalConfig).then(requestRaw);

    // 3. 执行响应拦截器（FIFO，对齐 axios）；末段返回值即 request() 的 resolve 值
    // HTTP 非 2xx → HTTPError 进入响应拦截器 onRejected 链（SPEC §4.1.3a 步骤 9）
    return runResponseInterceptors(
      responseMgr,
      source,
    ) as Promise<ResponseData>;
  }

  // 便捷方法
  const get = (url: string, config?: Partial<RequestConfig>) =>
    request({ ...config, url, method: 'GET' } as RequestConfig);
  const post = (url: string, config?: Partial<RequestConfig>) =>
    request({ ...config, url, method: 'POST' } as RequestConfig);
  const put = (url: string, config?: Partial<RequestConfig>) =>
    request({ ...config, url, method: 'PUT' } as RequestConfig);
  const patch = (url: string, config?: Partial<RequestConfig>) =>
    request({ ...config, url, method: 'PATCH' } as RequestConfig);
  const del = (url: string, config?: Partial<RequestConfig>) =>
    request({ ...config, url, method: 'DELETE' } as RequestConfig);

  return {
    request,
    requestRaw,
    interceptors: {
      request: requestMgr,
      response: responseMgr,
    },
    runsInterceptors: true,
    get,
    post,
    put,
    patch,
    delete: del,
  };
}
