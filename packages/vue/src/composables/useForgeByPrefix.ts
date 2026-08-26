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

import { inject } from 'vue';
import { FORGE_INJECTION_KEY } from '../plugin.js';
import {
  resolveRouteName,
  resolveRouteNameSync,
  type RouteForge,
  type UseForgeByPrefixReturn,
} from '@route-forge/core';

export type { UseForgeByPrefixReturn };

export function useForgeByPrefix(level: string, prefix: string, separator = '.'): UseForgeByPrefixReturn {
  const forge = inject(FORGE_INJECTION_KEY) as RouteForge;

  return {
    api: (suffix, params) =>
      resolveRouteName(forge, level, prefix, suffix, separator).then(
        (name) => forge.api(level, name, params),
      ),
    route: (suffix, params) => {
      // level 未加载时返回空字符串，避免 resolveRouteNameSync 内部 hasRoute() 抛错
      if (!forge.isLoaded(level)) return '';
      return forge.route(level, resolveRouteNameSync(forge, level, prefix, suffix, separator), params);
    },
  };
}
