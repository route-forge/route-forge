/**
 * RouteChangeTracker：路由表数据变更订阅（供框架层在缓存刷新后重算响应式 URL）
 *
 * 与 LoadingTracker（跟踪在途请求数）正交：本跟踪器表达的是「某层级的路由元信息内容已变化」
 * ——发生在层级数据成功写入缓存（首次 load / revalidate）或失效（invalidate）之后。
 *
 * - notify(level)：广播某层级数据已变更（带 level，订阅者按自身绑定的 level 过滤，避免全量重渲染）
 * - subscribe(cb)：订阅变更，返回取消订阅函数
 *
 * @see .docs/SPEC.md §4.1.8
 */

/** 路由表数据变更回调签名；level 为发生变化的层级 */
export type RouteChangeCallback = (level: string) => void;

/**
 * 路由数据变更广播器：微任务合批投递，避免同一 tick 内多次变更（invalidate-all、并发 load）
 * 触发同步惊群，并把订阅者回调移出 cache.write 的关键路径。
 */
export class RouteChangeTracker {
  private readonly subscribers = new Set<RouteChangeCallback>();
  /** 本微任务周期内累积的变更层级（去重） */
  private readonly pending = new Set<string>();
  /** 是否已排定一次微任务 flush */
  private scheduled = false;

  /** 订阅路由表数据变更；返回取消订阅函数 */
  subscribe(cb: RouteChangeCallback): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** 记录某层级数据已变更；同一 tick 多次调用合并为一次投递（每层级各投一次） */
  notify(level: string): void {
    // 无订阅者时完全不排队，省掉微任务与集合开销
    if (this.subscribers.size === 0) return;
    this.pending.add(level);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  /** 一次性投递本周期累积的所有变更层级；单订阅者抛错不影响其它 */
  private flush(): void {
    this.scheduled = false;
    const levels = [...this.pending];
    this.pending.clear();
    for (const level of levels) {
      for (const cb of this.subscribers) {
        try {
          cb(level);
        } catch {
          // 订阅者回调异常不影响其他订阅者及缓存/请求流程
        }
      }
    }
  }
}
