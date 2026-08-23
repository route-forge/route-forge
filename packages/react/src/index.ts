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
  RouteForgeProviderProps,
  BoundForgeTyped,
  ForgeInstanceTyped,
  BoundForgeMethods,
} from './provider.js';

export { useForgeApi } from './hooks/useForgeApi.js';
export type {
  UseForgeApiReturn,
  UseForgeApiBoundReturn,
  UseForgeApiCall,
  UseForgeApiBoundCall,
} from './hooks/useForgeApi.js';

export { useForgeLevel } from './hooks/useForgeLevel.js';
export type { UseForgeLevelReturn } from './hooks/useForgeLevel.js';

export { useForgeRoute } from './hooks/useForgeRoute.js';

export { useForgeByPrefix } from './hooks/useForgeByPrefix.js';
export type { UseForgeByPrefixReturn } from './hooks/useForgeByPrefix.js';
