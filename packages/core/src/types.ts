/**
 * @route-forge/core 核心类型定义
 * @see .docs/SPEC.md §4.1.3a, §4.1.1
 */

import type { LoadingChangeCallback } from './loading.js';

/**
 * 路由元信息（后端 /_forge/routes/{level} 返回的单条路由结构）
 */
export interface RouteMeta {
  /** 路由名，如 'admin.users.show' */
  name: string;
  /** 路由 URI 模板，如 'admin/users/{user}' */
  uri: string;
  /** 支持的 HTTP 方法集合，如 ['GET','HEAD'] */
  methods: string[];
  /** 路径参数名列表，如 ['user'] */
  parameters: string[];
  /** 路径参数默认值（Laravel ->defaults()），key 为参数名，value 为默认值 */
  parameter_defaults?: Record<string, unknown>;
  /** 所属层级（前端填充，便于隔离缓存） */
  level?: string;
  /** 后端下发的缓存 TTL（秒），优先级高于本地 cache.ttl */
  cache?: number | null;
}

/**
 * 某层级下的全部路由元信息响应
 */
export interface LevelRoutesResponse {
  level: string;
  routes: Record<string, RouteMeta>;
  /** 后端可选下发该层级缓存 TTL */
  cache?: number | null;
}

/**
 * 摘要端点响应（SPEC §3.1.6）
 * GET /_forge/routes 返回此结构
 */
export interface SummaryResponse {
  /** manifest 协议版本号（DESIGN.md §6.3），默认 1；前端可据此做向前兼容 */
  schemaVersion?: number;
  levels: Record<
    string,
    {
      description: string;
      load: 'lazy' | 'eager';
      cache: number | null;
      route_count: number;
    }
  >;
  config: {
    strict_mode: boolean;
    endpoint_prefix: string;
    /** 后端下发的 URL 前缀，生成 URL 时自动拼接到路由 URI 前面（SPEC §3.1.6） */
    url_prefix?: string;
  };
  unassigned: Array<{
    name: string;
    uri: string;
    methods: string[];
    parameters: string[];
    parameter_defaults?: Record<string, unknown>;
  }>;
}

/**
 * 请求拦截器接收/返回的配置对象（可变，返回修改后的版本）
 */
export interface RequestConfig {
  route: string;
  level: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  params: Record<string, unknown>;
  meta: RouteMeta;
  /** 请求超时毫秒数 */
  timeout?: number;
  /** 自定义 query 序列化函数 */
  paramsSerializer?: (params: Record<string, unknown>) => string;
}

/**
 * 响应拦截器首段接收的完整数据对象
 */
export interface ResponseData {
  route: string;
  level: string;
  method: string;
  url: string;
  status: number;
  headers: Headers;
  data: unknown;
  config: RequestConfig;
}

/**
 * forge.api(level, name, params) 调用参数
 *
 * 参数解析规则（智能消解）：
 *   1. `params` — 显式指定路径参数，优先级最高
 *   2. 平铺的 string | number 值 — 作为路径参数（含与 query/body/headers 同名的 key）
 *   3. `query` (对象) — 查询参数，序列化到 URL query string
 *   4. `body` (非 string/number) — 请求体
 *   5. `headers` (对象) — 自定义请求头
 *
 * 当路径参数名与 query/body/headers 冲突时：
 *   - 值为 string | number → 智能识别为路径参数
 *   - 同时提供 params 显式指定 → params 优先，固定 key 按原定义处理
 */
export interface ApiCallParams {
  /** 路径参数：填充到 URI 模板的 {name} 占位符 */
  [paramName: string]: unknown;

