/**
 * Route Forge 主入口：createRouteForge
 * @see .docs/SPEC.md §4.1.1 ~ §4.1.6
 *
 * 能力清单（v1.0 MVP）：
 *   - 按层级懒加载与隔离缓存（§4.1.2）
 *   - 并发去重（§4.1.4）
 *   - 登录态感知（§4.1.5）
 *   - 严格模式（§4.1.6）
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
import type { LoadingChangeCallback } from './loading.js';
import { LoadingTracker } from './loading.js';
import {
  AdapterNotFoundError,
  ForgeError,
  HTTPError,
  InsufficientAuthError,
  MissingRouteParamError,
  NetworkError,
  UnknownLevelError,
  UnknownRouteError,
} from './errors.js';
import type {
  ApiCallParams,
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

export function createRouteForge(options: RouteForgeOptions): RouteForge {
  if (!options.endpoint) throw new TypeError('options.endpoint is required');

  const {
    adapter = 'auto',
    timeout = DEFAULT_TIMEOUT,
    baseURL = '',
    auth,
    interceptors: declarativeInterceptors,
    cache: cacheOpts = {},
  } = options;

  // --- 加载中标识跟踪器（始终跟踪，用户不监听即可）---
  const loadingTracker = new LoadingTracker();

  // --- 自动发现（SPEC §4.1.1 + §5.3）---
  const explicitLevels = options.levels;
  const explicitEager = options.eager;
  const explicitStrict = options.strict ?? false;
  const explicitEndpoint = options.endpoint;

  // effective* 状态：在摘要端点响应到达后被填充
  let effectiveLevels: string[] = explicitLevels ?? [];
  let effectiveEager: string[] = explicitEager ?? [];
  let effectiveStrict = explicitStrict;
  let effectiveEndpoint = explicitEndpoint;
  let effectiveUrlPrefix = '';  // 后端下发的 URL 前缀，默认为空

  // 拉取摘要端点（用于 strict_mode / endpoint / levels / eager 自动发现）
  const summaryPromise = (async (): Promise<SummaryResponse | null> => {
    try {
      const summaryUrl = explicitEndpoint; // GET {endpoint} = 摘要端点
      const resp = await fetch(summaryUrl, { method: 'GET' });
      if (!resp.ok) {
        console.warn(
          `[route-forge] summary endpoint ${summaryUrl} unreachable (HTTP ${resp.status}); falling back to explicit options`,
        );
        return null;
      }
      return (await resp.json()) as SummaryResponse;
    } catch (e) {
      if (explicitLevels && explicitLevels.length > 0) {
        console.warn(
          `[route-forge] summary endpoint unreachable: ${(e as Error).message}; using explicit levels`,
        );
        return null;
      }
      // 未传 levels 且摘要端点不可达 → 抛 UnknownLevelError
      throw new UnknownLevelError('(auto-discovery)');
    }
  })();

  // 自动发现异步填充（不阻塞 createRouteForge 返回）
  const autoDiscoveryPromise = summaryPromise.then((summary) => {
    if (summary === null) {
      return;
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

    // 2. strict_mode 后端权威：不能放宽，可收紧
    if (summary.config.strict_mode && !explicitStrict) {
      console.warn(
        '[route-forge] backend strict_mode=true overrides frontend strict=false; forcing strict=true',
      );
      effectiveStrict = true;
    }

    // 3. levels 取交集或自动发现
    const backendLevels = Object.keys(summary.levels);
    if (explicitLevels && explicitLevels.length > 0) {
      const intersection = explicitLevels.filter((l) => backendLevels.includes(l));
      const removed = explicitLevels.filter((l) => !backendLevels.includes(l));
      if (removed.length > 0) {
        console.warn(
          `[route-forge] levels not in backend summary and dropped: ${removed.join(', ')}`,
        );
      }
      effectiveLevels = intersection;
    } else {
      effectiveLevels = backendLevels;
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
  autoDiscoveryPromise.catch(() => {
    /* 自动发现失败：在 load/api await 时会重新抛出 */
  });

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
        // 其他错误降级到 builtin（避免初始化失败）
        return resolveAdapter({ adapter: 'builtin' });
      });
      adapterResolved = true;
    }
    return adapterObj!;
  }

  const inflight = new Map<string, Promise<void>>();

  function isAuthRequired(level: string): boolean {
    return Boolean(auth?.levels?.[level]);
  }

  function assertAuth(level: string): void {
    if (isAuthRequired(level) && auth?.state && !auth.state()) {
      throw new InsufficientAuthError(level);
    }
  }

  function assertLevelDeclared(level: string): void {
    if (!effectiveLevels.includes(level)) {
      throw new UnknownLevelError(level);
    }
  }

  function buildUrl(level: string): string {
    const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const ep = effectiveEndpoint.startsWith('/') ? effectiveEndpoint : `/${effectiveEndpoint}`;
    return `${base}${ep}/${encodeURIComponent(level)}`;
  }

  async function fetchLevel(level: string): Promise<LevelRoutesResponse> {
    const adp = await ensureAdapter();
    const config: RequestConfig = {
      route: `__forge__.load.${level}`,
      level,
      method: 'GET',
      url: buildUrl(level),
      headers: { Accept: 'application/json' },
      params: {},
      timeout,
      meta: {
        name: `__forge__.load.${level}`,
        uri: buildUrl(level),
        methods: ['GET'],
        parameters: [],
        level,
      },
    };
    // 拉取元信息直接走 adapter（不走 forge.interceptors 链，避免与业务调用混淆）
    const resp = await adp.request(config);
    if (!resp || resp.status < 200 || resp.status >= 300) {
      throw new Error(`Failed to load level ${level}: HTTP ${resp?.status}`);
    }
    const data = resp.data as LevelRoutesResponse;
    // 后端可能下发 cache 字段，让 RouteCache 优先采用
    return data;
  }

  async function loadOne(level: string): Promise<void> {
    assertLevelDeclared(level);
    assertAuth(level);

    // 缓存命中直接返回
    if (cache.get(level)) return;

    // inflight 去重
    const existing = inflight.get(level);
    if (existing) return existing;

    const p = (async () => {
      try {
        const resp = await fetchLevel(level);
        cache.set(resp);
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
    // 静态生成 URL：仅查已加载缓存，未加载时抛 UnknownRouteError
    const meta = findRouteMeta(level, name);
    if (!meta) {
      throw new UnknownRouteError(name, level);
    }
    return buildRequestUrl(meta, params ?? {});
  }

  function buildRequestUrl(meta: RouteMeta, params: Record<string, unknown>): string {
    let uri = meta.uri;
    const defaults = meta.parameter_defaults ?? {};
    const missingRequired: string[] = [];
    for (const p of meta.parameters) {
      let v = params[p];
      // 参数未传时回退到后端下发的默认值
      if ((v === undefined || v === null) && p in defaults) {
        v = defaults[p];
      }
      if (v === undefined || v === null) {
        // 可选参数（URI 中 {param?}）：替换为空字符串
        if (uri.includes(`{${p}?}`)) {
          uri = uri.replace(`{${p}?}`, '');
          continue;
        }
        missingRequired.push(p);
      } else {
        // 替换 {param} 或 {param?}
        uri = uri.replace(`{${p}?}`, encodeURIComponent(String(v))).replace(`{${p}}`, encodeURIComponent(String(v)));
      }
    }
    if (missingRequired.length > 0) {
      throw new MissingRouteParamError(meta.name, missingRequired);
    }
    // 清理可选参数移除后残留的连续 / 或尾部 /
    uri = uri.replace(/\/+/g, '/').replace(/\/$/, '');
    // url_prefix 含协议（如 https://api.example.com）时直接作为完整基础 URL，跳过 baseURL
    if (effectiveUrlPrefix.includes('://')) {
      const prefix = effectiveUrlPrefix.endsWith('/') ? effectiveUrlPrefix.slice(0, -1) : effectiveUrlPrefix;
      return uri.startsWith('/') ? `${prefix}${uri}` : `${prefix}/${uri}`;
    }
    const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const prefix = effectiveUrlPrefix;
    return uri.startsWith('/') ? `${base}${prefix}${uri}` : `${base}${prefix}/${uri}`;
  }

  function findRouteMeta(level: string, name: string): RouteMeta | undefined {
    const entry = cache.get(level);
    const meta = entry?.routes[name];
    if (meta) {
      return { ...meta, level };
    }
    return undefined;
  }

  async function api(level: string, name: string, params: ApiCallParams = {}): Promise<unknown> {
    await autoDiscoveryPromise;
    // 确保指定层级的路由元信息已加载
    await load(level);
    const meta = findRouteMeta(level, name);
    if (!meta) {
      throw new UnknownRouteError(name, level);
    }
    return doApiCall(meta, params);
  }

  async function doApiCall(meta: RouteMeta, params: ApiCallParams): Promise<unknown> {
    assertAuth(meta.level ?? '');
    const { pathParams, query, body, headers } = resolveApiParams(params);

    const method = pickMethod(meta);
    const urlWithQuery = appendQuery(buildRequestUrl(meta, pathParams), query);
    const config: RequestConfig = {
      route: meta.name,
      level: meta.level ?? '',
      method,
      url: urlWithQuery,
      headers: { Accept: 'application/json', ...(headers ?? {}) },
      body,
      params: pathParams,
      timeout,
      meta,
    };

    const adp = await ensureAdapter();

    // 5. 请求拦截链（LIFO，对齐 axios）；任段抛错且 onRejected 未消化 → 进入调用方 catch，不发请求
    // builtin.adapter 内部已执行 forge 拦截器（同一管理器对象引用，runsInterceptors=true）→ 跳过
    const finalConfig = adp.runsInterceptors
      ? config
      : await runRequestInterceptors(requestInterceptors, config);

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

  function invalidate(level?: string): void {
    if (level) cache.del(level);
    else cache.clear();
  }

  function isLoaded(level?: string): boolean {
    if (level) return cache.get(level) !== undefined;
    return effectiveLevels.every((lvl) => cache.get(lvl) !== undefined);
  }

  function hasRoute(level: string, name: string): boolean {
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
        result[k] = { ...v };
      }
      return result;
    }
    const result: Record<string, Record<string, RouteMeta>> = {};
    for (const lvl of effectiveLevels) {
      const entry = cache.get(lvl);
      if (entry) {
        const levelRoutes: Record<string, RouteMeta> = {};
        for (const [k, v] of Object.entries(entry.routes)) {
          levelRoutes[k] = { ...v };
        }
        result[lvl] = levelRoutes;
      }
    }
    return result;
  }

  // eager 层级自动加载（不阻塞 createRouteForge 返回；在自动发现完成后触发）
  void autoDiscoveryPromise
    .then(() => {
      if (effectiveEager.length > 0) {
        void Promise.all(effectiveEager.map((lvl) => load(lvl))).catch((e) => {
          console.warn(`[route-forge] eager load failed: ${(e as Error).message}`);
        });
      }
    })
    .catch(() => {
      /* 自动发现失败时不触发 eager */
    });

  return {
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
  };
}

function pickMethod(meta: RouteMeta): string {
  const m = meta.methods.find((x) => x.toUpperCase() !== 'HEAD');
  return (m ?? meta.methods[0] ?? 'GET').toUpperCase();
}

function appendQuery(url: string, query?: Record<string, unknown>): string {
  if (!query) return url;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    usp.append(k, String(v));
  }
  const qs = usp.toString();
  if (!qs) return url;
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

/**
 * 智能解析 ApiCallParams，分离路径参数 / query / body / headers。
 *
 * 规则：
 *   1. `params` 显式指定路径参数 → 优先级最高
 *   2. 平铺的 string | number 值（含与 query/body/headers 同名的 key）→ 路径参数
 *   3. `query` (对象) → 查询参数；`body` (非 string/number) → 请求体；`headers` (对象) → 请求头
 *
 * @see .docs/SPEC.md §4.1.3
 */
function resolveApiParams(input: ApiCallParams): {
  pathParams: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
} {
  const {
    params: explicitParams,
    query: rawQuery,
    body: rawBody,
    headers: rawHeaders,
    ...flatRest
  } = input;

  // 1. params 显式指定 → 作为路径参数基础
  const pathParams: Record<string, unknown> = explicitParams
    ? { ...explicitParams }
    : {};

  // 2. 其余平铺 key → 路径参数（params 优先，不覆盖已存在的 key）
  for (const [k, v] of Object.entries(flatRest)) {
    if (!(k in pathParams)) {
      pathParams[k] = v;
    }
  }

  // 3. 固定 key 智能消解：string/number → 路径参数；对象 → 固定用途
  let query: Record<string, unknown> | undefined;
  let body: unknown;
  let headers: Record<string, string> | undefined;

  // query: 对象类型 → 查询参数；string/number → 路径参数
  if (rawQuery !== undefined) {
    if (typeof rawQuery === 'object' && rawQuery !== null) {
      query = rawQuery as Record<string, unknown>;
    } else if (!('query' in pathParams)) {
      pathParams.query = rawQuery;
    }
  }

  // body: 非 string/number → 请求体；string/number → 路径参数
  if (rawBody !== undefined) {
    if (typeof rawBody !== 'string' && typeof rawBody !== 'number') {
      body = rawBody;
    } else if (!('body' in pathParams)) {
      pathParams.body = rawBody;
    }
  }

  // headers: 对象类型 → 请求头；string/number → 路径参数
  if (rawHeaders !== undefined) {
    if (typeof rawHeaders === 'object' && rawHeaders !== null) {
      headers = rawHeaders as Record<string, string>;
    } else if (!('headers' in pathParams)) {
      pathParams.headers = rawHeaders;
    }
  }

  return { pathParams, query, body, headers };
}

// 显式重导出，便于业务代码按需导入工具件
export { createInterceptorManager } from './interceptors.js';
export { RouteCache } from './cache.js';
export { ForgeError } from './errors.js';
