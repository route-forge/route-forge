import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteCache } from '../src/cache.js';
import type { LevelRoutesResponse } from '../src/types.js';

// ─── 内存版 Storage 替身（node 环境无浏览器 storage） ─────────

class FakeStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function makeResp(level: string, cache?: number | null): LevelRoutesResponse {
  return {
    level,
    routes: {
      'user.show': {
        name: 'user.show',
        uri: 'users/{user}',
        methods: ['GET'],
        parameters: ['user'],
      },
    },
    ...(cache !== undefined ? { cache } : {}),
  };
}

describe('RouteCache — memory storage & TTL', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('set/get roundtrip within TTL', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 60 });
    cache.set(makeResp('public'));
    const entry = cache.get('public');
    expect(entry).toBeDefined();
    expect(entry!.level).toBe('public');
    expect(entry!.routes['user.show']).toBeDefined();
  });

  it('entry expires after frontend fallback TTL', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 10 });
    cache.set(makeResp('public')); // 后端未下发 cache → 用兜底 10s
    vi.advanceTimersByTime(11_000);
    expect(cache.get('public')).toBeUndefined();
  });

  it('backend cache is an upper bound: min(backend, fallback)', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 3600 });
    cache.set(makeResp('public', 5)); // 后端 5s < 前端 3600s → 取 5
    const entry = cache.get('public');
    expect(entry!.ttl).toBe(5);
    vi.advanceTimersByTime(6_000);
    expect(cache.get('public')).toBeUndefined();
  });

  it('backend cache null falls back to frontend TTL', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 120 });
    cache.set(makeResp('public', null));
    expect(cache.get('public')!.ttl).toBe(120);
  });

  it('ttl 0 means permanent (never expires)', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 1 });
    cache.set(makeResp('public', 0));
    vi.advanceTimersByTime(10_000_000);
    expect(cache.get('public')).toBeDefined();
  });

  it('levels are isolated from each other', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 60 });
    cache.set(makeResp('public'));
    cache.set(makeResp('admin'));
    cache.del('public');
    expect(cache.get('public')).toBeUndefined();
    expect(cache.get('admin')).toBeDefined();
  });

  it('del on missing level is a no-op', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 60 });
    expect(() => cache.del('nope')).not.toThrow();
  });
});

describe('RouteCache — persistent storage backend', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
    (globalThis as any).localStorage = storage;
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it('writes to localStorage with route-forge: prefix', () => {
    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    cache.set(makeResp('public'));
    expect(storage.getItem('route-forge:public')).not.toBeNull();
    expect(cache.get('public')!.level).toBe('public');
  });

  it('corrupted JSON in storage returns undefined without throwing', () => {
    storage.setItem('route-forge:public', '{not-valid-json');
    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    expect(cache.get('public')).toBeUndefined();
  });

  it('expired entry in storage is removed on read', () => {
    vi.useFakeTimers();
    try {
      const cache = new RouteCache({ storage: 'localStorage', ttl: 5 });
      cache.set(makeResp('public'));
      vi.advanceTimersByTime(6_000);
      expect(cache.get('public')).toBeUndefined();
      expect(storage.getItem('route-forge:public')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('setItem failure (quota) falls back to memory and remains readable', () => {
    // 模拟配额满：setItem 抛错
    const broken = new FakeStorage();
    vi.spyOn(broken, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    (globalThis as any).localStorage = broken;

    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    expect(() => cache.set(makeResp('public'))).not.toThrow();
    // 修复点：写入失败回退内存后 get() 仍能读到
    expect(cache.get('public')).toBeDefined();
    expect(cache.get('public')!.routes['user.show']).toBeDefined();
  });

  it('del removes entry from storage backend', () => {
    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    cache.set(makeResp('public'));
    cache.del('public');
    expect(storage.getItem('route-forge:public')).toBeNull();
    expect(cache.get('public')).toBeUndefined();
  });

  it('clear removes only route-forge: prefixed keys', () => {
    storage.setItem('user:1', 'keep-me');
    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    cache.set(makeResp('public'));
    cache.set(makeResp('admin'));
    cache.clear();
    expect(storage.getItem('route-forge:public')).toBeNull();
    expect(storage.getItem('route-forge:admin')).toBeNull();
    expect(storage.getItem('user:1')).toBe('keep-me');
  });
});

describe('RouteCache — storage unavailable fallback', () => {
  it('falls back to memory when requested storage missing in host', () => {
    // node 环境默认无 sessionStorage → pickStorage 返回 null → 走内存
    delete (globalThis as any).sessionStorage;
    const cache = new RouteCache({ storage: 'sessionStorage', ttl: 60 });
    cache.set(makeResp('public'));
    expect(cache.get('public')).toBeDefined();
    cache.clear();
    expect(cache.get('public')).toBeUndefined();
  });
});
