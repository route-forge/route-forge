import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRouteForge, UnknownLevelError } from '../src/index.js';
import type { SummaryResponse } from '../src/types.js';

// Helper: 模拟摘要端点响应
function makeSummary(overrides: Partial<SummaryResponse> = {}): SummaryResponse {
  return {
    levels: {
      public: { description: 'public', load: 'lazy', cache: 300, route_count: 2 },
      admin: { description: 'admin', load: 'eager', cache: 60, route_count: 1 },
    },
    config: { strict_mode: false, endpoint_prefix: '/_forge/routes' },
    unassigned: [],
    ...overrides,
  };
}

// Helper: 设置全局 fetch mock
// 注：响应同时提供 json()/text()/headers，兼容摘要端点（用 json）与 builtin adapter（用 text+headers）
function mockSummary(summary: SummaryResponse | null, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (status !== 200) {
      return {
        ok: false,
        status,
        json: async () => ({}),
        text: async () => '',
        headers: new Headers(),
      } as any;
    }
    const body = summary === null ? '{}' : JSON.stringify(summary);
    return {
      ok: true,
      status: 200,
      json: async () => summary,
      text: async () => body,
      headers: new Headers(),
    } as any;
  });
  return calls;
}

describe('createRouteForge auto-discovery', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('auto-discovers levels from summary endpoint', async () => {
    mockSummary(makeSummary());
    const forge = createRouteForge({ endpoint: '/_forge/routes', adapter: 'builtin' });
    // 等待自动发现完成
    await new Promise((r) => setTimeout(r, 0));
    // forge.load('nonexistent') 应抛 UnknownLevelError（不在自动发现的 levels 中）
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(forge.load('nonexistent')).rejects.toThrow();
    warn.mockRestore();
  });

  it('auto-discovers eager from load field', async () => {
    const calls = mockSummary(makeSummary()); // admin 是 eager
    createRouteForge({ endpoint: '/_forge/routes', adapter: 'builtin' });
    await new Promise((r) => setTimeout(r, 50));
    // admin 是 eager，应触发 forge.load('admin') → fetch /_forge/routes/admin
    const adminCalls = calls.filter((c) => c.url.includes('/admin'));
    expect(adminCalls.length).toBeGreaterThan(0);
  });

  it('intersects explicit levels with backend', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary()); // backend has public, admin
    createRouteForge({ endpoint: '/_forge/routes', levels: ['admin', 'foo'], adapter: 'builtin' });
    await new Promise((r) => setTimeout(r, 10));
    // foo 应被剔除并告警
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('foo'));
    warn.mockRestore();
  });

  it('strict_mode backend authoritative cannot relax', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary({ config: { strict_mode: true, endpoint_prefix: '/_forge/routes' } }));
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      strict: false,
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));
    // 告警 strict 被强制为 true
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('strict_mode=true'));
    warn.mockRestore();
  });

  it('strict_mode frontend can tighten', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary({ config: { strict_mode: false, endpoint_prefix: '/_forge/routes' } }));
    createRouteForge({ endpoint: '/_forge/routes', strict: true, adapter: 'builtin' });
    await new Promise((r) => setTimeout(r, 10));
    // 后端 false 前端 true：合法收紧，不告警
    const strictWarns = warn.mock.calls.filter((c) => c[0].includes('strict'));
    expect(strictWarns.length).toBe(0);
    warn.mockRestore();
  });

  it('endpoint conflict uses backend value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(makeSummary({ config: { strict_mode: false, endpoint_prefix: '/_forge/routes' } }));
    createRouteForge({ endpoint: '/api/routes', adapter: 'builtin' });
    await new Promise((r) => setTimeout(r, 10));
    // 应告警 endpoint 不一致
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('endpoint_prefix'));
    warn.mockRestore();
  });

  it('summary fetch failure falls back to explicit levels', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSummary(null, 500); // summary endpoint returns 500
    const forge = createRouteForge({
      endpoint: '/_forge/routes',
      levels: ['public'],
      adapter: 'builtin',
    });
    await new Promise((r) => setTimeout(r, 10));
    // 应告警 summary 不可达
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
    warn.mockRestore();
  });

  it('summary fetch failure without explicit levels throws', async () => {
    mockSummary(null, 500); // summary endpoint returns 500
    // createRouteForge 不传 levels：同步返回不抛
    expect(() => createRouteForge({ endpoint: '/_forge/routes', adapter: 'builtin' })).not.toThrow();
    // 异步等待应 reject
    const forge = createRouteForge({ endpoint: '/_forge/routes', adapter: 'builtin' });
    await expect(forge.load('public')).rejects.toThrow();
  });
});
