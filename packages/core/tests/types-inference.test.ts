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
import type {
  ApiCallParams,
  ForgeApiParams,
  ForgeApiResponse,
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
