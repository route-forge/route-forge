import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateRouteTypes, main as codegenMain, parseArgs } from '../src/codegen/index.js';
import type { RouteMeta } from '../src/types.js';
import { makeSummary } from './fixtures.js';

// Mock fs for codegen main tests
let fsWrittenContent = '';
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {
  }),
  writeFile: vi.fn(async (_p: string, content: string) => {
    fsWrittenContent = content;
  }),
}));

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
    const routesByLevel: Record<string, Record<string, RouteMeta>> = {
      public: {
        'user.show': makeRoute({ name: 'user.show' }),
      },
    };
    const dts = generateRouteTypes(routesByLevel);
    expect(dts).toContain('method: "GET"');
    expect(dts).toContain('id: string | number');
    expect(dts).toContain('response: unknown');
    expect(dts).toContain('export interface ForgeRouteMap');
  });

  it('adds body field for POST route', () => {
    const routesByLevel: Record<string, Record<string, RouteMeta>> = {
      public: {
        'user.create': makeRoute({
          name: 'user.create',
          uri: 'users',
          methods: ['POST'],
          parameters: [],
        }),
      },
    };
    const dts = generateRouteTypes(routesByLevel);
    expect(dts).toContain('body: unknown');
  });

  it('does not add body field for GET route', () => {
    const routesByLevel: Record<string, Record<string, RouteMeta>> = {
      public: {
        'user.show': makeRoute({ name: 'user.show' }),
      },
    };
    const dts = generateRouteTypes(routesByLevel);
    expect(dts).not.toContain('body:');
  });

  it('groups routes by level', () => {
    const routesByLevel: Record<string, Record<string, RouteMeta>> = {
      admin: {
        'users.show': makeRoute({ name: 'users.show' }),
      },
      public: {
        'login.show': makeRoute({ name: 'login.show', uri: 'login', parameters: [] }),
      },
    };
    const dts = generateRouteTypes(routesByLevel);
    expect(dts).toContain('"admin"');
    expect(dts).toContain('"public"');
    expect(dts).toContain('"users.show"');
    expect(dts).toContain('"login.show"');
    expect(dts).toContain('export interface ForgeRouteMap');
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

describe('codegen main with unassigned real level', () => {
  let originalFetch: typeof globalThis.fetch;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fsWrittenContent = '';
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error('exit:' + code);
    });
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    errSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('includes unassigned real level routes in generated types (fetched via HTTP)', async () => {
    const summary = makeSummary({
      levels: {
        public: { description: 'public', load: 'lazy', route_count: 1 },
        unassigned: { description: 'unassigned', load: 'lazy', route_count: 1 },
      },
    });
    const okJson = (data: unknown) => ({
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/_forge/routes') return okJson(summary) as any;
      if (url === '/_forge/routes/public') {
        return okJson({
          level: 'public',
          routes: { 'user.show': { name: 'user.show', uri: 'users/{user}', methods: ['GET'], parameters: ['user'] } },
        }) as any;
      }
      if (url === '/_forge/routes/unassigned') {
        return okJson({
          level: 'unassigned',
          routes: { 'debug.info': { name: 'debug.info', uri: '_debug/info', methods: ['GET', 'HEAD'], parameters: [] } },
        }) as any;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '', headers: new Headers() } as any;
    });

    await codegenMain(['--endpoint', '/_forge/routes', '--out', 'test.d.ts']);

    expect(fsWrittenContent).toContain('"unassigned"');
    expect(fsWrittenContent).toContain('"debug.info"');
    expect(fsWrittenContent).toContain('"public"');
    expect(fsWrittenContent).toContain('"user.show"');
  });
});
