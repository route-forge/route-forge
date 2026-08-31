/**
 * Route Forge 主入口：createRouteForge
 * @see .docs/SPEC.md §4.1.1 ~ §4.1.4
 *
 * 能力清单（v1.0 MVP）：
 *   - 按层级懒加载与隔离缓存（§4.1.2）
 *   - 并发去重（§4.1.4）
 *   - 通过路由名调用 API（§4.1.3）
 *   - 拦截器（§4.1.3a）
 *   - Adapter auto 检测 / builtin / axios / 自定义 Fetcher（§4.3）
 */

import { RouteCache } from './cache.js';
import {
  createInterceptorManager,
  InterceptorManagerImpl,
  runRequestInterceptors,
  runResponseInterceptors,
} from './interceptors.js';
import { resolveAdapter } from './adapters/index.js';
import { isAbortError } from './adapters/fetch-core.js';
import { resolveRouteName, resolveRouteNameSync } from './resolveRouteName.js';
import { defineImmutableProps } from './defineImmutableProps.js';
import type { LoadingChangeCallback } from './loading.js';
import { LoadingTracker } from './loading.js';
import {
  AdapterNotFoundError,
  ForgeError,
  HTTPError,
  NetworkError,
  RequestAbortedError,
  UnknownLevelError,
  UnknownRouteError,
} from './errors.js';
import {
  appendQuery,
  buildRequestUrl,
  buildUrl,
  pickMethod,
  resolveApiParams,
} from './url-builder.js';
import type {
  ApiCallParams,
  BoundForge,
  ForgeRequest,
  InterceptorManager,
  LevelRoutesResponse,
  RequestConfig,
  ResponseData,
  RouteForge,
  RouteForgeOptions,
  RouteMeta,
  SummaryResponse,
} from './types.js';

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CACHE_TTL = 3600;

/**
 * 后端摘要端点返回的未分配层级路由，前端作为虚拟层级 "unassigned" 消费
 * @see .docs/SPEC.md §3.1.6
 */
const UNASSIGNED_LEVEL = 'unassigned';

