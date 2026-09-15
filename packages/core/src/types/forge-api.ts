/**
 * forge 顶层 API 形状、配置项、BoundForge 与 useForgeApi 返回类型
 * @see .docs/SPEC.md §4.1.6, §4.1.7, §5.2
 */

import type { LoadingChangeCallback } from '../loading.js';
import type { CacheStorage, SummaryResponse, RouteMeta } from './manifest.js';
import type {
  ApiCallParams,
  AdapterOption,
  InterceptorManager,
  RequestConfig,
  ResponseData,
  ForgeRequest,
} from './http.js';
import type {
  ForgeApiParams,
  ForgeApiResponse,
  ForgeRouteName,
} from './route-map.js';

/**
 * forge 顶层 API 形状
 */
export interface RouteForge {
  /**
   * 通过层级 + 路由名调用 API；level 用于确定加载哪个层级的路由元信息。
   * 声明 `ForgeRouteMap`（codegen 生成或 module augmentation）后，name / params / 响应类型
   * 按映射收敛；未声明映射时完全等价于 `(level: string, name: string, params?: ApiCallParams) => ForgeRequest<unknown>`。
   */
  api<L extends string, N extends ForgeRouteName<L>>(
    level: L,
    name: N,
    params?: ForgeApiParams<L, N>,
  ): ForgeRequest<ForgeApiResponse<L, N>>;

  /** 拉取一个或多个层级（自动并发去重） */
  load(level: string | string[]): Promise<void>;

  /**
   * 仅生成 URL，不发请求；level 用于定位路由所在的层级缓存。
   * 声明 `ForgeRouteMap` 后 name 按映射收敛（params 保持宽松——路径参数与后端默认值均可）。
   */
  route<L extends string, N extends ForgeRouteName<L>>(
    level: L,
    name: N,
    params?: Record<string, unknown>,
  ): string;

  /** route() 的语义别名，适用于链接生成等场景 */
  url<L extends string, N extends ForgeRouteName<L>>(
    level: L,
    name: N,
    params?: Record<string, unknown>,
  ): string;

  /**
   * 失效缓存：
   * - invalidate()：失效全部层级
   * - invalidate('admin')：失效指定层级
   * - invalidate(['admin', 'manage'])：批量失效指定层级
   */
  invalidate(level?: string | string[]): void;

  /** 检查指定层级路由是否已加载并缓存；不传参检查全部 */
  isLoaded(level?: string): boolean;

  /** 检查指定层级下某路由是否存在（需该层级缓存已加载）；声明 `ForgeRouteMap` 后 name 按映射收敛 */
  hasRoute<L extends string, N extends ForgeRouteName<L>>(level: L, name: N): boolean;

  /** 查询加载中标识状态 */
  isLoading(): boolean;

  /**
   * ready() 是否已成功 resolve（同步查询，不触发任何加载）。
   * discovery + eager 完成为 true；reject 不算就绪（保持 false）。
   * 供框架层 ready 门闩（react Provider `gate` / vue `ForgeReady`）避免多余的 fallback 首帧。
   */
  isReady(): boolean;

  /** 非致命警告是否启用（来自 createRouteForge({ warnings })，默认 true）；vue/react 适配层共用此开关 */
  readonly warnings: boolean;

  /** 订阅加载状态变更，返回取消订阅函数 */
  onLoadingChange(cb: LoadingChangeCallback): () => void;

  /**
   * 获取路由元信息快照（深拷贝，修改返回值不影响内部缓存）。
   * - getRoutes(level)：返回指定层级下全部路由；层级未声明抛 `UnknownLevelError`，
   *   已声明但未加载返回 `{}`
   * - getRoutes()：返回全部层级的路由（按 level 分组）
   */
  getRoutes(level: string): Record<string, RouteMeta>;
  getRoutes(): Record<string, Record<string, RouteMeta>>;

  /**
   * 当前已知的已声明层级列表（含后端恒注入的 `unassigned`）。
   * 内嵌 / `summary` 引导：构造后即可用；网络引导：`ready()` 前可能为空数组、之后为全量。
   * 只读发现 API，不触发加载、未就绪不抛错（返回 `[]`）。
   */
  getLevels(): string[];

