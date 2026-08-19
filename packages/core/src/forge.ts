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
  InterceptorManagerImpl,
  createInterceptorManager,
  runRequestInterceptors,
  runResponseInterceptors,
} from './interceptors.js';
import { resolveAdapter } from './adapters/index.js';
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
} from './types.js';

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CACHE_TTL = 3600;
const DEFAULT_NAME_SEPARATOR = '.';

export function createRouteForge(options: RouteForgeOptions): RouteForge {
  if (!options.endpoint) throw new TypeError('options.endpoint is required');
  if (!Array.isArray(options.levels) || options.levels.length === 0) {
    throw new TypeError('options.levels must be a non-empty array');
  }

  const {
    endpoint,
    levels,
    eager = [],
    adapter = 'auto',
    strict = true,
    timeout = DEFAULT_TIMEOUT,
    baseURL = '',
    nameSeparator = DEFAULT_NAME_SEPARATOR,
    auth,
    interceptors: declarativeInterceptors,
    cache: cacheOpts = {},
  } = options;

  const cacheTtl = cacheOpts.ttl ?? DEFAULT_CACHE_TTL;
  const cacheStorage = cacheOpts.storage ?? 'memory';
  const cache = new RouteCache({ storage: cacheStorage, ttl: cacheTtl });

  const requestInterceptors: InterceptorManager<RequestConfig, RequestConfig> = new InterceptorManagerImpl();
  const responseInterceptors: InterceptorManager<ResponseData, unknown> = new InterceptorManagerImpl();

  // 声明式拦截器先注册（按数组顺序），随后允许运行时 use() 追加
  if (declarativeInterceptors?.request) {
    for (const pair of declarativeInterceptors.request) {
      const [onFulfilled, onRejected] = pair;
      requestInterceptors.use(onFulfilled, onRejected);
    }
  }
  if (declarativeInterceptors?.response) {
    for (const pair of declarativeInterceptors.response) {
      const [onFulfilled, onRejected] = pair;
      responseInterceptors.use(onFulfilled, onRejected);
    }
  }

  const adapterPromise = resolveAdapter({ adapter });
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
      // 当 adapter 未提供 interceptor manager 时，回退到 forge 自身管理器
      if (!adapterObj.interceptors) {
        adapterObj.interceptors = {
          request: requestInterceptors,
          response: responseInterceptors,
        };
      }
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
    if (!levels.includes(level)) {
      if (strict) throw new UnknownLevelError(level);
      return;
    }
  }

  function buildUrl(level: string): string {
    const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const ep = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
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
    const list = Array.isArray(level) ? level : [level];
    await Promise.all(list.map(loadOne));
  }

  function route(name: string, params?: Record<string, unknown>): string {
    // 静态生成 URL：仅查已加载缓存，未加载时 strict 抛 UnknownRouteError
    const meta = findRouteMeta(name);
    if (!meta) {
      if (strict) throw new UnknownRouteError(name);
      return '';
    }
    return buildRequestUrl(meta, params ?? {});
  }

  function buildRequestUrl(meta: RouteMeta, params: Record<string, unknown>): string {
    let uri = meta.uri;
    for (const p of meta.parameters) {
      const v = params[p];
      if (v === undefined) {
        if (strict) throw new MissingRouteParamError(meta.name, [p]);
        uri = uri.replace(`{${p}}`, '');
      } else {
        uri = uri.replace(`{${p}}`, encodeURIComponent(String(v)));
      }
    }
    const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    return uri.startsWith('/') ? `${base}${uri}` : `${base}/${uri}`;
  }

  function findRouteMeta(name: string): RouteMeta | undefined {
    for (const level of levels) {
      const entry = cache.get(level);
      const meta = entry?.routes[name];
      if (meta) {
        return { ...meta, level };
      }
    }
    return undefined;
  }

  async function api(name: string, params: ApiCallParams = {}): Promise<unknown> {
    const meta = findRouteMeta(name);
    if (!meta) {
      // 隐式懒加载：路由名不在缓存中，可能是其层级尚未加载
      // 1. 尝试通过 name 分隔符拆出可能的 level 名（如 'admin.users.show' → 'admin'）
      const firstSeg = name.split(nameSeparator)[0];
      if (firstSeg && levels.includes(firstSeg)) {
        await load(firstSeg);
      }
      // 重新查询
      const reMeta = findRouteMeta(name);
      if (!reMeta) {
        if (strict) throw new UnknownRouteError(name);
        return undefined;
      }
      return doApiCall(reMeta, params);
    }
    return doApiCall(meta, params);
  }

  async function doApiCall(meta: RouteMeta, params: ApiCallParams): Promise<unknown> {
    assertAuth(meta.level ?? '');
    const { query, body, headers, ...pathParams } = params;

    // 校验路径参数
    for (const p of meta.parameters) {
      if (pathParams[p] === undefined) {
        if (strict) throw new MissingRouteParamError(meta.name, [p]);
      }
    }

    const method = pickMethod(meta);
    const urlWithQuery = appendQuery(buildRequestUrl(meta, pathParams as Record<string, unknown>), query);
    const config: RequestConfig = {
      route: meta.name,
      level: meta.level ?? '',
      method,
      url: urlWithQuery,
      headers: { Accept: 'application/json', ...(headers ?? {}) },
      body,
      params: pathParams as Record<string, unknown>,
      meta,
    };

    // 5. 请求拦截链（注册顺序正序）；任一段抛错且 onRejected 未消化 → 进入调用方 catch，不发请求
    const finalConfig = await runRequestInterceptors(requestInterceptors, config);

    const adp = await ensureAdapter();
    void timeout;

    // 6. adapter 调用 → 7/8 的错误转换 + 响应拦截链
    // HTTP 非 2xx 转 HTTPError；底层网络错误（非 ForgeError）转 NetworkError
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

    // 响应拦截链（注册顺序正序）；末段返回值即 api() resolve 值
    return runResponseInterceptors(responseInterceptors, source);
  }

  function invalidate(level?: string): void {
    if (level) cache.del(level);
    else cache.clear();
  }

  // 初始化：拉取 eager 列表（异步触发，不阻塞 createRouteForge 返回）
  if (eager.length > 0) {
    void Promise.all(
      eager.filter((l) => levels.includes(l)).map((l) => loadOne(l).catch(() => undefined)),
    );
  }

  return {
    api,
    load,
    route,
    invalidate,
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

// 显式重导出，便于业务代码按需导入工具件
export { createInterceptorManager } from './interceptors.js';
export { RouteCache } from './cache.js';
export { ForgeError } from './errors.js';
