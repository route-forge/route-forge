/**
 * useForgeByPrefix：带层级 + 名字前缀的封装，方便后续减少名称传入
 * @see .docs/SPEC.md §4.1.7
 *
 * 智能前缀解析：
 *   - 传入后缀不以前缀开头 → 自动拼接 prefix.suffix
 *   - 传入后缀已以前缀开头（歧义） → 优先尝试完整拼接，
 *     若不存在则视为已含前缀直接使用，均不存在则报错
 *
 * 示例（prefix = 'test'）：
 *   api('1')        → test.1
 *   api('test1.1')  → test.test1.1
 *   api('test.1')   → 歧义：优先 test.test.1，回退 test.1
 */

import { useForge } from '../plugin.js';
import { resolveRouteName, resolveRouteNameSync } from '../utils/resolveRouteName.js';
import type { ApiCallParams } from '@route-forge/core';

export interface UseForgeByPrefixReturn {
  api: (suffix: string, params?: ApiCallParams) => Promise<unknown>;
  route: (suffix: string, params?: Record<string, unknown>) => string;
}

export function useForgeByPrefix(level: string, prefix: string, separator = '.'): UseForgeByPrefixReturn {
  const forge = useForge();

  return {
    api: (suffix, params) =>
      resolveRouteName(forge, level, prefix, suffix, separator).then(
        (name) => forge.api(level, name, params),
      ),
    route: (suffix, params) =>
      forge.route(level, resolveRouteNameSync(forge, level, prefix, suffix, separator), params),
  };
}
