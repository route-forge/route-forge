/**
 * 内置类 axios 精简实现（builtin adapter）
 * @see .docs/SPEC.md §4.3.1
 *
 * 设计目标：
 * - API 兼容 axios（use/eject/clear、request/get/post/...）便于业务代码零成本切换
 * - 仅实现 Route Forge 调用链需要的能力：拦截器、JSON、超时、取消
 * - 零依赖，仅基于宿主原生 fetch（Node 18+ / 现代浏览器原生支持）
 * - 体积目标：min+gzip < 3KB
 *
 * 本文件为框架占位实现，核心 fetch + 拦截器串联逻辑后续阶段填充。
 */

import type { RequestConfig, ResponseData } from '../types.js';
import { createInterceptorManager } from '../interceptors.js';
import type { ResolvedAdapter } from './index.js';

export function createBuiltinHttp(): ResolvedAdapter {
  const requestInterceptorMgr = createInterceptorManager<RequestConfig>();
  const responseInterceptorMgr = createInterceptorManager<ResponseData>();

  async function request(config: RequestConfig): Promise<ResponseData> {
    // TODO: 接入 runRequestInterceptors / runResponseInterceptors 串联
    const controller = new AbortController();
    const fetchInit: RequestInit = {
      method: config.method,
      headers: new Headers(config.headers),
      signal: controller.signal,
    };
    if (config.body !== undefined && !['GET', 'HEAD'].includes(config.method.toUpperCase())) {
      fetchInit.body = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
    }
    const res = await fetch(config.url, fetchInit);
    const text = await res.text();
    let data: unknown = text;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch {
        /* 保留原始文本 */
      }
    }
    return {
      route: config.route,
      level: config.level,
      method: config.method,
      url: config.url,
      status: res.status,
      headers: res.headers,
      data,
      config,
    };
  }

  return {
    request,
    interceptors: {
      request: requestInterceptorMgr,
      response: responseInterceptorMgr,
    },
  };
}
