/**
 * 按层级隔离的路由表缓存
 * @see .docs/SPEC.md §4.1.2
 *
 * 规则：
 * - 每层级独立条目，互不污染（cache key = `route-forge:${level}`）
 * - TTL 优先用后端响应里的 cache 字段，本地 cache.ttl 仅作兜底
 * - storage: 'memory' | 'sessionStorage' | 'localStorage'
 */

import type { CacheStorage, LevelRoutesResponse, RouteMeta } from './types.js';

interface CacheEntry {
  level: string;
  routes: Record<string, RouteMeta>;
  ttl: number | null;
  cachedAt: number;
}

const KEY_PREFIX = 'route-forge:';

function pickStorage(storage: CacheStorage): Storage | null {
  if (storage === 'memory') return null;
  if (typeof globalThis === 'undefined') return null;
  if (storage === 'sessionStorage') {
    return globalThis.sessionStorage ?? null;
  }
  if (storage === 'localStorage') {
    return globalThis.localStorage ?? null;
  }
  return null;
}

export class RouteCache {
  private readonly storage: CacheStorage;
  private readonly fallbackTtl: number;
  private readonly backend: Storage | null;
  private readonly memory = new Map<string, CacheEntry>();

  constructor(opts: { storage: CacheStorage; ttl: number }) {
    this.storage = opts.storage;
    this.fallbackTtl = opts.ttl;
    this.backend = pickStorage(opts.storage);
  }

  private key(level: string): string {
    return `${KEY_PREFIX}${level}`;
  }

  get(level: string): CacheEntry | undefined {
    if (this.storage === 'memory' || !this.backend) {
      return this.getFromMemory(level);
    }
    const raw = this.backend.getItem(this.key(level));
    if (!raw) return undefined;
    try {
      const entry = JSON.parse(raw) as CacheEntry;
      if (this.isExpired(entry)) {
        this.del(level);
        return undefined;
      }
      return entry;
    } catch {
      return undefined;
    }
  }

  private getFromMemory(level: string): CacheEntry | undefined {
    const entry = this.memory.get(level);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.memory.delete(level);
      return undefined;
    }
    return entry;
  }

  set(resp: LevelRoutesResponse): void {
    const ttl = resp.cache !== undefined && resp.cache !== null ? resp.cache : this.fallbackTtl;
    const entry: CacheEntry = {
      level: resp.level,
      routes: resp.routes,
      ttl,
      cachedAt: Date.now(),
    };
    if (this.storage === 'memory' || !this.backend) {
      this.memory.set(resp.level, entry);
      return;
    }
    try {
      this.backend.setItem(this.key(resp.level), JSON.stringify(entry));
    } catch {
      // 容量满或被禁用：回退内存
      this.memory.set(resp.level, entry);
    }
  }

  del(level: string): void {
    this.memory.delete(level);
    if (this.backend) {
      try {
        this.backend.removeItem(this.key(level));
      } catch {
        /* noop */
      }
    }
  }

  clear(): void {
    this.memory.clear();
    if (this.backend) {
      try {
        const toRemove: string[] = [];
        for (let i = 0; i < this.backend.length; i++) {
          const k = this.backend.key(i);
          if (k && k.startsWith(KEY_PREFIX)) toRemove.push(k);
        }
        for (const k of toRemove) this.backend.removeItem(k);
      } catch {
        /* noop */
      }
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    if (entry.ttl === null) return false;
    if (entry.ttl === 0) return false; // 0 表示永久
    return Date.now() - entry.cachedAt > entry.ttl * 1000;
  }
}
