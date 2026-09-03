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
import { InterceptorManagerImpl } from './interceptors.js';
import { resolveAdapter } from './adapters/index.js';
import type { LoadingChangeCallback } from './loading.js';
import { LoadingTracker } from './loading.js';
import {
  AdapterNotFoundError,
  ForgeError,
  HTTPError,
  UnknownRouteError,
} from './errors.js';
import { buildRequestUrl } from './url-builder.js';
import {
  applySummaryToState,
  fetchSummary,
  type DiscoveryInputs,
  type DiscoveryState,
} from './auto-discovery.js';
import { readEmbeddedSummary } from './embedded-summary.js';
import { RouteStore } from './route-store.js';
import { createHttpRunner } from './http-runner.js';
import { createBoundForgeFactory } from './bound-forge.js';
import type {
  InterceptorManager,
  RequestConfig,
  ResponseData,
  RouteForge,
  RouteForgeOptions,
  RouteMeta,
} from './types.js';

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CACHE_TTL = 3600;

export function createRouteForge(options: RouteForgeOptions = {}): RouteForge {
  // 摘要数据源级联（SPEC §4.1.1）：页面内嵌 > 配置 summary 字段 > 网络拉取 endpoint。
  const bootstrapSummary = readEmbeddedSummary() ?? options.summary ?? null;
  if (!bootstrapSummary && !options.endpoint) {
    throw new TypeError(
      'createRouteForge: 需要 options.endpoint，或 options.summary，或页面内嵌 window.__ROUTE_FORGE__',
    );
  }

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

  // 自动发现有效状态：初始取用户显式配置（endpoint 缺省时用内嵌/配置摘要的 endpoint_prefix 兜底），
  // 摘要折算（网络响应到达 / 内嵌/配置即时）后由 applySummaryToState 就地回填
  const discoveryState: DiscoveryState = {
    levels: explicitLevels ?? [],
    eager: explicitEager ?? [],
    endpoint: explicitEndpoint ?? bootstrapSummary?.config?.endpoint_prefix ?? '',
    urlPrefix: '',
    cacheTtl: undefined,
    levelRoutes: {},
  };
  const discoveryInputs: DiscoveryInputs = { explicitLevels, explicitEager, explicitEndpoint };

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
   * @param routeTag 请求标识（摘要 `__forge__.summary` / 层级 `route-forge.${level}`），用于错误信息与追踪
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

  // 自动发现：摘要拉取经 adapter 通道（fetchSummary → fetchMeta → ensureAdapter 均已在上方就绪），
  // 就地折算进 discoveryState。fetchSummary 为 async，首个 await 即让出，不阻塞 createRouteForge 返回。
  // 摘要级联：内嵌/配置命中 → 同步折算、跳过网络；否则走网络 fetchSummary（就地折算）。
  let autoDiscoveryPromise: Promise<void>;
  if (bootstrapSummary) {
    applySummaryToState(bootstrapSummary, discoveryState, discoveryInputs);
    // 内嵌/配置摘要即时可用：构造返回后 route()/hasRoute() 立即可用（首屏免闪烁、SSR 直出友好）
    autoDiscoveryCompleted = true;
    autoDiscoveryPromise = Promise.resolve();
  } else {
    autoDiscoveryPromise = fetchSummary(discoveryInputs, baseURL, fetchMeta).then((summary) => {
      // summary === null：显式 levels 降级路径，effective* 保持初值，无需折算
      if (summary === null) {
        return;
      }
      applySummaryToState(summary, discoveryState, discoveryInputs);
    });
  }
  // 防止 autoDiscoveryPromise 未被 await 时产生 unhandled rejection；
  // 存储错误以便在 load/api 调用时重新抛出，保留原始错误信息
  let autoDiscoveryError: unknown = null;
  autoDiscoveryPromise.catch((e) => {
    autoDiscoveryError = e;
  });

  // --- 层级路由存储与加载（RouteStore 封装 cache/inflight/失效代数 + 按 route.uri 层级懒加载）---
  const store = new RouteStore({
    cache,
    state: discoveryState,
    baseURL,
    fetchMeta,
    autoDiscoveryPromise,
    getAutoDiscoveryError: () => autoDiscoveryError,
  });
  const load = (level: string | string[]): Promise<void> => store.load(level);
  const findRouteMeta = (level: string, name: string): RouteMeta | undefined =>
    store.findRouteMeta(level, name);
  const invalidate = (level?: string | string[]): void => store.invalidate(level);
  const isLoaded = (level?: string): boolean => store.isLoaded(level);
  function getRoutes(level: string): Record<string, RouteMeta>;
  function getRoutes(): Record<string, Record<string, RouteMeta>>;
  function getRoutes(
    level?: string,
  ): Record<string, RouteMeta> | Record<string, Record<string, RouteMeta>> {
    return level === undefined ? store.getRoutes() : store.getRoutes(level);
  }

  function route(level: string, name: string, params?: Record<string, unknown>): string {
    assertDiscoveryReady();
    // 静态生成 URL：仅查已加载缓存，未加载时抛 UnknownRouteError
    const meta = findRouteMeta(level, name);
    if (!meta) {
      throw new UnknownRouteError(name, level);
    }
    return buildRequestUrl(meta, params ?? {}, { baseURL, urlPrefix: discoveryState.urlPrefix });
  }

  // --- 业务请求执行（http-runner 封装：参数解析 / 拦截链 / 错误转换 / 加载跟踪 / 可 abort）---
  const api = createHttpRunner({
    ensureAdapter,
    requestInterceptors,
    responseInterceptors,
    load,
    findRouteMeta,
    baseURL,
    state: discoveryState,
    timeout,
    loadingTracker,
    autoDiscoveryPromise,
  });

  function hasRoute(level: string, name: string): boolean {
    assertDiscoveryReady();
    return findRouteMeta(level, name) !== undefined;
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
      if (discoveryState.eager.length > 0) {
        return Promise.allSettled(discoveryState.eager.map((lvl) => load(lvl))).then((results) => {
          results.forEach((r, i) => {
            if (r.status === 'rejected') {
              console.error(
                `[route-forge] eager load failed for level "${discoveryState.eager[i]}":`,
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

  // --- 绑定层级 BoundForge 构造（bound-forge 封装 api/route/url/onLevelLoaded/useRoutePrefix）---
  const createBoundForgeWithMethods = createBoundForgeFactory({
    load,
    api,
    route,
    hasRoute,
    getRoutes,
    invalidate,
    isLoaded,
    loadingTracker,
  });

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
