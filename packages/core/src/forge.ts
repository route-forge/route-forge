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
import type { LoadingChangeCallback } from './loading.js';
import { LoadingTracker } from './loading.js';
import {
  AdapterNotFoundError,
  ForgeError,
  HTTPError,
  MissingRouteParamError,
  NetworkError,
  RequestAbortedError,
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
  const explicitStrict = options.strict ?? false;
  const explicitEndpoint = options.endpoint;

  // effective* 状态：在摘要端点响应到达后被填充
  let effectiveLevels: string[] = explicitLevels ?? [];
  let effectiveEager: string[] = explicitEager ?? [];
  let effectiveStrict = explicitStrict;
  let effectiveEndpoint = explicitEndpoint;
  let effectiveUrlPrefix = '';  // 后端下发的 URL 前缀，默认为空

  // 未分配层级路由：来自摘要端点的 unassigned 字段，前端作为虚拟层级 "unassigned" 消费
  // @see .docs/SPEC.md §3.1.6
  let summaryUnassigned: SummaryResponse['unassigned'] | undefined;
  // 后端是否将 unassigned 作为真实层级注册（在 levels 中）；若是则走正常 HTTP 拉取，不走虚拟层级
  let backendHasUnassignedLevel = false;

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

    // 2. strict_mode 后端权威：不能放宽，可收紧
    if (summary.config.strict_mode && !explicitStrict) {
      console.warn(
        '[route-forge] backend strict_mode=true overrides frontend strict=false; forcing strict=true',
      );
      effectiveStrict = true;
    }

    // 3. levels 取交集或自动发现
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
  // 每个层级的失效代数，用于检测 loadOne 期间是否发生了 invalidate
  const invalidationGens = new Map<string, number>();

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
      throw new HTTPError(
        `Failed to load level "${level}": HTTP ${resp?.status}`,
        { level, status: resp?.status, url: buildUrl(level), method: 'GET' },
      );
    }
    const data = resp.data as LevelRoutesResponse;
    // 后端可能下发 cache 字段，让 RouteCache 优先采用
    return data;
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
    // 静态生成 URL：仅查已加载缓存，未加载时抛 UnknownRouteError
    const meta = findRouteMeta(level, name);
    if (!meta) {
      throw new UnknownRouteError(name, level);
    }
    return buildRequestUrl(meta, params ?? {});
  }

  function buildRequestUrl(meta: RouteMeta, params: Record<string, unknown>): string {
    const defaults = meta.parameter_defaults ?? {};
    const missingRequired: string[] = [];

    // 1. 预解析每个声明参数的最终值（显式传参 > 后端默认值），并收集缺失的必填参数
    const values: Record<string, unknown> = {};
    for (const p of meta.parameters) {
      let v = params[p];
      // 参数未传时回退到后端下发的默认值
      if ((v === undefined || v === null) && p in defaults) {
        v = defaults[p];
      }
      if (v === undefined || v === null) {
        // 可选参数（URI 中 {param?}）：稍后替换为空字符串；其余记为缺失
        if (!meta.uri.includes(`{${p}?}`)) {
          missingRequired.push(p);
        }
      } else {
        values[p] = v;
      }
    }
    if (missingRequired.length > 0) {
      throw new MissingRouteParamError(meta.name, missingRequired);
    }

    // 2. 单次遍历替换所有占位符：避免参数值中的 "{other}" 文本被后续参数二次替换（占位符注入）
    let uri = meta.uri.replace(/\{([^{}]+)\}/g, (match, raw: string) => {
      const optional = raw.endsWith('?');
      const name = optional ? raw.slice(0, -1) : raw;
      if (values[name] !== undefined) {
        const val = values[name];
        if (typeof val === 'object') {
          throw new ForgeError(
            `Path parameter "${name}" must be a primitive value (string, number, boolean), got ${typeof val}`,
            { code: 'RF_FE_003', route: meta.name, context: { param: name, value: val } },
          );
        }
        return encodeURIComponent(String(val));
      }
      // 值缺失：可选参数替换为空，未声明的占位符保持原样（不在 parameters 中）
      return optional ? '' : match;
    });
    // 清理可选参数移除后残留的连续 / 或尾部 /
    uri = uri.replace(/\/+/g, '/').replace(/\/$/, '');
    // url_prefix 含协议（如 https://api.example.com）时直接作为完整基础 URL，跳过 baseURL
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(effectiveUrlPrefix)) {
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
    const {
      pathParams,
      query,
      body,
      headers,
      timeout: perCallTimeout,
      signal,
    } = resolveApiParams(params);

    // 请求前检查：signal 已 abort 则直接抛错，不发请求
    if (signal?.aborted) {
      throw new RequestAbortedError(meta.name, meta.level, signal.reason);
    }

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
          if (isAbortError(err, finalConfig.signal)) {
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
  timeout?: number;
  signal?: AbortSignal;
} {
  const {
    params: explicitParams,
    query: rawQuery,
    body: rawBody,
    headers: rawHeaders,
    timeout: perCallTimeout,
    signal,
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

  return { pathParams, query, body, headers, timeout: perCallTimeout, signal };
}

/**
 * 判断错误是否为请求取消错误（AbortSignal 触发）
 * 兼容 fetch 的 DOMException AbortError 与 axios 的 CanceledError
 */
function isAbortError(err: unknown, signal?: AbortSignal): boolean {
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

// 显式重导出，便于业务代码按需导入工具件
export { createInterceptorManager } from './interceptors.js';
export { RouteCache } from './cache.js';
export { ForgeError } from './errors.js';
