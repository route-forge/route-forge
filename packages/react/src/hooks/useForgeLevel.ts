/**
 * useForgeLevel：声明组件依赖某层级，挂载时自动 forge.load(level)
 * @see .docs/SPEC.md §4.1.7
 */

import { useEffect, useState } from 'react';
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

  const load = async () => {
    try {
      await forge.load(level);
      setLoaded(true);
    } catch (e) {
      setError(e);
    }
  };

  useEffect(() => {
    load();
  }, [level]);

  return { loaded, error, load };
}
