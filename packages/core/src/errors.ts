/**
 * Route Forge 错误基类与具体错误类
 * @see .docs/SPEC.md §6
 */

import type { ResponseData } from './types.js';

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

/** 候选值格式化：列出可用取值帮助排查拼写错误（超过 5 个截断显示 +N more） */
function formatCandidates(candidates?: string[]): string {
  if (!candidates || candidates.length === 0) return '';
  const MAX = 5;
  const shown = candidates.slice(0, MAX).join(', ');
  const more = candidates.length > MAX ? ` (+${candidates.length - MAX} more)` : '';
  return ` Available: ${shown}${more}`;
}

/** RF_FE_001：路由名不存在于已加载层级中 */
export class UnknownRouteError extends ForgeError {
  constructor(route: string, level?: string, candidates?: string[]) {
    super(
      `Route "${route}" not found${level ? ` in level "${level}"` : ''}.${formatCandidates(candidates)}`,
      {
        code: 'RF_FE_001',
        route,
        level,
        context: candidates && candidates.length > 0 ? { candidates } : undefined,
      },
    );
  }
}

/** RF_FE_002：路由所在层级未在 levels 声明 */
export class UnknownLevelError extends ForgeError {
  constructor(level: string, candidates?: string[]) {
    super(
      `Level "${level}" not declared in options.levels.${formatCandidates(candidates)}`,
      {
        code: 'RF_FE_002',
        level,
        context: candidates && candidates.length > 0 ? { candidates } : undefined,
      },
    );
  }
}

/** RF_FE_003：必填路径参数缺失（无后端 default 时，前端校验恒开） */
export class MissingRouteParamError extends ForgeError {
  constructor(route: string, missingParams: string[]) {
    super(`Missing path parameter(s) ${missingParams.join(', ')} for route "${route}"`, {
      code: 'RF_FE_003',
      route,
      context: { missingParams },
    });
  }
}

/** RF_FE_003：路径参数收到非原始值（对象/数组等，无法安全插入 URI） */
export class InvalidPathParamError extends ForgeError {
  constructor(route: string, param: string, value: unknown) {
    super(
      `Path parameter "${param}" must be a primitive value (string, number, boolean), got ${typeof value}`,
      { code: 'RF_FE_003', route, context: { param, value } },
    );
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

/**
 * RF_FE_008：HTTP 非 2xx 且未被 onRejected 拦截器恢复。
 *
 * `response` 携带完整的 ResponseData（status/headers/data/config），
 * 供响应拦截器 onRejected 链与最终 catch 逐段检查响应体——典型场景：
 * Laravel 422 校验错误回显（`err.response.data.errors`）。
 */
export class HTTPError extends ForgeError {
  readonly response?: ResponseData;
  constructor(
    message: string,
    opts: { route?: string; level?: string; status?: number; url?: string; method?: string; cause?: unknown; response?: ResponseData },
  ) {
    super(message, {
      code: 'RF_FE_008',
      route: opts.route,
      level: opts.level,
      context: { status: opts.status, url: opts.url, method: opts.method },
      cause: opts.cause,
    });
    if (opts.response !== undefined) this.response = opts.response;
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