  /** 拦截器入口（请求 / 响应） */
  interceptors: {
    request: InterceptorManager<RequestConfig, RequestConfig>;
    response: InterceptorManager<ResponseData, unknown>;
  };

  /**
   * auto-discovery + eager load 完成后 resolve。
   * 始终返回 Promise<this>，resolve 值为 forge 实例自身，支持链式调用。
   *
   * - 无参：返回 Promise，适合 async/await
   * - 有参：回调内部走 then/catch，仍返回 Promise
   */
  ready(): Promise<RouteForge>;
  ready(onFulfilled: (forge: RouteForge) => void, onRejected?: (error: unknown) => void): Promise<RouteForge>;

  /**
   * 绑定 level（+ 可选 prefix），返回 BoundForge。
   * 唯一入口 — Vue/React/IIFE 共享同一套 API 表面。
   *
   * - use()：不绑定，返回 RouteForge 自身
   * - use(level)：绑定 level
   * - use(level, prefix)：绑定 level + prefix
   */
  use(): RouteForge;
  use<L extends string>(level: L, prefix?: string): BoundForge;
}

/**
 * createRouteForge 配置项
 * @see .docs/SPEC.md §5.2
 */
export interface RouteForgeOptions {
  /**
   * 摘要端点 URL（网络拉取来源）。
   * 摘要数据源级联（SPEC §4.1.1）：Blade 注入的 `window.__ROUTE_FORGE__` > 本 `summary` 字段 > 网络拉取 `endpoint`。
   * 命中前两者时可省略；层级明细端点取自摘要 `levels[].route.uri`，不依赖本字段。
   * 三者皆无（既无注入/summary、又无 endpoint）时网络引导回退默认摘要端点 `/_forge/routes`（DEFAULT_ENDPOINT）。
   */
  endpoint?: string;
  /**
   * 直接提供摘要数据（SummaryResponse），跳过摘要 HTTP 往返——用于测试或非 Blade 的注入式引导。
   * 优先级低于页面内嵌的 `window.__ROUTE_FORGE__`（存在时以后端真值为准）。
   * @see .docs/SPEC.md §4.1.1 / §3.1.8
   */
  summary?: SummaryResponse;
  /**
   * 层级列表。未传时从摘要自动发现（SPEC §4.1.1）。
   * 显式传入时取与摘要响应 levels 键的交集（前端不能声明后端不存在的层级，SPEC §5.3）。
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
     * 声明式请求拦截器，只描述**一个**拦截器，支持三种写法（SPEC §4.1.1）：
     * - 函数 `resolve` → 视为 onFulfilled
     * - 元组 `[resolve?, reject?]` → 成功 / 失败（允许缺位，如 `[resolve]`、`[undefined, reject]`）
     * - 对象 `{ resolve?, reject? }` → 具名成功 / 失败
     * 需要注册多个拦截器请改用运行时 `forge.interceptors.request.use()`（可多次调用）。
     */
    request?:
      | ((c: RequestConfig) => RequestConfig | Promise<RequestConfig>)
      | [
          ((c: RequestConfig) => RequestConfig | Promise<RequestConfig>)?,
          ((e: unknown) => unknown | Promise<unknown>)?,
        ]
      | {
          resolve?: (c: RequestConfig) => RequestConfig | Promise<RequestConfig>;
          reject?: (e: unknown) => unknown | Promise<unknown>;
        };
    /**
     * 声明式响应拦截器，形状同 `request`（首段 onFulfilled 接收 ResponseData）。
     * 同样只描述一个拦截器，多拦截器改用运行时 `forge.interceptors.response.use()`。
     */
    response?:
      | ((r: ResponseData) => unknown | Promise<unknown>)
      | [((r: ResponseData) => unknown | Promise<unknown>)?, ((e: unknown) => unknown | Promise<unknown>)?]
      | {
          resolve?: (r: ResponseData) => unknown | Promise<unknown>;
          reject?: (e: unknown) => unknown | Promise<unknown>;
        };
  };
  /**
   * @deprecated 前端校验始终开启，此选项不再被消费。
   * 前端在层级未声明时始终抛 `UnknownLevelError`、路由名不存在始终抛 `UnknownRouteError`、
   * 必填路径参数缺失始终抛 `MissingRouteParamError` —— 校验行为与 strict 无关，静默忽略会掩盖拼写错误、难以排查。
   * 后端 `strict_mode` 的宽松/严格语义（未命中层级路由是否归入 unassigned/fallback）由后端在生成 manifest 时决定。
   * 字段保留仅为向后兼容，传入不会有任何效果。
   */
  strict?: boolean;
  timeout?: number;
  baseURL?: string;
  /**
   * 非致命警告开关（默认 true）：控制 core 内部的 `console.warn`（如显式 levels 降级、
   * endpoint_prefix 覆盖、schemeVersion 兼容提示等）。`false` 时静音这些 warn——
   * `console.error` 级输出（如 eager 层级加载失败）不受影响，错误永远响亮。
   * 该值以只读字段 `RouteForge.warnings` 暴露，vue/react 适配层的渲染期降级警告同样遵循它。
   */
  warnings?: boolean;
}

