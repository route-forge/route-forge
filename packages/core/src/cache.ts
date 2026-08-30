/**
 * 按层级隔离的路由表缓存
 * @see .docs/SPEC.md §4.1.2
 *
 * 规则：
 * - 每层级独立条目，互不污染（cache key = `route-forge:${level}`）
 * - TTL 优先用后端响应里的 cache 字段，本地 cache.ttl 仅作兜底
 * - storage: 'memory' | 'sessionStorage' | 'localStorage'
 * - storage 模式下维护内存镜像：首次读盘解析后驻留内存，后续 get 直接命中
 *   （读盘 + JSON.parse 整层路由表是同步阻塞操作，热路径重复执行代价高）；
 *   写操作（set/del/clear）同步更新镜像，并通过 storage 事件感知其他
 *   tab 的写入/失效，保证跨 tab 新鲜度与无镜像时一致
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
  /** 其他 tab 修改 storage 时失效对应镜像（storage 事件：自己的写不触发，自己的写经 set/del 已同步） */
  private readonly onStorageEvent = (e: StorageEvent): void => {
    if (!e.key) return; // key 为 null 表示 clear() 清空了整个 storage
    if (!e.key.startsWith(KEY_PREFIX)) return;
    // 去掉前缀得到 level（key 构造无 encode，反向切片即可）
    this.memory.delete(e.key.slice(KEY_PREFIX.length));
  };

  constructor(opts: { storage: CacheStorage; ttl: number }) {
    this.storage = opts.storage;
    this.fallbackTtl = opts.ttl;
    this.backend = pickStorage(opts.storage);
    // 仅 storage 模式需要监听跨 tab 变更；typeof 防御 SSR/非浏览器环境
    if (this.backend && typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('storage', this.onStorageEvent);
    }
  }

  private key(level: string): string {
    return `${KEY_PREFIX}${level}`;
  }

  get(level: string): CacheEntry | undefined {
    if (this.storage === 'memory' || !this.backend) {
      return this.getFromMemory(level);
    }
    // 1. 内存镜像优先：命中则免读盘+解析（getFromMemory 内含 TTL 检查，过期自动剔除）
    const mirrored = this.getFromMemory(level);
    if (mirrored) return mirrored;
    // 2. 镜像 miss（首次读取 / TTL 过期 / 跨 tab 失效后）→ 读盘解析
    const raw = this.backend.getItem(this.key(level));
    if (raw) {
      try {
        const entry = JSON.parse(raw) as CacheEntry;
        if (this.isExpired(entry)) {
          this.del(level);
          return undefined;
        }
        // 3. 写入镜像，后续 get 直接走内存
        this.memory.set(level, entry);
        return entry;
      } catch {
        return undefined;
      }
    }
    return undefined;
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
    // SPEC §5.3：后端 cache 为上限，前端可缩短但不能延长
    let ttl: number | null;
    if (resp.cache !== undefined && resp.cache !== null) {
      // 后端有值：取 min(后端, 前端兜底)，确保前端不能延长后端设定的 TTL
      ttl = resp.cache > 0 ? Math.min(resp.cache, this.fallbackTtl) : resp.cache;
    } else {
      // 后端未下发：使用前端兜底 TTL
      ttl = this.fallbackTtl;
    }
    const entry: CacheEntry = {
      level: resp.level,
      routes: resp.routes,
      ttl,
      cachedAt: Date.now(),
    };
    // 无条件先写内存镜像：写入方自己立刻享受内存命中（不再每次 get 重新读盘解析）
    this.memory.set(resp.level, entry);
    if (this.storage === 'memory' || !this.backend) {
      return;
    }
    try {
      this.backend.setItem(this.key(resp.level), JSON.stringify(entry));
    } catch {
      // 容量满或被禁用：镜像已写入，backend 跳过（读取路径仍可命中内存）
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
