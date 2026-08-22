import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateRouteTypes, parseArgs } from '../src/codegen/index.js';
import type { RouteMeta } from '../src/types.js';

function makeRoute(overrides: Partial<RouteMeta> = {}): RouteMeta {
  return {
    name: 'test.route',
    uri: 'test/{id}',
    methods: ['GET', 'HEAD'],
    parameters: ['id'],
    ...overrides,
  };
}

describe('generateRouteTypes', () => {
  it('emits method/params/response fields for GET route', () => {
    const routes: Record<string, RouteMeta> = {
      'user.show': makeRoute({ name: 'user.show' }),
    };
    const dts = generateRouteTypes(routes);
    expect(dts).toContain('method: "GET"');
    expect(dts).toContain('id: string | number');
    expect(dts).toContain('response: unknown');
    expect(dts).toContain('export interface ForgeRoutes');
  });

  it('adds body field for POST route', () => {
    const routes: Record<string, RouteMeta> = {
      'user.create': makeRoute({
        name: 'user.create',
        uri: 'users',
        methods: ['POST'],
        parameters: [],
      }),
    };
    const dts = generateRouteTypes(routes);
    expect(dts).toContain('body: unknown');
  });

  it('does not add body field for GET route', () => {
    const routes: Record<string, RouteMeta> = {
      'user.show': makeRoute({ name: 'user.show' }),
    };
    const dts = generateRouteTypes(routes);
    expect(dts).not.toContain('body:');
  });
});

describe('parseArgs', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error('exit:' + code);
    });
  });

  afterEach(() => {
    errSpy.mockRestore();
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('extracts endpoint/levels/out from --flag value form', () => {
    const opts = parseArgs([
      '--endpoint', 'http://localhost/_forge/routes',
      '--levels', 'admin,client',
      '--out', 'src/types/forge.d.ts',
    ]);
    expect(opts.endpoint).toBe('http://localhost/_forge/routes');
    expect(opts.levels).toEqual(['admin', 'client']);
    expect(opts.out).toBe('src/types/forge.d.ts');
  });

  it('extracts from --flag=value form', () => {
    const opts = parseArgs([
      '--endpoint=http://localhost/_forge/routes',
      '--levels=public,admin',
      '--out=forge.d.ts',
    ]);
    expect(opts.endpoint).toBe('http://localhost/_forge/routes');
    expect(opts.levels).toEqual(['public', 'admin']);
    expect(opts.out).toBe('forge.d.ts');
  });

  it('defaults levels to empty array when not passed', () => {
    const opts = parseArgs(['--endpoint', 'http://x', '--out', 'y.d.ts']);
    expect(opts.levels).toEqual([]);
  });

  it('exits with error when --endpoint missing', () => {
    expect(() => parseArgs(['--out', 'y.d.ts'])).toThrow(/exit:1/);
  });

  it('exits with error when --out missing', () => {
    expect(() => parseArgs(['--endpoint', 'http://x'])).toThrow(/exit:1/);
  });
});