// ─── 框架层共享类型 ───

/**
 * 已绑定 level 的 forge 对象。
 * 由 `forge.use(level, prefix?)` 返回，Vue/React/IIFE 共享同一 API 表面。
 *
 * @typeParam LL - levelLoaded 的类型：core 默认 Promise<void>，Vue 替换为 Ref<boolean>
 */
export interface BoundForge<LL = Promise<void>> {
  /** 直接调用 = api 快捷方式，自动带绑定的 level */
  (name: string, params?: ApiCallParams): ForgeRequest;

  /** 当前绑定的 level */
  readonly level: string;
  /** 绑定的路由名前缀（仅传入 prefix 时存在） */
  readonly prefix?: string;
  /** level 加载状态（core: Promise<void>，Vue: Ref<boolean>） */
  levelLoaded: LL;

  // ─── 路由方法（level 已绑定，无需传） ───
  api(name: string, params?: ApiCallParams): ForgeRequest;
  route(name: string, params?: Record<string, unknown>): string;
  url(name: string, params?: Record<string, unknown>): string;
  hasRoute(name: string): boolean;
  getRoutes(): Record<string, RouteMeta>;

  // ─── 通用方法 ───
  load(): Promise<void>;
  invalidate(): void;
  isLoaded(): boolean;
  isLoading(): boolean;
  onLoadingChange(cb: LoadingChangeCallback): () => void;

  // ─── 等待 level 加载完成 ───
  /** 等待绑定的 level 加载完成，resolve 值为自身（BoundForge），保证可安全调用 */
  onLevelLoaded(): Promise<BoundForge<LL>>;
  onLevelLoaded(onFulfilled: (bound: BoundForge<LL>) => void, onRejected?: (error: unknown) => void): Promise<BoundForge<LL>>;

  // ─── 追加路由前缀（level 不可换） ───
  /** 在已绑定 level 基础上追加/替换 prefix，返回新的 BoundForge */
  useRoutePrefix(prefix: string): BoundForge<LL>;
}

/** call 函数签名 — 未绑定 level，需要显式传入 */
export interface UseForgeApiCall {
  (level: string, name: string, params?: ApiCallParams): Promise<{
    data: unknown;
    error: unknown;
  }>;
}

/** call 函数签名 — 已绑定 level，无需再传 */
export interface UseForgeApiBoundCall<L extends string> {
  (name: ForgeRouteName<L>, params?: ForgeApiParams<L, ForgeRouteName<L>>): Promise<{
    data: ForgeApiResponse<L, ForgeRouteName<L>>;
    error: unknown;
  }>;
}

/**
 * useForgeApi 返回类型 — 未绑定 level
 * @typeParam PendingType - 框架层 pending 状态类型（Vue: Ref<boolean>, React: boolean）
 * @typeParam ErrorType - 框架层 error 状态类型（Vue: Ref<unknown>, React: unknown）
 */
export interface UseForgeApiReturn<PendingType = unknown, ErrorType = unknown> {
  pending: PendingType;
  error: ErrorType;
  call: UseForgeApiCall;
}

/**
 * useForgeApi 返回类型 — 已绑定 level
 * @typeParam L - 层级名
 * @typeParam PendingType - 框架层 pending 状态类型
 * @typeParam ErrorType - 框架层 error 状态类型
 */
export interface UseForgeApiBoundReturn<L extends string, PendingType = unknown, ErrorType = unknown> {
  pending: PendingType;
  error: ErrorType;
  call: UseForgeApiBoundCall<L>;
}
