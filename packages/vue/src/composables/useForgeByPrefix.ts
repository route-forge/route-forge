/**
 * useForgeByPrefix：带层级 + 名字前缀的封装，方便后续减少名称传入
 * @see .docs/SPEC.md §4.1.7
 *
 * 示例：
 *   const { api } = useForgeByPrefix('admin', 'users');
 *   await api('show', { user: 1 });   // 等价于 forge.api('admin', 'users.show', { user: 1 })
 */

import { useForge } from '../plugin.js';
import type { ApiCallParams } from '@route-forge/core';

export interface UseForgeByPrefixReturn {
  api: (suffix: string, params?: ApiCallParams) => Promise<unknown>;
  route: (suffix: string, params?: Record<string, unknown>) => string;
}

export function useForgeByPrefix(level: string, prefix: string, separator = '.'): UseForgeByPrefixReturn {
  const forge = useForge();

  const join = (suffix: string) => (suffix ? `${prefix}${separator}${suffix}` : prefix);

  return {
    api: (suffix, params) => forge.api(level, join(suffix), params),
    route: (suffix, params) => forge.route(level, join(suffix), params),
  };
}
