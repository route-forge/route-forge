/**
 * @route-forge/core 核心类型定义
 * @see .docs/SPEC.md §4.1.3a, §4.1.1
 */

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
  };
  unassigned: Array<{
    name: string;
    uri: string;
    methods: string[];
    parameters: string[];
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
 * forge.api(name, params) 调用参数
 */
export interface ApiCallParams {
  /** 路径参数：填充到 URI 模板的 {name} 占位符 */
  [paramName: string]: unknown;
  /** 查询参数，序列化到 URL query string */
  query?: Record<string, unknown>;
  /** 请求体，按 method 决定是否发送 */
  body?: unknown;
  /** 自定义请求头（与拦截器叠加） */
  headers?: Record<string, string>;
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
  /** 通过路由名调用 API */
  api(name: string, params?: ApiCallParams): Promise<unknown>;
  /** 拉取一个或多个层级（自动并发去重） */
  load(level: string | string[]): Promise<void>;
  /** 仅生成 URL，不发请求 */
  route(name: string, params?: Record<string, unknown>): string;
  /** 失效指定层级缓存；不传参失效全部 */
  invalidate(level?: string): void;
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
  auth?: {
    state?: () => boolean;
    levels?: Record<string, boolean>;
  };
  interceptors?: {
    request?: Array<[((c: RequestConfig) => RequestConfig | Promise<RequestConfig>) | undefined, ((e: unknown) => unknown | Promise<unknown>) | undefined]>;
    response?: Array<[((r: ResponseData) => unknown | Promise<unknown>) | undefined, ((e: unknown) => unknown | Promise<unknown>) | undefined]>;
  };
  strict?: boolean;
  timeout?: number;
  baseURL?: string;
  nameSeparator?: string;
}
