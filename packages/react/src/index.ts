/**
 * @route-forge/react 公共入口
 * @see .docs/SPEC.md §4.1.7
 */

export {
  RouteForgeProvider,
  ForgeContext,
  useForge,
} from './provider.js';
export type {
  RouteForgeProviderProps, ReactBoundForge,
} from './provider.js';

export { useForgeApi } from './hooks/useForgeApi.js';
export type {
  UseForgeApiReturnReact, UseForgeApiBoundReturnReact, UseForgeApiCall, UseForgeApiBoundCall,
} from './hooks/useForgeApi.js';

export { useForgeRoute } from './hooks/useForgeRoute.js';

export { useForgeByPrefix } from './hooks/useForgeByPrefix.js';
export type { UseForgeByPrefixReturn } from './hooks/useForgeByPrefix.js';
