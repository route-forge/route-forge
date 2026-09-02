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

function makeResp(level: string): LevelRoutesResponse {
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
    cache.set(makeResp('public'), undefined);
    const entry = cache.get('public');
    expect(entry).toBeDefined();
    expect(entry!.level).toBe('public');
    expect(entry!.routes['user.show']).toBeDefined();
  });

  it('entry expires after frontend fallback TTL when backend未下发', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 10 });
    cache.set(makeResp('public'), undefined); // 后端未下发 cache_ttl → 用兜底 10s
    vi.advanceTimersByTime(11_000);
    expect(cache.get('public')).toBeUndefined();
  });

  it('backend cache_ttl is an upper bound: min(backend, fallback)', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 3600 });
    cache.set(makeResp('public'), 5); // 后端 5s < 前端 3600s → 取 5
    const entry = cache.get('public');
    expect(entry!.ttl).toBe(5);
    vi.advanceTimersByTime(6_000);
    expect(cache.get('public')).toBeUndefined();
  });

  it('backend cache_ttl=null（不缓存）内存镜像视为不过期、供 route() 读', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 120 });
    cache.set(makeResp('public'), null);
    const entry = cache.get('public');
    expect(entry).toBeDefined();
    expect(entry!.ttl).toBe(0); // 内存里不过期；不落存储由持久化用例断言
  });

  it('cache_ttl 0 means permanent (never expires)', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 1 });
    cache.set(makeResp('public'), 0);
    vi.advanceTimersByTime(10_000_000);
    expect(cache.get('public')).toBeDefined();
  });

  it('levels are isolated from each other', () => {
    const cache = new RouteCache({ storage: 'memory', ttl: 60 });
    cache.set(makeResp('public'), undefined);
    cache.set(makeResp('admin'), undefined);
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
    cache.set(makeResp('public'), undefined);
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
      cache.set(makeResp('public'), undefined);
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
    expect(() => cache.set(makeResp('public'), undefined)).not.toThrow();
    // 修复点：写入失败回退内存后 get() 仍能读到
    expect(cache.get('public')).toBeDefined();
    expect(cache.get('public')!.routes['user.show']).toBeDefined();
  });

  it('del removes entry from storage backend', () => {
    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    cache.set(makeResp('public'), undefined);
    cache.del('public');
    expect(storage.getItem('route-forge:public')).toBeNull();
    expect(cache.get('public')).toBeUndefined();
  });

  it('clear removes only route-forge: prefixed keys', () => {
    storage.setItem('user:1', 'keep-me');
    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    cache.set(makeResp('public'), undefined);
    cache.set(makeResp('admin'), undefined);
    cache.clear();
    expect(storage.getItem('route-forge:public')).toBeNull();
    expect(storage.getItem('route-forge:admin')).toBeNull();
    expect(storage.getItem('user:1')).toBe('keep-me');
  });
});

