/**
 * useForgeRoute：仅生成 URL，不发请求（用于 <a href>、外部跳转等）
 * @see .docs/SPEC.md §4.1.7
 */

import { useMemo } from 'react';
import { useForge } from '../provider.js';

export function useForgeRoute(
  level: string,
  name: string,
  params?: Record<string, unknown>,
): string {
  const forge = useForge();
  return useMemo(
    () => forge.route(level, name, params),
    [forge, level, name, params],
  );
}
