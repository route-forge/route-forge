/**
 * useForgeApi：包装 forge.api()，自动管理 loading/error 状态
 * @see .docs/SPEC.md §4.1.7
 */

import { ref } from 'vue';
import { useForge } from '../plugin.js';
import type { ApiCallParams } from '@route-forge/core';

export interface UseForgeApiReturn {
  pending: ReturnType<typeof ref<boolean>>;
  error: ReturnType<typeof ref<unknown>>;
  call: (level: string, name: string, params?: ApiCallParams) => Promise<{
    data: unknown;
    error: unknown;
  }>;
}

export function useForgeApi(): UseForgeApiReturn {
  const forge = useForge();
  const pending = ref(false);
  const error = ref<unknown>(null);

  async function call(level: string, name: string, params?: ApiCallParams) {
    pending.value = true;
    error.value = null;
    try {
      const data = await forge.api(level, name, params);
      return { data, error: null };
    } catch (e) {
      error.value = e;
      return { data: undefined, error: e };
    } finally {
      pending.value = false;
    }
  }

  return { pending, error, call };
}
