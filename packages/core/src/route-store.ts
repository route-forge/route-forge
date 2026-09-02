/**
 * 层级路由元信息的存储与加载（SPEC §4.1.2 / §4.1.4）。
 *
 * 封装按层级懒加载所需的可变状态：
 *   - RouteCache（懒加载缓存）
 *   - inflight（并发去重）
 *   - invalidationGens（失效代数，防止 invalidate 后旧数据回写）
 * 并在此之上实现 fetchLevel / loadOne / load / invalidate / isLoaded
 * 以及缓存读取（findRouteMeta / getRoutes）与虚拟 unassigned 层级构建。
 *
 * 依赖通过构造参数注入：DiscoveryState 与自动发现错误均按引用 / getter
 * 实时读取，避免快照冻结自动发现回填结果；fetchMeta 为工厂提供的元信息传输通道。
 */

import { RouteCache } from './cache.js';
import { UnknownLevelError } from './errors.js';
import { buildUrl } from './url-builder.js';
import { type DiscoveryState, type MetaFetcher } from './auto-discovery.js';
import type { LevelRoutesResponse, RouteMeta } from './types.js';

export interface RouteStoreDeps {
  cache: RouteCache;
  state: DiscoveryState;
  baseURL: string;
  fetchMeta: MetaFetcher;
  /** 自动发现完成 Promise（load 前 await） */
  autoDiscoveryPromise: Promise<void>;
  /** 自动发现错误读取器（loadOne 起始处重抛，保留原始错误） */
  getAutoDiscoveryError: () => unknown;
}

export class RouteStore {
  private readonly cache: RouteCache;
  private readonly state: DiscoveryState;
  private readonly baseURL: string;
  private readonly fetchMeta: MetaFetcher;
  private readonly autoDiscoveryPromise: Promise<void>;
  private readonly getAutoDiscoveryError: () => unknown;

  private readonly inflight = new Map<string, Promise<void>>();
  /** 每个层级的失效代数，用于检测 loadOne 期间是否发生了 invalidate */
  private readonly invalidationGens = new Map<string, number>();

  constructor(deps: RouteStoreDeps) {
    this.cache = deps.cache;
    this.state = deps.state;
    this.baseURL = deps.baseURL;
    this.fetchMeta = deps.fetchMeta;
    this.autoDiscoveryPromise = deps.autoDiscoveryPromise;
    this.getAutoDiscoveryError = deps.getAutoDiscoveryError;
  }

  assertLevelDeclared(level: string): void {
    if (!this.state.levels.includes(level)) {
      throw new UnknownLevelError(level);
    }
  }

  private async fetchLevel(level: string): Promise<LevelRoutesResponse> {
    // 层级明细端点优先用摘要自描述的 route.uri（baseURL + uri）；缺省时兜底 endpoint_prefix 拼接
    const uri = this.state.levelRoutes[level]?.uri;
    const url = uri
      ? this.joinBaseAndPath(this.baseURL, uri)
      : buildUrl(level, { baseURL: this.baseURL, endpoint: this.state.endpoint });
    return (await this.fetchMeta(`route-forge.${level}`, url, level)) as LevelRoutesResponse;
  }

  /** baseURL 与后端下发的绝对 path 拼接（规范化斜杠），与 buildUrl 的 base 处理一致 */
  private joinBaseAndPath(baseURL: string, path: string): string {
    const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }

  async loadOne(level: string): Promise<void> {
    const autoDiscoveryError = this.getAutoDiscoveryError();
    if (autoDiscoveryError) throw autoDiscoveryError;
    this.assertLevelDeclared(level);

    // cacheTtl===null（后端声明"不缓存"）→ 跳过缓存命中短路，每次 load 重新拉取；否则命中即返回
    const noCache = this.state.cacheTtl === null;
    if (!noCache && this.cache.get(level)) return;

    // inflight 去重
    const existing = this.inflight.get(level);
    if (existing) return existing;

    const gen = this.invalidationGens.get(level) ?? 0;
    const p = (async () => {
      try {
        // unassigned 是摘要中的真实层级，与其它层级完全一致地按 route.uri 走 HTTP 懒加载（SPEC §3.1.6）
        const resp = await this.fetchLevel(level);
        // 仅在缓存未被 invalidate 清除时写入，防止旧数据回写
        if ((this.invalidationGens.get(level) ?? 0) === gen) {
          this.cache.set(resp, this.state.cacheTtl);
        }
      } finally {
        this.inflight.delete(level);
      }
    })();
    this.inflight.set(level, p);
    return p;
  }

  async load(level: string | string[]): Promise<void> {
    await this.autoDiscoveryPromise;
    const list = Array.isArray(level) ? level : [level];
    await Promise.all(list.map((l) => this.loadOne(l)));
  }

  invalidate(level?: string | string[]): void {
    if (level === undefined) {
      this.cache.clear();
      // 清除所有进行中的加载，防止旧数据回写
      this.inflight.clear();
      for (const lvl of this.state.levels) {
        this.invalidationGens.set(lvl, (this.invalidationGens.get(lvl) ?? 0) + 1);
      }
    } else if (Array.isArray(level)) {
      for (const lvl of level) {
        this.cache.del(lvl);
        this.inflight.delete(lvl);
        this.invalidationGens.set(lvl, (this.invalidationGens.get(lvl) ?? 0) + 1);
      }
    } else {
      this.cache.del(level);
      this.inflight.delete(level);
      this.invalidationGens.set(level, (this.invalidationGens.get(level) ?? 0) + 1);
    }
  }

  isLoaded(level?: string): boolean {
    if (level) return this.cache.get(level) !== undefined;
    // 无任何已声明层级（如自动发现未完成）时不应谎报全部已加载
    return this.state.levels.length > 0 && this.state.levels.every((lvl) => this.cache.get(lvl) !== undefined);
  }

  findRouteMeta(level: string, name: string): RouteMeta | undefined {
    const entry = this.cache.get(level);
    const meta = entry?.routes[name];
    if (meta) {
      return { ...meta, level };
    }
    return undefined;
  }

  getRoutes(level: string): Record<string, RouteMeta>;
  getRoutes(): Record<string, Record<string, RouteMeta>>;
  getRoutes(level?: string): Record<string, RouteMeta> | Record<string, Record<string, RouteMeta>> {
    if (level !== undefined) {
      const entry = this.cache.get(level);
      const routes = entry?.routes ?? {};
      const result: Record<string, RouteMeta> = {};
      for (const [k, v] of Object.entries(routes)) {
        // 深拷贝：避免嵌套对象（如 parameter_defaults）与内部缓存共享引用
        result[k] = JSON.parse(JSON.stringify(v));
      }
      return result;
    }
    const result: Record<string, Record<string, RouteMeta>> = {};
    for (const lvl of this.state.levels) {
      const entry = this.cache.get(lvl);
      if (entry) {
        const levelRoutes: Record<string, RouteMeta> = {};
        for (const [k, v] of Object.entries(entry.routes)) {
          // 深拷贝：避免嵌套对象（如 parameter_defaults）与内部缓存共享引用
          levelRoutes[k] = JSON.parse(JSON.stringify(v));
        }
        result[lvl] = levelRoutes;
      }
    }
    return result;
  }
}
