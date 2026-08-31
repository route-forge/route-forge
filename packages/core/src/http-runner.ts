/**
 * 业务请求执行层（SPEC §4.1.3 / §4.1.4 / §4.1.7）。
 *
 * 由工厂提供的依赖（adapter 解析、拦截器管理器、store 的 load/findRouteMeta、
 * 加载跟踪器、自动发现完成 Promise、默认 timeout、URL 前缀状态）组装出
 * api(level, name, params) —— 返回可 abort 的 ForgeRequest，内部串起：
 *   自动发现就绪 → 层级加载 → 命中路由 → 参数解析 → 请求/响应拦截链
 *   → adapter 调用 → HTTP/网络/取消错误转换 → 加载中标识。
 */

import { isAbortError } from './adapters/fetch-core.js';
import type { ResolvedAdapter } from './adapters/index.js';
import { runRequestInterceptors, runResponseInterceptors } from './interceptors.js';
import {
  appendQuery,
  buildRequestUrl,
  pickMethod,
  resolveApiParams,
} from './url-builder.js';
import { HTTPError, NetworkError, RequestAbortedError, UnknownRouteError, ForgeError } from './errors.js';
import type { LoadingTracker } from './loading.js';
import type { DiscoveryState } from './auto-discovery.js';
import type {
  ApiCallParams,
  ForgeRequest,
  InterceptorManager,
  RequestConfig,
  ResponseData,
  RouteMeta,
} from './types.js';

export interface HttpRunnerDeps {
  ensureAdapter: () => Promise<ResolvedAdapter>;
  requestInterceptors: InterceptorManager<RequestConfig, RequestConfig>;
  responseInterceptors: InterceptorManager<ResponseData, unknown>;
  load: (level: string | string[]) => Promise<void>;
  findRouteMeta: (level: string, name: string) => RouteMeta | undefined;
  baseURL: string;
  /** 实时读取自动发现回填的 URL 前缀（按引用，勿快照） */
  state: DiscoveryState;
  timeout: number;
  loadingTracker: LoadingTracker;
  autoDiscoveryPromise: Promise<void>;
}

/** 创建 api(level, name, params) 工厂函数。 */
export function createHttpRunner(deps: HttpRunnerDeps): (
  level: string,
  name: string,
  params?: ApiCallParams,
) => ForgeRequest {
  const {
    ensureAdapter,
    requestInterceptors,
    responseInterceptors,
    load,
    findRouteMeta,
    baseURL,
    state,
    timeout,
    loadingTracker,
    autoDiscoveryPromise,
  } = deps;

  async function doApiCall(
    meta: RouteMeta,
    params: ApiCallParams,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const {
      pathParams,
      query,
      body,
      headers,
      timeout: perCallTimeout,
    } = resolveApiParams(params);

    // 请求前检查：signal 已 abort 则直接抛错，不发请求
    if (signal?.aborted) {
      throw new RequestAbortedError(meta.name, meta.level, signal.reason);
    }

    const method = pickMethod(meta);
    const urlWithQuery = appendQuery(
      buildRequestUrl(meta, pathParams, { baseURL, urlPrefix: state.urlPrefix }),
      query,
    );
    const config: RequestConfig = {
      route: meta.name,
      level: meta.level ?? '',
      method,
      url: urlWithQuery,
      headers: { Accept: 'application/json', ...(headers ?? {}) },
      body,
      params: pathParams,
      timeout: perCallTimeout ?? timeout,
      signal,
      meta,
    };

    const adp = await ensureAdapter();

    // 5. 请求拦截链（LIFO，对齐 axios）；任段抛错且 onRejected 未消化 → 进入调用方 catch，不发请求
    // builtin.adapter 内部已执行 forge 拦截器（同一管理器对象引用，runsInterceptors=true）→ 跳过
    const finalConfig = adp.runsInterceptors
      ? config
      : await runRequestInterceptors(requestInterceptors, config);

    // 拦截链后再次检查：拦截器可能修改了 signal 或已 abort
    if (finalConfig.signal?.aborted) {
      throw new RequestAbortedError(meta.name, meta.level, finalConfig.signal.reason);
    }

    // 6. adapter 调用 → 7/8 的错误转换 + 响应拦截链
    // HTTP 非 2xx 转 HTTPError；底层网络错误（非 ForgeError）转 NetworkError
    // 注意：source 始终构造（含错误转换逻辑），runsInterceptors=true 时直接返回 source
    // 加载中标识：始终跟踪，用户不监听即可
    loadingTracker.start();
    try {
      const source: Promise<ResponseData> = adp.request(finalConfig).then(
        (resp) => {
          if (resp.status < 200 || resp.status >= 300) {
            throw new HTTPError(
              `HTTP ${resp.status} for route "${resp.route}" (${resp.method} ${resp.url})`,
              {
                route: resp.route,
                level: resp.level,
                status: resp.status,
                url: resp.url,
                method: resp.method,
              },
            );
          }
          return resp;
        },
        (err) => {
          // 已经是 ForgeError（如拦截器内重新抛的）→ 原样抛
          if (err instanceof ForgeError) throw err;
          // 请求被取消 → 转 RequestAbortedError
          if (isAbortError(err, signal)) {
            throw new RequestAbortedError(meta.name, meta.level, err);
          }
          throw new NetworkError(
            err instanceof Error ? err.message : String(err),
            meta.name,
            meta.level,
            err,
          );
        },
      );

      // 响应拦截链（FIFO，对齐 axios）；末段返回值即 api() resolve 值
      // builtin.adapter 内部已执行 forge 响应拦截器（runsInterceptors=true）→ 直接返回 source
      const result = adp.runsInterceptors
        ? await source
        : await runResponseInterceptors(responseInterceptors, source);
      return result;
    } finally {
      loadingTracker.stop();
    }
  }

  return function api(level: string, name: string, params: ApiCallParams = {}): ForgeRequest {
    // 内部创建 AbortController，用户通过返回值的 abort() 方法取消请求
    let ctrl: AbortController | undefined;
    let abortedBeforeInit = false;
    let abortReason: unknown;

    const work = (async (): Promise<unknown> => {
      ctrl = new AbortController();
      if (abortedBeforeInit) {
        ctrl.abort(abortReason);
      }
      await autoDiscoveryPromise;
      await load(level);
      const meta = findRouteMeta(level, name);
      if (!meta) {
        throw new UnknownRouteError(name, level);
      }
      return doApiCall(meta, params, ctrl.signal);
    })();

    const request = work as ForgeRequest;
    request.abort = (): void => {
      if (ctrl) {
        ctrl.abort();
      } else {
        abortedBeforeInit = true;
      }
    };
    return request;
  };
}
