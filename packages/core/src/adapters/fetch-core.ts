/**
 * 纯 fetch 底座（无状态工具层）
 * @see .docs/SPEC.md §4.3.1
 *
 * 职责：超时/取消合并、query/body 序列化、fetch 调用、JSON 解析、
 * ResponseData 组装、非 2xx 转 HTTPError。不持有任何状态。
 *
 * 消费方：
 * - builtin-http 的 requestRaw（拦截器编排层的底座）
 * - forge.ts 的元信息拉取（fetchLevel + 摘要端点，经 adapter requestRaw 通道）
 */

import type { RequestConfig, ResponseData } from '../types.js';
import { HTTPError, NetworkError } from '../errors.js';

/**
 * 判断错误是否为请求取消错误。
 * 兼容 fetch 的 DOMException AbortError 与 axios 的 CanceledError；
 * 传入 signal 且已 abort 时，无论错误类型均视为取消。
 */
export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  // signal 已 abort → 无论错误类型，均视为取消
  if (signal?.aborted) return true;
  const e = err as { name?: string; code?: string } | null;
  if (!e) return false;
  // fetch 取消抛 DOMException (name === 'AbortError')
  if (e.name === 'AbortError') return true;
  // axios 取消抛 CanceledError (code === 'ERR_CANCELED')
  if (e.code === 'ERR_CANCELED') return true;
  return false;
}

/**
 * 合并多个 AbortSignal：任一 signal abort 即返回合并后的 signal abort。
 * 优先使用 AbortSignal.any（Node 20.3+ / 现代浏览器），否则回退到手动监听。
 */
export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
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

/**
 * 判断 body 是否为宿主原生可直接传输的类型（跳过 JSON 序列化）。
 */
export function isPassthroughBody(body: unknown): boolean {
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
 * 原始请求：不经过任何拦截链。
 * 超时控制（timeout > 0 用 AbortSignal.timeout，与用户 signal 合并）、
 * paramsSerializer、body 序列化 + JSON Content-Type 自动补齐、
 * 网络层错误转 NetworkError、非 2xx 抛 HTTPError。
 * 请求取消（AbortError）不包装，保留原始错误以便上层转换为 RequestAbortedError。
 */
export async function rawFetch(config: RequestConfig): Promise<ResponseData> {
  // 超时控制：timeout > 0 时用 AbortSignal.timeout
  // 若同时有用户 signal，合并两者（任一 abort 即取消请求）
  const signal = combineSignals(
    config.signal,
    config.timeout && config.timeout > 0
      ? AbortSignal.timeout(config.timeout)
      : undefined,
  );

  // paramsSerializer：自定义 query 序列化
  let url = config.url;
  if (config.paramsSerializer && config.params) {
    const qs = config.paramsSerializer(config.params);
    if (qs) {
      url = url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
    }
  }

  // 构建 fetchInit（body 序列化 + JSON Content-Type 自动补齐）
  const headers = new Headers(config.headers);
  const fetchInit: RequestInit = {
    method: config.method,
    headers,
  };
  if (signal) fetchInit.signal = signal;
  if (
    config.body !== undefined &&
    !['GET', 'HEAD'].includes(config.method.toUpperCase())
  ) {
    if (typeof config.body === 'string' || isPassthroughBody(config.body)) {
      fetchInit.body = config.body as BodyInit;
    } else {
      fetchInit.body = JSON.stringify(config.body);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
  }

  // 调用 fetch（网络层错误转 NetworkError，便于独立使用 adapter 时错误语义一致）
  let res: Response;
  try {
    res = await fetch(url, fetchInit);
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new NetworkError(
      e instanceof Error ? e.message : String(e),
      config.route,
      config.level,
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

  // 构建 ResponseData
  const responseData: ResponseData = {
    route: config.route,
    level: config.level,
    method: config.method,
    url,
    status: res.status,
    headers: res.headers,
    data,
    config,
  };

  // HTTP 非 2xx → 抛 HTTPError（由调用方决定拦截/恢复）
  if (res.status >= 200 && res.status < 300) {
    return responseData;
  }
  throw new HTTPError(
    `HTTP ${res.status} for route "${config.route}" (${config.method} ${url})`,
    {
      route: config.route,
      level: config.level,
      status: res.status,
      url,
      method: config.method,
    },
  );
}