describe('RouteCache — storage 模式内存镜像', () => {
  let storage: FakeStorage;
  /** node 的 globalThis 不是 EventTarget：临时挂最小分发器，模拟浏览器 storage 事件 */
  let listeners: ((e: Event) => void)[] = [];

  beforeEach(() => {
    storage = new FakeStorage();
    (globalThis as any).localStorage = storage;
    listeners = [];
    (globalThis as any).addEventListener = (type: string, cb: (e: Event) => void) => {
      if (type === 'storage') listeners.push(cb);
    };
    (globalThis as any).dispatchEvent = (ev: Event) => {
      for (const cb of listeners) cb(ev);
      return true;
    };
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
    delete (globalThis as any).addEventListener;
    delete (globalThis as any).dispatchEvent;
  });

  /** 手动派发 storage 事件（模拟其他 tab 写入） */
  function dispatchStorageEvent(key: string | null): void {
    const ev = new Event('storage') as StorageEvent;
    Object.defineProperty(ev, 'key', { value: key });
    (globalThis as any).dispatchEvent(ev);
  }

  it('second get hits memory mirror — getItem called only once', () => {
    // 预置一条 storage 条目（模拟页面刷新后残留的持久化缓存）
    storage.setItem(
      'route-forge:public',
      JSON.stringify({ level: 'public', routes: makeResp('public').routes, ttl: 60, cachedAt: Date.now() }),
    );
    const getItemSpy = vi.spyOn(storage, 'getItem');

    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    const first = cache.get('public');
    const second = cache.get('public');
    const third = cache.get('public');

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(third).toBe(first);
    // 热路径只允许一次读盘：后续 get 全部命中内存镜像
    expect(getItemSpy).toHaveBeenCalledTimes(1);
  });

  it('set writes memory mirror immediately — subsequent get never reads storage', () => {
    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    cache.set(makeResp('public'), undefined);
    const getItemSpy = vi.spyOn(storage, 'getItem');
    expect(cache.get('public')!.routes['user.show']).toBeDefined();
    expect(cache.get('public')!.routes['user.show']).toBeDefined();
    // 写入方自己的镜像已就位，读盘零次
    expect(getItemSpy).not.toHaveBeenCalled();
  });

  it('storage event from another tab invalidates the mirror', () => {
    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    cache.set(makeResp('public'), undefined);
    expect(cache.get('public')).toBeDefined();

    // 其他 tab 删除该条目（storage 数据与镜像同步消失）→ get 返回 undefined
    storage.removeItem('route-forge:public');
    dispatchStorageEvent('route-forge:public');
    expect(cache.get('public')).toBeUndefined();

    // 其他 tab 写入新版本 → 镜像失效 → 下次 get 重新读盘拿到新数据
    const fresh = {
      level: 'public',
      routes: { 'v2.route': { name: 'v2.route', uri: 'v2', methods: ['GET'], parameters: [] } },
      ttl: 60,
      cachedAt: Date.now(),
    };
    storage.setItem('route-forge:public', JSON.stringify(fresh));
    dispatchStorageEvent('route-forge:public');
    expect(cache.get('public')!.routes['v2.route']).toBeDefined();
  });

  it('storage event with non-route-forge key or null key does not touch the mirror', () => {
    const cache = new RouteCache({ storage: 'localStorage', ttl: 60 });
    cache.set(makeResp('public'), undefined);
    dispatchStorageEvent('other-app:key');
    dispatchStorageEvent(null);
    expect(cache.get('public')).toBeDefined();
  });

  it('mirror still expires by TTL — no stale data served from memory', () => {
    vi.useFakeTimers();
    try {
      const cache = new RouteCache({ storage: 'localStorage', ttl: 5 });
      cache.set(makeResp('public'), undefined);
      vi.advanceTimersByTime(6_000);
      // TTL 检查在内存路径内执行：镜像中的过期条目同样被剔除
      expect(cache.get('public')).toBeUndefined();
      expect(storage.getItem('route-forge:public')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RouteCache — storage unavailable fallback', () => {
  it('falls back to memory when requested storage missing in host', () => {
    // node 环境默认无 sessionStorage → pickStorage 返回 null → 走内存
    delete (globalThis as any).sessionStorage;
    const cache = new RouteCache({ storage: 'sessionStorage', ttl: 60 });
    cache.set(makeResp('public'), undefined);
    expect(cache.get('public')).toBeDefined();
    cache.clear();
    expect(cache.get('public')).toBeUndefined();
  });
});

describe('RouteCache — sessionStorage write path (L9)', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
    (globalThis as any).sessionStorage = storage;
  });
  afterEach(() => {
    delete (globalThis as any).sessionStorage;
  });

  it('writes to sessionStorage with route-forge: prefix and respects TTL', () => {
    vi.useFakeTimers();
    try {
      const cache = new RouteCache({ storage: 'sessionStorage', ttl: 30 });
      cache.set(makeResp('public'), undefined);
      // 序列化条目带 route-forge: 前缀
      const raw = storage.getItem('route-forge:public');
      expect(raw).not.toBeNull();
      const entry = JSON.parse(raw!);
      expect(entry.level).toBe('public');
      expect(entry.ttl).toBe(30);
      // TTL 内可读
      expect(cache.get('public')).toBeDefined();
      // TTL 过期后读取即清除
      vi.setSystemTime(Date.now() + 31_000);
      expect(cache.get('public')).toBeUndefined();
      expect(storage.getItem('route-forge:public')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
