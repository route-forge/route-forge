/**
 * useForgeLevel：声明组件依赖某层级，挂载时自动 forge.load(level)
 * @see .docs/SPEC.md §4.1.7
 */

import { useCallback, useEffect, useState } from 'react';
import { useForge } from '../provider.js';

export interface UseForgeLevelReturn {
  loaded: boolean;
  error: unknown;
  load: () => Promise<void>;
}

export function useForgeLevel(level: string): UseForgeLevelReturn {
  const forge = useForge();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      await forge.load(level);
      setLoaded(true);
    } catch (e) {
      setError(e);
    }
  }, [forge, level]);

  useEffect(() => {
    setLoaded(forge.isLoaded(level));
    void load();
  }, [forge, level, load]);

  return { loaded, error, load };
}