  /** 显式指定路径参数（优先级最高，解决路径参数名与 query/body/headers 冲突的场景） */
  params?: Record<string, unknown>;
  /**
   * 查询参数（对象 → query string）或路径参数（string | number → 填充 {query} 占位符）
   * @see .docs/SPEC.md §4.1.3 参数智能解析
   */
  query?: Record<string, unknown> | string | number;
  /**
   * 请求体（非基元值 → body）或路径参数（string | number → 填充 {body} 占位符）
   */
  body?: unknown;
  /**
   * 自定义请求头（对象 → headers）或路径参数（string | number → 填充 {headers} 占位符）
   */
  headers?: Record<string, string> | string | number;
  /**
   * 单次请求超时覆盖（毫秒）；不传时使用 createRouteForge({ timeout }) 全局值
   */
  timeout?: number;
}

/**
 * 缓存存储介质
 */
export type CacheStorage = 'memory' | 'sessionStorage' | 'localStorage';

/**
 * Adapter 选择值
 */
export type AdapterOption = 'auto' | 'axios' | 'builtin' | Fetcher;

/**
 * Fetcher 接口（自定义 adapter）
 * @see .docs/SPEC.md §4.3.3
 */
export interface Fetcher {
  request(config: RequestConfig): Promise<ResponseData>;
  interceptors?: {
    request?: InterceptorManager<RequestConfig, RequestConfig>;
    response?: InterceptorManager<ResponseData, unknown>;
  };
}

/**
 * 拦截器管理器接口（与 axios use/eject/clear API 一致）
 *
 * 双类型参数说明（对应 SPEC §4.1.3a）：
 *   - 请求拦截：TIn = TOut = RequestConfig（不可变换类型，仅修改字段）
 *   - 响应拦截：TIn = ResponseData, TOut = unknown（首段接收 ResponseData，
 *     后续段接收上一段返回值，返回类型由用户自行约束）
 */
export interface InterceptorManager<TIn, TOut = TIn> {
  use(
    onFulfilled?: (value: TIn) => TOut | Promise<TOut>,
    onRejected?: (error: unknown) => unknown | Promise<unknown>,
  ): number;
  eject(id: number): void;
  clear(): void;
  /** 内部使用：当前已注册拦截器快照 */
  forEach(fn: (handler: InterceptorHandler<TIn, TOut>) => void): void;
}

/**
 * 单个拦截器内部结构
 */
export interface InterceptorHandler<TIn, TOut = TIn> {
  id: number;
  onFulfilled?: (value: TIn) => TOut | Promise<TOut>;
  onRejected?: (error: unknown) => unknown | Promise<unknown>;
}

/**
 * forge 顶层 API 形状
 */
export interface RouteForge {
  /** 通过层级 + 路由名调用 API；level 用于确定加载哪个层级的路由元信息 */
  api(level: string, name: string, params?: ApiCallParams): Promise<unknown>;
  /** 拉取一个或多个层级（自动并发去重） */
  load(level: string | string[]): Promise<void>;

  /** 仅生成 URL，不发请求；level 用于定位路由所在的层级缓存 */
  route(level: string, name: string, params?: Record<string, unknown>): string;

  /** route() 的语义别名，适用于链接生成等场景 */
  url(level: string, name: string, params?: Record<string, unknown>): string;

  /**
   * 失效缓存：
   * - invalidate()：失效全部层级
   * - invalidate('admin')：失效指定层级
   * - invalidate(['admin', 'manage'])：批量失效指定层级
   */
  invalidate(level?: string | string[]): void;

  /** 检查指定层级路由是否已加载并缓存；不传参检查全部 */
  isLoaded(level?: string): boolean;

  /** 检查指定层级下某路由是否存在（需该层级缓存已加载） */
  hasRoute(level: string, name: string): boolean;

  /**
   * 查询加载中标识状态
   */
  isLoading(): boolean;

  /**
   * 订阅加载状态变更
   * @returns 取消订阅函数
   */
  onLoadingChange(cb: LoadingChangeCallback): () => void;

  /**
   * 获取路由元信息快照（深拷贝，修改返回值不影响内部缓存）。
   * - getRoutes(level)：返回指定层级下全部路由
   * - getRoutes()：返回全部层级的路由（按 level 分组）
   */
  getRoutes(level: string): Record<string, RouteMeta>;

