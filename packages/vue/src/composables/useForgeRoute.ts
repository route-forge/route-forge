/**
 * useForgeRoute：仅生成 URL，不发请求（用于 <a href>、外部跳转等）
 * @see .docs/SPEC.md §4.1.7
 */

import { computed, type ComputedRef } from 'vue';
import { useForge } from '../plugin.js';

export function useForgeRoute(
  level: string | (() => string),
  name: string | (() => string),
  params?: () => Record<string, unknown>,
): ComputedRef<string> {
  const forge = useForge();
  return computed(() => {
    const lvl = typeof level === 'function' ? level() : level;
    const n = typeof name === 'function' ? name() : name;
    const p = params ? params() : undefined;
    return forge.route(lvl, n, p);
  });
}
