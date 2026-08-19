/**
 * useForgeLevel：声明组件依赖某层级，挂载时自动 forge.load(level)，销毁时不主动失效
 * @see .docs/SPEC.md §4.1.7
 */

import { onMounted, ref } from 'vue';
import { useForge } from '../plugin.js';

export interface UseForgeLevelReturn {
  loaded: ReturnType<typeof ref<boolean>>;
  error: ReturnType<typeof ref<unknown>>;
}

export function useForgeLevel(level: string): UseForgeLevelReturn {
  const forge = useForge();
  const loaded = ref(false);
  const error = ref<unknown>(null);

  onMounted(async () => {
    try {
      await forge.load(level);
      loaded.value = true;
    } catch (e) {
      error.value = e;
    }
  });

  return { loaded, error };
}
