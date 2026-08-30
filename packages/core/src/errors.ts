/**
 * Route Forge 错误基类与具体错误类
 * @see .docs/SPEC.md §6
 */

export interface ForgeErrorContext {
  [key: string]: unknown;
}

/**
 * Route Forge 错误码字面量联合。
 * 用户侧 `switch (e.code)` 可获得穷尽检查（漏分支编译报错）。
 */
export type ForgeErrorCode =
  | 'RF_FE_001'  // 路由名不存在
  | 'RF_FE_002'  // 层级未声明
  | 'RF_FE_003'  // 必填路径参数缺失
  | 'RF_FE_005'  // adapter:'axios' 但未检测到 axios
  | 'RF_FE_006'  // 请求拦截器返回非 RequestConfig
  | 'RF_FE_007'  // 网络错误
  | 'RF_FE_008'  // HTTP 非 2xx
  | 'RF_FE_009'  // 请求被取消
  | 'RF_FE_010'; // auto-discovery 未完成守卫

export class ForgeError extends Error {
  readonly code: ForgeErrorCode;
  readonly route?: string;
  readonly level?: string;
  readonly context?: ForgeErrorContext;
  readonly cause?: unknown;

  constructor(
    message: string,
    opts: {
      code: ForgeErrorCode;
      route?: string;
      level?: string;
      context?: ForgeErrorContext;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = opts.code;
    if (opts.route !== undefined) this.route = opts.route;
    if (opts.level !== undefined) this.level = opts.level;
    if (opts.context !== undefined) this.context = opts.context;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/** RF_FE_001：路由名不存在于已加载层级中 */
export class UnknownRouteError extends ForgeError {
  constructor(route: string, level?: string) {
    super(`Route "${route}" not found${level ? ` in level "${level}"` : ''}`, {
      code: 'RF_FE_001',
      route,
      level,
    });
  }
}

/** RF_FE_002：路由所在层级未在 levels 声明 */
export class UnknownLevelError extends ForgeError {
  constructor(level: string) {
    super(`Level "${level}" not declared in options.levels`, {
      code: 'RF_FE_002',
      level,
    });
  }
}

/** RF_FE_003：路径参数缺失（strict=true 时） */
export class MissingRouteParamError extends ForgeError {
  constructor(route: string, missingParams: string[]) {
    super(`Missing path parameter(s) ${missingParams.join(', ')} for route "${route}"`, {
      code: 'RF_FE_003',
      route,
      context: { missingParams },
    });
  }
}

/** RF_FE_005：adapter: 'axios' 但未检测到 axios */
export class AdapterNotFoundError extends ForgeError {
  constructor(adapter: string) {
    super(`Adapter "${adapter}" not available; install axios or use 'builtin'`, {
      code: 'RF_FE_005',
      context: { adapter },
    });
  }
}

/** RF_FE_006：请求拦截器返回非 RequestConfig */
export class InvalidInterceptorReturnError extends ForgeError {
  constructor(route?: string) {
    super(`Request interceptor must return a RequestConfig object`, {
      code: 'RF_FE_006',
      route,
    });
  }
}

/** RF_FE_007：adapter 抛出的网络错误（DNS、连接超时等） */
export class NetworkError extends ForgeError {
  constructor(message: string, route?: string, level?: string, cause?: unknown) {
    super(message, { code: 'RF_FE_007', route, level, cause });
  }
}

/** RF_FE_008：HTTP 非 2xx 且未被 onRejected 拦截器恢复 */
export class HTTPError extends ForgeError {
  constructor(
    message: string,
    opts: { route?: string; level?: string; status?: number; url?: string; method?: string; cause?: unknown },
  ) {
    super(message, {
      code: 'RF_FE_008',
      route: opts.route,
      level: opts.level,
      context: { status: opts.status, url: opts.url, method: opts.method },
      cause: opts.cause,
    });
  }
}

/** RF_FE_009：请求被 AbortSignal 取消 */
export class RequestAbortedError extends ForgeError {
  constructor(route?: string, level?: string, cause?: unknown) {
    super(`Request aborted${route ? ` for route "${route}"` : ''}`, {
      code: 'RF_FE_009',
      route,
      level,
      cause,
    });
  }
}
