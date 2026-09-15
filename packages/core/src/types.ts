/**
 * @route-forge/core 核心类型定义（聚合桶）
 *
 * 类型按功能拆分在 `types/` 下，本文件仅做 re-export，保持 `./types.js` 导入路径稳定：
 *   - types/manifest.ts   后端 manifest 契约（RouteMeta / LevelRoutesResponse / SummaryResponse / CacheStorage）
 *   - types/http.ts       请求响应 HTTP 层（RequestConfig / ResponseData / ApiCallParams / Fetcher / 拦截器 …）
 *   - types/route-map.ts  二级路由类型映射与推断条件类型（ForgeRouteMap / ForgeRouteName / ForgeApiParams / ForgeApiResponse）
 *   - types/forge-api.ts  顶层 API 形状与配置（RouteForge / RouteForgeOptions / BoundForge / UseForgeApi*）
 * @see .docs/SPEC.md §4
 */

export type {
  RouteMeta,
  LevelRoutesResponse,
  SummaryResponse,
  CacheStorage,
} from './types/manifest.js';

export type {
  RequestConfig,
  ResponseData,
  ForgeRequest,
  ApiCallParams,
  AdapterOption,
  Fetcher,
  InterceptorManager,
  InterceptorHandler,
} from './types/http.js';

export type {
  ForgeRouteMap,
  ForgeRouteName,
  ForgeApiParams,
  ForgeApiResponse,
} from './types/route-map.js';

export type {
  RouteForge,
  RouteForgeOptions,
  BoundForge,
  UseForgeApiCall,
  UseForgeApiBoundCall,
  UseForgeApiReturn,
  UseForgeApiBoundReturn,
} from './types/forge-api.js';
