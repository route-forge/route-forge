import { describe, it, expect } from 'vitest';
import { createInterceptorManager } from '../src/interceptors.js';

describe('InterceptorManager (scaffold smoke test)', () => {
  it('use / eject / clear behave like axios', () => {
    const mgr = createInterceptorManager<number>();
    const id = mgr.use((v) => v + 1);
    expect(id).toBe(0);
    expect((mgr as any).size).toBe(1);

    mgr.eject(id);
    expect((mgr as any).size).toBe(0);

    mgr.use((v) => v);
    mgr.use((v) => v);
    mgr.clear();
    expect((mgr as any).size).toBe(0);
  });
});