export function createRouteForge(options: RouteForgeOptions): RouteForge {
  if (!options.endpoint) throw new TypeError('options.endpoint is required');

  const {
    adapter = 'auto',
    timeout = DEFAULT_TIMEOUT,
    baseURL = '',
    interceptors: declarativeInterceptors,
    cache: cacheOpts = {},
  } = options;

  // --- 加载中标识跟踪器（始终跟踪，用户不监听即可）---
  const loadingTracker = new LoadingTracker();

  // --- 自动发现（SPEC §4.1.1 + §5.3）---
  const explicitLevels = options.levels;
  const explicitEager = options.eager;
  const explicitEndpoint = options.endpoint;

  // effective* 状态：在摘要端点响应到达后被填充
  let effectiveLevels: string[] = explicitLevels ?? [];
  let effectiveEager: string[] = explicitEager ?? [];
  let effectiveEndpoint = explicitEndpoint;
  let effectiveUrlPrefix = '';  // 后端下发的 URL 前缀，默认为空

  // 未分配层级路由：来自摘要端点的 unassigned 字段，前端作为虚拟层级 "unassigned" 消费
  // @see .docs/SPEC.md §3.1.6
  let summaryUnassigned: SummaryResponse['unassigned'] | undefined;
  // 后端是否将 unassigned 作为真实层级注册（在 levels 中）；若是则走正常 HTTP 拉取，不走虚拟层级
  let backendHasUnassignedLevel = false;

  // 拉取摘要端点（用于 endpoint / levels / eager 自动发现）
  // 走 adapter 原始通道（与层级元信息拉取一致）：获得 timeout、adapter 检测/降级、
  // 自定义 Fetcher 兼容；失败错误为 HTTPError/NetworkError（携带 status/url 详情）
  // URL = baseURL + 显式 endpoint（此时后端权威的 endpoint 尚未获取，用用户显式配置）
  // 注意：IIFE 延迟到 ensureAdapter/adapterResolved 声明之后才真正发起（见下方启动调用），
  // 避免构造期 TDZ（fetchMeta → ensureAdapter → adapterResolved）
  const fetchSummary = async (): Promise<SummaryResponse | null> => {
    try {
      const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
      const ep = explicitEndpoint.startsWith('/') ? explicitEndpoint : `/${explicitEndpoint}`;
      const data = await fetchMeta('__forge__.summary', `${base}${ep}`);
      return data as SummaryResponse;
    } catch (e) {
      if (explicitLevels && explicitLevels.length > 0) {
        console.warn(
          `[route-forge] summary endpoint unreachable: ${(e as Error).message}; using explicit levels`,
        );
        return null;
      }
      // 未传 levels 且摘要端点不可达（网络错误 / HTTP 非 2xx / 超时）→ 无可用降级，抛错（ready() 将 reject）
      throw new UnknownLevelError('(auto-discovery)');
    }
  };

  // 自动发现异步填充（不阻塞 createRouteForge 返回）
  // 摘要拉取经 adapter 通道（fetchMeta → ensureAdapter 依赖 adapterResolved 等声明），
  // 延迟到同步声明区之后启动；autoDiscoveryPromise 通过挂起队列消费，
  // 无论谁先就绪都能正确串联（避免微任务注册顺序竞态）
  let summaryPromise: Promise<SummaryResponse | null> | undefined;
  const summaryWaiters: Array<(p: Promise<SummaryResponse | null>) => void> = [];
  const whenSummary = (): Promise<SummaryResponse | null> =>
    summaryPromise ?? new Promise((resolve) => summaryWaiters.push(resolve));
  const autoDiscoveryPromise = whenSummary().then((summary) => {
    if (summary === null) {
      return;
    }

    // 0. schemaVersion 向前兼容（DESIGN.md §6.3）
    const schemaVersion = summary.schemaVersion ?? 1;
    if (schemaVersion > 1) {
      console.warn(
        `[route-forge] backend schemaVersion=${schemaVersion} > client supported 1; some features may be unavailable`,
      );
    }

    // 1. endpoint 后端权威
    if (summary.config.endpoint_prefix && summary.config.endpoint_prefix !== explicitEndpoint) {
      console.warn(
        `[route-forge] backend endpoint_prefix "${summary.config.endpoint_prefix}" overrides frontend endpoint "${explicitEndpoint}"`,
      );
      effectiveEndpoint = summary.config.endpoint_prefix;
    }

    // 1a. url_prefix 后端权威：后端下发时覆盖
    if (summary.config.url_prefix) {
      effectiveUrlPrefix = summary.config.url_prefix.endsWith('/')
        ? summary.config.url_prefix.slice(0, -1)
        : summary.config.url_prefix;
    }

    // 2. levels 取交集或自动发现
    const backendLevels = Object.keys(summary.levels);

    // 3a. 捕获摘要端点的 unassigned 字段，作为虚拟层级 "unassigned" 消费（SPEC §3.1.6）
    // 仅当后端未将 unassigned 作为真实层级注册时才启用虚拟层级
    backendHasUnassignedLevel = backendLevels.includes(UNASSIGNED_LEVEL);
    if (Array.isArray(summary.unassigned) && summary.unassigned.length > 0 && !backendHasUnassignedLevel) {
      summaryUnassigned = summary.unassigned;
    }

    // 可用层级 = 后端真实层级 + 虚拟 unassigned 层级（若有未分配路由）
    const availableLevels = backendLevels.slice();
    if (summaryUnassigned && !backendHasUnassignedLevel) {
      availableLevels.push(UNASSIGNED_LEVEL);
    }

    if (explicitLevels && explicitLevels.length > 0) {
      const intersection = explicitLevels.filter((l) => availableLevels.includes(l));
      const removed = explicitLevels.filter((l) => !availableLevels.includes(l));
      if (removed.length > 0) {
        console.warn(
          `[route-forge] levels not in backend summary and dropped: ${removed.join(', ')}`,
        );
      }
      effectiveLevels = intersection;
    } else {
      effectiveLevels = availableLevels;
    }

    // 4. eager：未传时取后端 load:'eager' 层级；显式传入时取并集（SPEC §5.3）
    const backendEager = backendLevels.filter((lvl) => summary.levels[lvl]?.load === 'eager');
    if (!explicitEager) {
      effectiveEager = backendEager;
    } else {
      // 并集：后端 eager + 前端显式声明，去重
      const union = new Set([...backendEager, ...explicitEager]);
      effectiveEager = [...union];
    }
  });

  // 防止 autoDiscoveryPromise 未被 await 时产生 unhandled rejection
  // 存储错误以便在 load/api 调用时重新抛出，保留原始错误信息
  let autoDiscoveryError: unknown = null;
  autoDiscoveryPromise.catch((e) => {
    autoDiscoveryError = e;
  });

  // --- Auto-discovery 完成状态 + ready Promise ---
  let autoDiscoveryCompleted = false;
  let resolveReady!: (value: RouteForge) => void;
  let rejectReady!: (reason?: unknown) => void;
  const readyPromise = new Promise<RouteForge>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // 无人调用 ready() 时防 unhandled rejection；不改变 reject 语义，订阅者仍能收到错误
  readyPromise.catch(() => {});

  const cacheTtl = cacheOpts.ttl ?? DEFAULT_CACHE_TTL;
  const cacheStorage = cacheOpts.storage ?? 'memory';
  const cache = new RouteCache({ storage: cacheStorage, ttl: cacheTtl });

  const requestInterceptors: InterceptorManager<RequestConfig, RequestConfig> = new InterceptorManagerImpl();
  const responseInterceptors: InterceptorManager<ResponseData, unknown> = new InterceptorManagerImpl();

  // 声明式拦截器先注册（按数组顺序），随后允许运行时 use() 追加
  // 支持两种形式：单函数（视为 onFulfilled）或 [onFulfilled?, onRejected?] 元组（SPEC §4.1.1）
  if (declarativeInterceptors?.request) {
    for (const entry of declarativeInterceptors.request) {
      if (typeof entry === 'function') {
        requestInterceptors.use(entry);
      } else {
        const [onFulfilled, onRejected] = entry;
        requestInterceptors.use(onFulfilled, onRejected);
      }
    }
  }
  if (declarativeInterceptors?.response) {
    for (const entry of declarativeInterceptors.response) {
      if (typeof entry === 'function') {
        responseInterceptors.use(entry);
      } else {
        const [onFulfilled, onRejected] = entry;
        responseInterceptors.use(onFulfilled, onRejected);
      }
    }
  }

  const adapterPromise = resolveAdapter({
    adapter,
    forgeInterceptors: { request: requestInterceptors, response: responseInterceptors },
  });
  // 启动摘要拉取（微任务延迟，确保 adapterResolved 等声明已完成；fetchMeta → ensureAdapter 依赖它们）
  Promise.resolve().then(() => {
    summaryPromise = fetchSummary();
    for (const resolve of summaryWaiters) resolve(summaryPromise);
  });
  let adapterResolved = false;
  let adapterObj: Awaited<ReturnType<typeof resolveAdapter>> | null = null;

  async function ensureAdapter() {
    if (!adapterResolved) {
      adapterObj = await adapterPromise.catch((e) => {
        if (e instanceof AdapterNotFoundError) throw e;
        // 其他错误降级到 builtin（避免初始化失败）；
        // 传入 forge 拦截器管理器，确保降级后拦截链语义不变
        return resolveAdapter({
          adapter: 'builtin',
          forgeInterceptors: { request: requestInterceptors, response: responseInterceptors },
        });
      });
      adapterResolved = true;
    }
    return adapterObj!;
  }

  const inflight = new Map<string, Promise<void>>();
  // 每个层级的失效代数，用于检测 loadOne 期间是否发生了 invalidate
  const invalidationGens = new Map<string, number>();

  function assertLevelDeclared(level: string): void {
    if (!effectiveLevels.includes(level)) {
      throw new UnknownLevelError(level);
    }
  }

  function assertDiscoveryReady(): void {
    if (!autoDiscoveryCompleted && !explicitLevels?.length) {
      throw new ForgeError(
        'Route data not available. Auto-discovery has not completed. ' +
        'Use forge.ready() or forge.use(level) first.',
        { code: 'RF_FE_010' },
      );
    }
  }

  /**
   * 元信息拉取统一通道：摘要端点与层级路由表共用。
   * 走 adapter 原始通道（不走 forge.interceptors 链，避免与业务调用混淆）：
   * builtin 提供 requestRaw（跳过拦截链）；axios/自定义 Fetcher 未提供时回退 request()。
   * 获得 timeout、adapter 检测/降级、自定义 Fetcher 兼容。
   * @param routeTag 请求标识（`__forge__.summary` / `__forge__.load.${level}`），用于错误信息与追踪
   * @param url 完整请求 URL
   * @param level 所属层级（摘要请求无层级，传 undefined）
   */
  async function fetchMeta(routeTag: string, url: string, level = ''): Promise<unknown> {
    const adp = await ensureAdapter();
    const config: RequestConfig = {
      route: routeTag,
      level,
      method: 'GET',
      url,
      headers: { Accept: 'application/json' },
      params: {},
      timeout,
      meta: {
        name: routeTag,
        uri: url,
        methods: ['GET'],
        parameters: [],
        level,
      },
    };
    const doRawRequest = adp.requestRaw ?? adp.request;
    const resp = await doRawRequest(config);
    if (!resp || resp.status < 200 || resp.status >= 300) {
      throw new HTTPError(
        `Failed to fetch "${routeTag}": HTTP ${resp?.status}`,
        { level, status: resp?.status, url, method: 'GET' },
      );
    }
    return resp.data;
  }

  async function fetchLevel(level: string): Promise<LevelRoutesResponse> {
    // 后端可能下发 cache 字段，让 RouteCache 优先采用
    return (await fetchMeta(
      `__forge__.load.${level}`,
      buildUrl(level, { baseURL, endpoint: effectiveEndpoint }),
      level,
    )) as LevelRoutesResponse;
  }

  async function loadOne(level: string): Promise<void> {
    if (autoDiscoveryError) throw autoDiscoveryError;
    assertLevelDeclared(level);

    // 缓存命中直接返回
    if (cache.get(level)) return;

    // inflight 去重
    const existing = inflight.get(level);
    if (existing) return existing;

    const gen = invalidationGens.get(level) ?? 0;
    const p = (async () => {
      try {
        // 虚拟层级 unassigned：直接从摘要数据构建响应，不发 HTTP 请求（SPEC §3.1.6）
        if (level === UNASSIGNED_LEVEL && !backendHasUnassignedLevel && summaryUnassigned) {
          const routes: Record<string, RouteMeta> = {};
          for (const r of summaryUnassigned) {
            routes[r.name] = { ...r, level: UNASSIGNED_LEVEL };
          }
          cache.set({ level: UNASSIGNED_LEVEL, routes, cache: null });
          return;
        }
        const resp = await fetchLevel(level);
        // 仅在缓存未被 invalidate 清除时写入，防止旧数据回写
        if ((invalidationGens.get(level) ?? 0) === gen) {
          cache.set(resp);
        }
      } finally {
        inflight.delete(level);
      }
    })();
    inflight.set(level, p);
    return p;
  }

  async function load(level: string | string[]): Promise<void> {
    await autoDiscoveryPromise;
    const list = Array.isArray(level) ? level : [level];
    await Promise.all(list.map(loadOne));
  }

  function route(level: string, name: string, params?: Record<string, unknown>): string {
    assertDiscoveryReady();
    // 静态生成 URL：仅查已加载缓存，未加载时抛 UnknownRouteError
    const meta = findRouteMeta(level, name);
    if (!meta) {
      throw new UnknownRouteError(name, level);
    }
    return buildRequestUrl(meta, params ?? {}, { baseURL, urlPrefix: effectiveUrlPrefix });
  }

  function findRouteMeta(level: string, name: string): RouteMeta | undefined {
    const entry = cache.get(level);
    const meta = entry?.routes[name];
    if (meta) {
      return { ...meta, level };
    }
    return undefined;
  }

  function api(level: string, name: string, params: ApiCallParams = {}): ForgeRequest {
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
  }

  async function doApiCall(meta: RouteMeta, params: ApiCallParams, signal?: AbortSignal): Promise<unknown> {
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
      buildRequestUrl(meta, pathParams, { baseURL, urlPrefix: effectiveUrlPrefix }),
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

  function invalidate(level?: string | string[]): void {
    if (level === undefined) {
      cache.clear();
      // 清除所有进行中的加载，防止旧数据回写
      inflight.clear();
      for (const lvl of effectiveLevels) {
        invalidationGens.set(lvl, (invalidationGens.get(lvl) ?? 0) + 1);
      }
    } else if (Array.isArray(level)) {
      for (const lvl of level) {
        cache.del(lvl);
        inflight.delete(lvl);
        invalidationGens.set(lvl, (invalidationGens.get(lvl) ?? 0) + 1);
      }
    } else {
      cache.del(level);
      inflight.delete(level);
      invalidationGens.set(level, (invalidationGens.get(level) ?? 0) + 1);
    }
  }

  function isLoaded(level?: string): boolean {
    if (level) return cache.get(level) !== undefined;
    // 无任何已声明层级（如自动发现未完成）时不应谎报全部已加载
    return effectiveLevels.length > 0 && effectiveLevels.every((lvl) => cache.get(lvl) !== undefined);
  }

  function hasRoute(level: string, name: string): boolean {
    assertDiscoveryReady();
    return findRouteMeta(level, name) !== undefined;
  }

  function getRoutes(level: string): Record<string, RouteMeta>;
  function getRoutes(): Record<string, Record<string, RouteMeta>>;
  function getRoutes(level?: string): Record<string, RouteMeta> | Record<string, Record<string, RouteMeta>> {
    if (level !== undefined) {
      const entry = cache.get(level);
      const routes = entry?.routes ?? {};
      const result: Record<string, RouteMeta> = {};
      for (const [k, v] of Object.entries(routes)) {
        // 深拷贝：避免嵌套对象（如 parameter_defaults）与内部缓存共享引用
        result[k] = JSON.parse(JSON.stringify(v));
      }
      return result;
    }
    const result: Record<string, Record<string, RouteMeta>> = {};
    for (const lvl of effectiveLevels) {
      const entry = cache.get(lvl);
      if (entry) {
        const levelRoutes: Record<string, RouteMeta> = {};
        for (const [k, v] of Object.entries(entry.routes)) {
          // 深拷贝：避免嵌套对象（如 parameter_defaults）与内部缓存共享引用
          levelRoutes[k] = JSON.parse(JSON.stringify(v));
        }
        result[lvl] = levelRoutes;
      }
    }
    return result;
  }

  // eager 层级自动加载 + ready Promise settle
  // 不阻塞 createRouteForge 返回；在自动发现完成后触发
  void autoDiscoveryPromise
    .then(() => {
      // 摘要处理完成 → auto-discovery 已完成（eager load 之前设置，确保 level 加载后 route() 可用）
      autoDiscoveryCompleted = true;
      // eager load：单个层级失败不阻塞 ready（SPEC §4.1.9）。
      // 失败以完整异常（含堆栈）抛出到控制台，且不缓存失败态——
      // 后续 load()/api() 直接调用时会重试该层级，再失败时向调用方抛出
      if (effectiveEager.length > 0) {
        return Promise.allSettled(effectiveEager.map((lvl) => load(lvl))).then((results) => {
          results.forEach((r, i) => {
            if (r.status === 'rejected') {
              console.error(
                `[route-forge] eager load failed for level "${effectiveEager[i]}":`,
                r.reason,
              );
            }
          });
        });
      }
    })
    .then(() => {
      resolveReady(forgeInstance);
    })
    .catch((e) => {
      // 自动发现失败（无可用降级）→ ready() reject 携带原始错误，不再永久挂起
      rejectReady(e);
    });

  // --- ready() 方法：始终返回 Promise<this> ---
  function ready(): Promise<RouteForge>;
  function ready(onFulfilled: (forge: RouteForge) => void, onRejected?: (error: unknown) => void): Promise<RouteForge>;
  function ready(
    onFulfilled?: (forge: RouteForge) => void,
    onRejected?: (error: unknown) => void,
  ): Promise<RouteForge> {
    if (onFulfilled) {
      const p = readyPromise.then(onFulfilled, onRejected);
      // 回调模式下也返回 Promise，resolve 值为 forge 自身
      return p.then(() => forgeInstance);
    }
    return readyPromise;
  }

  // RouteResolver 接口实现（供 resolveRouteName/resolveRouteNameSync 使用）
  const forgeResolver = { load, hasRoute };

  // --- createBoundForge：构造绑定 level 的 BoundForge ---
  function createBoundForge(level: string, prefix?: string): BoundForge {
    // 自动触发 level 加载；失败时 levelLoaded 保持 reject 语义
    //（onLevelLoaded 的 onRejected 依赖它；框架层各自在 catch 中保持未加载状态）
    const levelLoadedPromise = load(level);
    // 附加空 catch 防止无人订阅时的 unhandled rejection（不改变原 Promise 的 reject 状态）
    levelLoadedPromise.catch(() => {});

    const apiFn = prefix
      ? (name: string, params?: ApiCallParams) =>
        resolveRouteName(forgeResolver, level, prefix, name).then(
          (resolved) => api(level, resolved, params),
        )
      : (name: string, params?: ApiCallParams) =>
        api(level, name, params);

    const callable = apiFn as unknown as BoundForge;
    defineImmutableProps(callable, {
      level,
      ...(prefix !== undefined ? { prefix } : {}),
      api: apiFn,
      route: prefix
        ? (name: string, params?: Record<string, unknown>) =>
          route(level, resolveRouteNameSync(forgeResolver, level, prefix, name), params)
        : (name: string, params?: Record<string, unknown>) =>
          route(level, name, params),
      url: prefix
        ? (name: string, params?: Record<string, unknown>) =>
          route(level, resolveRouteNameSync(forgeResolver, level, prefix, name), params)
        : (name: string, params?: Record<string, unknown>) =>
          route(level, name, params),
      hasRoute: (name: string) => hasRoute(level, name),
      getRoutes: () => getRoutes(level),
      load: () => load(level),
      invalidate: () => invalidate(level),
      isLoaded: () => isLoaded(level),
      isLoading: () => loadingTracker.isLoading(),
      onLoadingChange: (cb: LoadingChangeCallback) => loadingTracker.subscribe(cb),
    });
    // levelLoaded 单独挂载为 configurable: true，允许框架适配层（Vue/React）覆盖
    Object.defineProperty(callable, 'levelLoaded', {
      value: levelLoadedPromise,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    return callable;
  }

  // BoundForge.onLevelLoaded() 实现
  function boundOnLevelLoaded(
    bound: BoundForge,
    levelLoadedPromise: Promise<void>,
    onFulfilled?: (bound: BoundForge) => void,
    onRejected?: (error: unknown) => void,
  ): Promise<BoundForge> {
    const p = levelLoadedPromise.then(() => bound);
    if (onFulfilled) {
      return p.then(onFulfilled, onRejected).then(() => bound);
    }
    return p;
  }

  // 为 BoundForge 挂载 onLevelLoaded 和 useRoutePrefix
  // （这两个方法需要闭包引用，不能通过 defineImmutableProps 冻结对象值）
  function attachBoundMethods(bound: BoundForge, levelLoadedPromise: Promise<void>, level: string): void {
    Object.defineProperty(bound, 'onLevelLoaded', {
      value: (
        onFulfilled?: (bound: BoundForge) => void,
        onRejected?: (error: unknown) => void,
      ) => boundOnLevelLoaded(bound, levelLoadedPromise, onFulfilled, onRejected),
      writable: false,
      enumerable: false,
      configurable: false,
    });
    Object.defineProperty(bound, 'useRoutePrefix', {
      value: (prefix: string) => createBoundForgeWithMethods(level, prefix),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  function createBoundForgeWithMethods(level: string, prefix?: string): BoundForge {
    const bound = createBoundForge(level, prefix);
    const levelLoadedPromise = bound.levelLoaded as Promise<void>;
    attachBoundMethods(bound, levelLoadedPromise, level);
    return bound;
  }

  const forgeInstance = {
    api,
    load,
    route,
    url: route,
    invalidate,
    isLoaded,
    hasRoute,
    getRoutes,
    isLoading: () => loadingTracker.isLoading(),
    onLoadingChange: (cb: LoadingChangeCallback) => loadingTracker.subscribe(cb),
    interceptors: {
      request: requestInterceptors,
      response: responseInterceptors,
    },
    ready,
    use(level?: string, prefix?: string) {
      if (level === undefined) return forgeInstance as RouteForge;
      return createBoundForgeWithMethods(level, prefix);
    },
  } as RouteForge;

  return forgeInstance;
}

// 显式重导出，便于业务代码按需导入工具件
export { createInterceptorManager } from './interceptors.js';
export { RouteCache } from './cache.js';
export { ForgeError } from './errors.js';