  getRoutes(): Record<string, Record<string, RouteMeta>>;

  /** 拦截器入口（请求 / 响应） */
  interceptors: {
    request: InterceptorManager<RequestConfig, RequestConfig>;
    response: InterceptorManager<ResponseData, unknown>;
  };
}

/**
 * createRouteForge 配置项
 * @see .docs/SPEC.md §5.2
 */
export interface RouteForgeOptions {
  endpoint: string;
  /**
   * 层级列表。未传时从摘要端点自动发现（SPEC §4.1.1）。
   * 显式传入时取与后端摘要响应 levels 键的交集（前端不能声明后端不存在的层级，SPEC §5.3）。
   */
  levels?: string[];
  eager?: string[];
  adapter?: AdapterOption;
  cache?: {
    ttl?: number;
    storage?: CacheStorage;
  };
  interceptors?: {
    /**
     * 声明式请求拦截器列表，支持两种形式（SPEC §4.1.1）：
     * - 单一函数 → 视为 onFulfilled
     * - [onFulfilled?, onRejected?] 元组 → 完整拦截器定义
     */
    request?: Array<
      | ((c: RequestConfig) => RequestConfig | Promise<RequestConfig>)
      | [((c: RequestConfig) => RequestConfig | Promise<RequestConfig>) | undefined, ((e: unknown) => unknown | Promise<unknown>) | undefined]
    >;
    /**
     * 声明式响应拦截器列表，支持两种形式（SPEC §4.1.1）：
     * - 单一函数 → 视为 onFulfilled
     * - [onFulfilled?, onRejected?] 元组 → 完整拦截器定义
     */
    response?: Array<
      | ((r: ResponseData) => unknown | Promise<unknown>)
      | [((r: ResponseData) => unknown | Promise<unknown>) | undefined, ((e: unknown) => unknown | Promise<unknown>) | undefined]
    >;
  };
  strict?: boolean;
  timeout?: number;
  baseURL?: string;
}

/**
 * 二级路由类型映射（可由 codegen 生成或通过 module augmentation 增强）
 *
 * @example
 * declare module '@route-forge/core' {
 *   interface ForgeRouteMap {
 *     admin: {
 *       'users.show': { method: 'GET'; params: { user: string | number }; response: User };
 *       'users.index': { method: 'GET'; params: {}; response: User[] };
 *     };
 *     public: {
 *       'login.show': { method: 'GET'; params: {}; response: unknown };
 *     };
 *   }
 * }
 */
export interface ForgeRouteMap {
}

/** 从 ForgeRouteMap 推断指定层级下的路由名；未定义时回退 string */
export type ForgeRouteName<L extends string> =
  [keyof ForgeRouteMap] extends [never]
    ? string
    : L extends keyof ForgeRouteMap
      ? keyof ForgeRouteMap[L] & string
      : string;

/** 从 ForgeRouteMap 推断指定路由的 params 类型；未定义时回退 ApiCallParams */
export type ForgeApiParams<L extends string, N extends string> =
  [keyof ForgeRouteMap] extends [never]
    ? ApiCallParams
    : L extends keyof ForgeRouteMap
      ? N extends keyof ForgeRouteMap[L]
        ? (ForgeRouteMap[L][N] extends { params: infer P } ? P & ApiCallParams : ApiCallParams)
        : ApiCallParams
      : ApiCallParams;

/** 从 ForgeRouteMap 推断指定路由的响应类型；未定义时回退 unknown */
export type ForgeApiResponse<L extends string, N extends string> =
  [keyof ForgeRouteMap] extends [never]
    ? unknown
    : L extends keyof ForgeRouteMap
      ? N extends keyof ForgeRouteMap[L]
        ? (ForgeRouteMap[L][N] extends { response: infer R } ? R : unknown)
        : unknown
      : unknown;
