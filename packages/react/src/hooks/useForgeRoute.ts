/**
 * useForgeRoute：响应式 URL 生成器，内部处理 level 加载状态
 * @see .docs/SPEC.md §4.1.7
 *
 * - level 未加载时返回空字符串 ''（不抛错，模板不崩）
 * - level 加载完成后自动更新并返回正确 URL
 * - 用户无需关心 levelLoaded 状态，直接用即可
 */

import { useContext, useEffect, useState } from 'react';
import { ForgeContext } from '../provider.js';

export function useForgeRoute(
  level: string,
  name: string,
  params?: Record<string, unknown>,
): string {
  const forge = useContext(ForgeContext);
  if (!forge) {
    throw new Error(
      '[route-forge/react] useForgeRoute() must be used within a <RouteForgeProvider>',
    );
  }

  const [url, setUrl] = useState('');

  useEffect(() => {
    let cancelled = false;

    if (!forge.isLoaded(level)) {
      forge.load(level).then(() => {
        if (!cancelled) {
          try {
            setUrl(forge.route(level, name, params));
          } catch {
            setUrl('');
          }
        }
      }).catch(() => {
        if (!cancelled) setUrl('');
      });
    } else {
      try {
        setUrl(forge.route(level, name, params));
      } catch {
        setUrl('');
      }
    }

    return () => {
      cancelled = true;
    };
  }, [forge, level, name, params]);

  return url;
}
