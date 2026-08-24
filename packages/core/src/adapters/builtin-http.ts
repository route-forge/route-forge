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
 */

import type { InterceptorManager, RequestConfig, ResponseData } from '../types.js';
import {
  createInterceptorManager,
  runRequestInterceptors,
  runResponseInterceptors,
} from '../interceptors.js';
import { HTTPError, NetworkError } from '../errors.js';

/**
 * 判断 body 是否为宿主原生可直接传输的类型（跳过 JSON 序列化）。
 */
function isPassthroughBody(body: unknown): boolean {
  if (body === null) return false;
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof ArrayBuffer !== 'undefined' &&
      (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  );
}

/**
 * 判断错误是否为请求取消错误（AbortSignal 触发）
 */
function isAbortError(err: unknown): boolean {
  const e = err as { name?: string } | null;
  return !!e && e.name === 'AbortError';
}

/**
 * 合并多个 AbortSignal：任一 signal abort 即返回合并后的 signal abort。
 * 优先使用 AbortSignal.any（Node 20.3+ / 现代浏览器），否则回退到手动监听。
 */
function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const valid = signals.filter((s): s is AbortSignal => !!s);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  // AbortSignal.any 可用时直接使用（Node 20.3+ / 现代浏览器）
  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).any === 'function') {
    return (AbortSignal as any).any(valid);
  }
  // 回退：手动构造 AbortController，监听任一 signal abort
  const controller = new AbortController();
  for (const s of valid) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

export function createBuiltinHttp(forgeInterceptors?: {
  request: InterceptorManager<RequestConfig, RequestConfig>;
  response: InterceptorManager<ResponseData, unknown>;
}) {
  const requestMgr = forgeInterceptors?.request ?? createInterceptorManager<RequestConfig>();
  const responseMgr = forgeInterceptors?.response ?? createInterceptorManager<ResponseData>();

  async function request(config: RequestConfig): Promise<ResponseData> {
    // 1. 执行请求拦截器（LIFO，对齐 axios）
    const finalConfig = await runRequestInterceptors(requestMgr, config);

    // 2. 超时控制：timeout > 0 时用 AbortSignal.timeout
    //    若同时有用户 signal，合并两者（任一 abort 即取消请求）
    const signal = combineSignals(
      finalConfig.signal,
      finalConfig.timeout && finalConfig.timeout > 0
        ? AbortSignal.timeout(finalConfig.timeout)
        : undefined,
    );

    // 3. paramsSerializer：自定义 query 序列化
    let url = finalConfig.url;
    if (finalConfig.paramsSerializer && finalConfig.params) {
      const qs = finalConfig.paramsSerializer(finalConfig.params);
      if (qs) {
        url = url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
      }
    }

    // 4. 构建 fetchInit（body 序列化 + JSON Content-Type 自动补齐）
    const headers = new Headers(finalConfig.headers);
    const fetchInit: RequestInit = {
      method: finalConfig.method,
      headers,
    };
    if (signal) fetchInit.signal = signal;
    if (
      finalConfig.body !== undefined &&
      !['GET', 'HEAD'].includes(finalConfig.method.toUpperCase())
    ) {
      if (typeof finalConfig.body === 'string' || isPassthroughBody(finalConfig.body)) {
        fetchInit.body = finalConfig.body as BodyInit;
      } else {
        fetchInit.body = JSON.stringify(finalConfig.body);
        if (!headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }
      }
    }

    // 5. 调用 fetch（网络层错误转 NetworkError，便于独立使用 adapter 时错误语义一致）
    //    请求取消（AbortError）不包装，保留原始错误以便上层转换为 RequestAbortedError
    let res: Response;
    try {
      res = await fetch(url, fetchInit);
    } catch (e) {
      if (isAbortError(e)) throw e;
      throw new NetworkError(
        e instanceof Error ? e.message : String(e),
        finalConfig.route,
        finalConfig.level,
        e,
      );
    }
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

    // 6. 构建 ResponseData
    const responseData: ResponseData = {
      route: finalConfig.route,
      level: finalConfig.level,
      method: finalConfig.method,
      url,
      status: res.status,
      headers: res.headers,
      data,
      config: finalConfig,
    };

    // 7. 执行响应拦截器（FIFO，对齐 axios）；末段返回值即 request() 的 resolve 值
    // HTTP 非 2xx → 转 HTTPError 后进入响应拦截器 onRejected 链（SPEC §4.1.3a 步骤 9）
    const source: Promise<ResponseData> =
      res.status >= 200 && res.status < 300
        ? Promise.resolve(responseData)
        : Promise.reject(
          new HTTPError(
            `HTTP ${res.status} for route "${finalConfig.route}" (${finalConfig.method} ${url})`,
            {
              route: finalConfig.route,
              level: finalConfig.level,
              status: res.status,
              url,
              method: finalConfig.method,
            },
          ),
        );
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
