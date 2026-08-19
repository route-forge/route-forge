import { describe, it, expect } from 'vitest';
import {
  InterceptorManagerImpl,
  runRequestInterceptors,
  runResponseInterceptors,
} from '../src/interceptors.js';
import { InvalidInterceptorReturnError } from '../src/errors.js';
import type { RequestConfig, ResponseData } from '../src/types.js';

function makeConfig(): RequestConfig {
  return {
    route: 'test.show',
    level: 'admin',
    method: 'GET',
    url: '/admin/test',
    headers: {},
    params: {},
    meta: { name: 'test.show', uri: 'admin/test', methods: ['GET'], parameters: [] },
  };
}

function makeResponse(): ResponseData {
  return {
    route: 'test.show',
    level: 'admin',
    method: 'GET',
    url: '/admin/test',
    status: 200,
    headers: new Headers(),
    data: { ok: true },
    config: makeConfig(),
  };
}

describe('runRequestInterceptors', () => {
  it('runs in registration order (forward)', async () => {
    const mgr = new InterceptorManagerImpl<RequestConfig>();
    const order: string[] = [];
    mgr.use((c) => { order.push('a'); return c; });
    mgr.use((c) => { order.push('b'); return c; });
    mgr.use((c) => { order.push('c'); return c; });

    await runRequestInterceptors(mgr, makeConfig());
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('passes the returned value through each handler in chain', async () => {
    const mgr = new InterceptorManagerImpl<RequestConfig>();
    mgr.use((c) => { c.url += '/a'; return c; });
    mgr.use((c) => { c.url += '/b'; return c; });

    const result = await runRequestInterceptors(mgr, makeConfig());
    expect(result.url).toBe('/admin/test/a/b');
  });

  it('rejects non-object return with InvalidInterceptorReturnError', async () => {
    const mgr = new InterceptorManagerImpl<RequestConfig>();
    mgr.use(() => 'not-an-object' as unknown as RequestConfig);

    await expect(runRequestInterceptors(mgr, makeConfig())).rejects.toBeInstanceOf(InvalidInterceptorReturnError);
  });

  it('onFulfilled throwing jumps to next onRejected', async () => {
    const mgr = new InterceptorManagerImpl<RequestConfig>();
    const seen: string[] = [];
    mgr.use(() => { seen.push('f0'); throw new Error('boom'); });
    mgr.use(undefined, (e) => { seen.push('r1:' + (e as Error).message); return makeConfig(); });
    mgr.use((c) => { seen.push('f2'); return c; });

    await runRequestInterceptors(mgr, makeConfig());
    expect(seen).toEqual(['f0', 'r1:boom', 'f2']);
  });

  it('onRejected returning rejected promise propagates to caller', async () => {
    const mgr = new InterceptorManagerImpl<RequestConfig>();
    mgr.use(() => { throw new Error('boom'); });
    mgr.use(undefined, () => Promise.reject(new Error('still broken')));

    await expect(runRequestInterceptors(mgr, makeConfig())).rejects.toThrow('still broken');
  });

  it('supports async onFulfilled', async () => {
    const mgr = new InterceptorManagerImpl<RequestConfig>();
    const order: string[] = [];
    mgr.use(async (c) => { await Promise.resolve(); order.push('a'); return c; });
    mgr.use(async (c) => { order.push('b'); return c; });

    await runRequestInterceptors(mgr, makeConfig());
    expect(order).toEqual(['a', 'b']);
  });

  it('skips handlers with no onFulfilled (pass-through)', async () => {
    const mgr = new InterceptorManagerImpl<RequestConfig>();
    const seen: string[] = [];
    mgr.use(undefined, () => { seen.push('r0'); return makeConfig(); });
    mgr.use((c) => { seen.push('f1'); return c; });

    const result = await runRequestInterceptors(mgr, makeConfig());
    expect(seen).toEqual(['f1']);
    expect(result).toBeDefined();
  });
});

describe('runResponseInterceptors', () => {
  it('runs in registration order (forward) on 2xx', async () => {
    const mgr = new InterceptorManagerImpl<ResponseData, unknown>();
    const seen: string[] = [];
    mgr.use((r) => { seen.push('a'); return r; });
    mgr.use((r) => { seen.push('b'); return r; });
    mgr.use((r) => { seen.push('c'); return r; });

    await runResponseInterceptors(mgr, Promise.resolve(makeResponse()));
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('first onFulfilled receives ResponseData; subsequent receives previous return value', async () => {
    const mgr = new InterceptorManagerImpl<ResponseData, unknown>();
    const seen: unknown[] = [];
    mgr.use((r) => { seen.push(r.data); return { transformed: 1 }; });
    mgr.use((v) => { seen.push(v); return { transformed: 2 }; });
    mgr.use((v) => { seen.push(v); return v; });

    await runResponseInterceptors(mgr, Promise.resolve(makeResponse()));
    expect(seen).toEqual([{ ok: true }, { transformed: 1 }, { transformed: 2 }]);
  });

  it('HTTP non-2xx triggers onRejected chain', async () => {
    const mgr = new InterceptorManagerImpl<ResponseData, unknown>();
    const seen: string[] = [];
    const httpErr = Object.assign(new Error('HTTP 500'), { code: 'RF_FE_008' });
    mgr.use(undefined, (e) => { seen.push('r0:' + (e as Error).message); return { recovered: true }; });
    mgr.use((v) => { seen.push('f1:' + JSON.stringify(v)); return v; });

    const result = await runResponseInterceptors(mgr, Promise.reject(httpErr));
    expect(seen).toEqual(['r0:HTTP 500', `f1:${JSON.stringify({ recovered: true })}`]);
    expect(result).toEqual({ recovered: true });
  });

  it('all onRejected reject → caller catch', async () => {
    const mgr = new InterceptorManagerImpl<ResponseData, unknown>();
    mgr.use(undefined, () => Promise.reject(new Error('still broken')));

    await expect(runResponseInterceptors(mgr, Promise.reject(new Error('original'))))
      .rejects.toThrow('still broken');
  });

  it('onFulfilled throwing → next onRejected catches', async () => {
    const mgr = new InterceptorManagerImpl<ResponseData, unknown>();
    const seen: string[] = [];
    mgr.use(() => { seen.push('f0'); throw new Error('boom'); });
    mgr.use(undefined, (e) => { seen.push('r1:' + (e as Error).message); return 'recovered'; });

    const result = await runResponseInterceptors(mgr, Promise.resolve(makeResponse()));
    expect(seen).toEqual(['f0', 'r1:boom']);
    expect(result).toBe('recovered');
  });
});
