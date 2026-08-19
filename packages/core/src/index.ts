/**
 * @route-forge/core 公共入口
 * @see .docs/SPEC.md §4
 */

export { createRouteForge } from './forge.js';
export { createInterceptorManager, InterceptorManagerImpl } from './interceptors.js';
export { RouteCache } from './cache.js';

export {
  ForgeError,
  UnknownRouteError,
  UnknownLevelError,
  MissingRouteParamError,
  InsufficientAuthError,
  AdapterNotFoundError,
  InvalidInterceptorReturnError,
  NetworkError,
  HTTPError,
} from './errors.js';

export type {
  RouteMeta,
  LevelRoutesResponse,
  RequestConfig,
  ResponseData,
  ApiCallParams,
  CacheStorage,
  AdapterOption,
  Fetcher,
  InterceptorManager,
  InterceptorHandler,
  RouteForge,
  RouteForgeOptions,
} from './types.js';
