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

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ForgeContext } from '../provider.js';
import {
  type ApiCallParams,
  resolveRouteName,
  resolveRouteNameSync,
  type RouteForge,
  type UseForgeByPrefixReturn,
} from '@route-forge/core';

export type { UseForgeByPrefixReturn };

export function useForgeByPrefix(level: string, prefix: string, separator = '.'): UseForgeByPrefixReturn {
  const forge = useContext(ForgeContext) as RouteForge;
  if (!forge) {
    throw new Error(
      '[route-forge/react] useForgeByPrefix() must be used within a <RouteForgeProvider>',
    );
  }

  // 追踪 level 加载状态，level 未加载时 route 返回 ''
  const [levelLoaded, setLevelLoaded] = useState(() => forge.isLoaded(level));

  useEffect(() => {
    if (forge.isLoaded(level)) {
      setLevelLoaded(true);
      return;
    }
    let cancelled = false;
    forge.load(level).then(() => {
      if (!cancelled) setLevelLoaded(true);
    }).catch(() => { /* 加载失败时 levelLoaded 保持 false */
    });
    return () => {
      cancelled = true;
    };
  }, [forge, level]);

  const api = useCallback(
    (suffix: string, params?: ApiCallParams) =>
      resolveRouteName(forge, level, prefix, suffix, separator).then(
        (name) => forge.api(level, name, params),
      ),
    [forge, level, prefix, separator],
  );

  const route = useCallback(
    (suffix: string, params?: Record<string, unknown>) => {
      // level 未加载时返回空字符串，避免 resolveRouteNameSync 内部 hasRoute() 抛错
      if (!levelLoaded) return '';
      return forge.route(level, resolveRouteNameSync(forge, level, prefix, suffix, separator), params);
    },
    [forge, level, prefix, separator, levelLoaded],
  );

  return useMemo(() => ({ api, route }), [api, route]);
}
