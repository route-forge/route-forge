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

export class RouteChangeTracker {
  private readonly subscribers = new Set<RouteChangeCallback>();

  /** 订阅路由表数据变更；返回取消订阅函数 */
  subscribe(cb: RouteChangeCallback): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** 通知某层级的路由数据已变更 */
  notify(level: string): void {
    for (const cb of this.subscribers) {
      try {
        cb(level);
      } catch {
        // 订阅者回调异常不影响其他订阅者及缓存/请求流程
      }
    }
  }
}
