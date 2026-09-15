/**
 * 二级路由类型映射与推断条件类型
 *
 * 声明 `ForgeRouteMap`（codegen 生成或 module augmentation）后，
 * api / route / hasRoute 的 name、params、响应类型按映射收敛；未声明时全部回退宽松类型。
 */

import type { ApiCallParams } from './http.js';

/**
 * 二级路由类型映射（可由 codegen 生成或通过 module augmentation 增强）
 *
 * @example
 * declare module '@route-forge/core' {
 *   interface ForgeRouteMap {
 *     admin: {
 *       'users.show': { method: 'GET'; params: { user: string | number }; response: User };
 *       'users.index': { method: 'GET'; params: {}; response: User[] };
 *     };
 *     public: {
 *       'login.show': { method: 'GET'; params: {}; response: unknown };
 *     };
 *   }
 * }
 */
export interface ForgeRouteMap {
}

/** 从 ForgeRouteMap 推断指定层级下的路由名；未定义时回退 string */
export type ForgeRouteName<L extends string> =
  [keyof ForgeRouteMap] extends [never]
    ? string
    : L extends keyof ForgeRouteMap
      ? keyof ForgeRouteMap[L] & string
      : string;

/** 从 ForgeRouteMap 推断指定路由的 params 类型；未定义时回退 ApiCallParams */
export type ForgeApiParams<L extends string, N extends string> =
  [keyof ForgeRouteMap] extends [never]
    ? ApiCallParams
    : L extends keyof ForgeRouteMap
      ? N extends keyof ForgeRouteMap[L]
        ? (ForgeRouteMap[L][N] extends { params: infer P } ? P & ApiCallParams : ApiCallParams)
        : ApiCallParams
      : ApiCallParams;

/** 从 ForgeRouteMap 推断指定路由的响应类型；未定义时回退 unknown */
export type ForgeApiResponse<L extends string, N extends string> =
  [keyof ForgeRouteMap] extends [never]
    ? unknown
    : L extends keyof ForgeRouteMap
      ? N extends keyof ForgeRouteMap[L]
        ? (ForgeRouteMap[L][N] extends { response: infer R } ? R : unknown)
        : unknown
      : unknown;
