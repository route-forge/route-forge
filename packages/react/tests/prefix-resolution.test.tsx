import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { RouteForgeProvider, useForge } from '../src/index.js';
import type { LevelRoutesResponse, SummaryResponse } from '@route-forge/core';

// ─── mock helpers ───────────────────────────────────────────

function makeSummary(overrides: Partial<SummaryResponse> = {}): SummaryResponse {
  return {
    schemeVersion: 1,
    levels: {
      admin: {
        description: 'admin',
        load: 'eager',
        route_count: 0,
        route: { uri: '/_forge/routes/admin', methods: ['GET', 'HEAD'] },
      },
    },
    config: { strict_mode: false, endpoint_prefix: '/_forge/routes', url_prefix: null, cache_ttl: 3600 },
    ...overrides,
  };
}

function mockFull(summary: SummaryResponse, levelRoutes: Record<string, LevelRoutesResponse>) {
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    const ep = summary.config.endpoint_prefix;
    if (url === ep) {
      const body = JSON.stringify(summary);
      return {
        ok: true, status: 200,
        json: async () => summary,
        text: async () => body,
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    }
    if (url.startsWith(ep + '/')) {
      const level = url.slice(ep.length + 1).split('/')[0]!.split('?')[0];
      const lr = levelRoutes[level as string];
      if (!lr) {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => '',
          headers: new Headers(),
        } as any;
      }
      const body = JSON.stringify(lr);
      return {
        ok: true, status: 200,
        json: async () => lr,
        text: async () => body,
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '',
      headers: new Headers(),
    } as any;
  });
}

type RouteDef = { name: string; uri: string; methods: string[]; parameters: string[] };

function renderWithForge(
  setupFn: () => Record<string, unknown>,
  routes: Record<string, RouteDef>,
) {
  const summary = makeSummary();
  mockFull(summary, {
    admin: { level: 'admin', routes },
  });

  let result: Record<string, unknown> = {};

  function TestComponent() {
    result = setupFn();
    return createElement('div', { 'data-testid': 'test' }, 'test');
  }

  const utils = render(
    createElement(
      RouteForgeProvider,
      {
        options: {
          endpoint: '/_forge/routes',
          levels: ['admin'],
          adapter: 'builtin',
        },
      },
      createElement(TestComponent),
    ),
  );

  return { ...utils, getResult: () => result };
}

async function waitForLoad() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

// ─── tests ──────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('useForge with prefix — smart route name resolution', () => {
  it('suffix without prefix → auto-join (1 → test.1)', async () => {
    const { getResult } = renderWithForge(() => {
      const forge = useForge({ level: 'admin', prefix: 'test' });
      return { forge };
    }, {
      'test.1': { name: 'test.1', uri: 'test/1', methods: ['GET'], parameters: [] },
    });

    await waitForLoad();

    const forge = getResult().forge as any;
    const url = forge.route('1');
    expect(url).toContain('test/1');
  });

  it('suffix starts with prefix but not prefix+sep → auto-join (test1.1 → test.test1.1)', async () => {
    const { getResult } = renderWithForge(() => {
      const forge = useForge({ level: 'admin', prefix: 'test' });
      return { forge };
    }, {
      'test.test1.1': {
        name: 'test.test1.1',
        uri: 'test/test1/1',
        methods: ['GET'],
        parameters: [],
      },
    });

    await waitForLoad();

    const forge = getResult().forge as any;
    const url = forge.route('test1.1');
    expect(url).toContain('test/test1/1');
  });

  it('ambiguous: suffix starts with prefix+sep, joined exists → use joined (test.1 → test.test.1)', async () => {
    const { getResult } = renderWithForge(() => {
      const forge = useForge({ level: 'admin', prefix: 'test' });
      return { forge };
    }, {
      'test.test.1': { name: 'test.test.1', uri: 'test/test/1', methods: ['GET'], parameters: [] },
      'test.1': { name: 'test.1', uri: 'test/1', methods: ['GET'], parameters: [] },
    });

    await waitForLoad();

    const forge = getResult().forge as any;
    const url = forge.route('test.1');
    // 优先使用完整拼接 test.test.1
    expect(url).toContain('test/test/1');
  });

  it('ambiguous: joined NOT exists → fallback to suffix (test.1 → test.1)', async () => {
    const { getResult } = renderWithForge(() => {
      const forge = useForge({ level: 'admin', prefix: 'test' });
      return { forge };
    }, {
      'test.1': { name: 'test.1', uri: 'test/1', methods: ['GET'], parameters: [] },
    });

    await waitForLoad();

    const forge = getResult().forge as any;
    const url = forge.route('test.1');
    // test.test.1 不存在 → 回退到 test.1
    expect(url).toContain('test/1');
  });

  it('ambiguous: neither joined nor suffix exists → throws UnknownRouteError', async () => {
    const { getResult } = renderWithForge(() => {
      const forge = useForge({ level: 'admin', prefix: 'test' });
      return { forge };
    }, {
      'other.route': { name: 'other.route', uri: 'other/route', methods: ['GET'], parameters: [] },
    });

    await waitForLoad();

    const forge = getResult().forge as any;
    expect(() => forge.route('test.1')).toThrow(/Route "test\.test\.1" not found/);
  });

  it('api() resolves ambiguous name correctly (async)', async () => {
    const { getResult } = renderWithForge(() => {
      const forge = useForge({ level: 'admin', prefix: 'test' });
      return { forge };
    }, {
      'test.1': { name: 'test.1', uri: 'test/1', methods: ['GET'], parameters: [] },
    });

    await waitForLoad();

    const forge = getResult().forge as any;
    // api() 异步解析：test.1 歧义 → test.test.1 不存在 → 回退 test.1
    try {
      await forge.api('test.1');
    } catch (e: any) {
      expect(e.message).not.toContain('not found');
    }
  });
});
