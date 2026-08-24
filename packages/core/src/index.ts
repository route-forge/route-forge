/**
 * @route-forge/core 公共入口
 * @see .docs/SPEC.md §4
 */

export { createRouteForge } from './forge.js';
export { createInterceptorManager, InterceptorManagerImpl } from './interceptors.js';
export { RouteCache } from './cache.js';
export { LoadingTracker } from './loading.js';

export {
  ForgeError,
  UnknownRouteError,
  UnknownLevelError,
  MissingRouteParamError,
  AdapterNotFoundError,
  InvalidInterceptorReturnError,
  NetworkError,
  HTTPError,
  RequestAbortedError,
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
  SummaryResponse,
  ForgeRouteMap,
  ForgeRouteName,
  ForgeApiParams,
  ForgeApiResponse,
} from './types.js';

export type {
  LoadingChangeCallback,
  LoadingChangeEvent,
} from './loading.js';
