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
export type { ForgeRouteDegradeHooks } from './hooks/useForgeRoute.js';

export { ForgeRoute } from './components/ForgeRoute.js';
export type { ForgeRouteProps, ForgeRouteRenderState } from './components/ForgeRoute.js';
export { ForgeLink } from './components/ForgeLink.js';
export type { ForgeLinkProps } from './components/ForgeLink.js';
