/**
 * ForgeRouteMap 类型推断测试（审计项 L6）
 *
 * 类型级断言由 `pnpm typecheck`（tsc --noEmit）保证：
 * 断言错误会在类型检查阶段报错，而非运行时。
 *
 * 注：ForgeRouteMap 定义分支（有 codegen 生成映射时的字面量约束）
 * 由 codegen 测试对生成的 d.ts 结构做运行时断言，此处覆盖空映射回退分支。
 */
import { describe, expectTypeOf, it } from 'vitest';
import { createRouteForge } from '../src/index.js';
import type {
  ApiCallParams,
  ForgeApiParams,
  ForgeApiResponse,
  ForgeRequest,
  ForgeRouteName,
} from '../src/types.js';

describe('ForgeRouteMap type inference fallback (L6)', () => {
  it('ForgeRouteName falls back to string when ForgeRouteMap is empty', () => {
    expectTypeOf<ForgeRouteName<'admin'>>().toEqualTypeOf<string>();
    expectTypeOf<ForgeRouteName<'whatever'>>().toEqualTypeOf<string>();
  });

  it('ForgeApiParams falls back to ApiCallParams when ForgeRouteMap is empty', () => {
    expectTypeOf<ForgeApiParams<'admin', 'users.show'>>().toEqualTypeOf<ApiCallParams>();
  });

  it('ForgeApiResponse falls back to unknown when ForgeRouteMap is empty', () => {
    expectTypeOf<ForgeApiResponse<'admin', 'users.show'>>().toEqualTypeOf<unknown>();
  });
});

describe('RouteForge main-entry generics fall back to untyped when map is empty', () => {
  const forge = createRouteForge({ summary: { schemeVersion: 1, levels: {}, config: { strict_mode: false, endpoint_prefix: '/_forge/routes', url_prefix: null, cache_ttl: 3600 } } });

  // 纯类型断言：调用包进不执行的函数体，避免触发运行时路由查找
  it('api returns ForgeRequest<unknown> and accepts plain ApiCallParams', () => {
    void (() => {
      expectTypeOf(forge.api('admin', 'users.show')).toEqualTypeOf<ForgeRequest<unknown>>();
      expectTypeOf(forge.api('admin', 'users.show', { user: 1 })).toEqualTypeOf<ForgeRequest<unknown>>();
    });
  });

  it('route / url / hasRoute accept arbitrary string names', () => {
    void (() => {
      expectTypeOf(forge.route('admin', 'users.show')).toEqualTypeOf<string>();
      expectTypeOf(forge.url('admin', 'users.show', { user: 1 })).toEqualTypeOf<string>();
      expectTypeOf(forge.hasRoute('admin', 'users.show')).toEqualTypeOf<boolean>();
    });
  });
});
