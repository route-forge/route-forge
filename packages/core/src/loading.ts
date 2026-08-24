/**
 * LoadingTracker：加载中标识状态管理
 *
 * 通过引用计数器跟踪并发请求数。
 * - start()：计数器 +1，进入加载状态
 * - stop()：计数器 -1，归零时退出加载状态
 * - isLoading()：查询当前是否处于加载中
 * - subscribe(cb)：监听状态变化，返回取消订阅函数
 *
 * @see .docs/SPEC.md §4.1.8
 */

/** 状态变更回调签名 */
export type LoadingChangeCallback = (event: LoadingChangeEvent) => void;

/** 状态变更事件 */
export interface LoadingChangeEvent {
  /** 当前是否仍处于加载中 */
  loading: boolean;
  /** 当前并发请求数 */
  count: number;
}

/**
 * 加载状态跟踪器
 *
 * 单一计数器，跟踪所有 API 请求的并发数。
 * 不绑定任何 UI 样式，仅提供状态供框架层或业务层消费。
 */
export class LoadingTracker {
  /** 当前并发请求计数 */
  private count = 0;
  /** 订阅者集合 */
  private subscribers = new Set<LoadingChangeCallback>();

  /**
   * 开始一次加载（计数器 +1）
   */
  start(): void {
    this.count++;
    this.notify();
  }

  /**
   * 结束一次加载（计数器 -1）
   */
  stop(): void {
    this.count = Math.max(0, this.count - 1);
    this.notify();
  }

  /**
   * 查询当前是否处于加载中
   */
  isLoading(): boolean {
    return this.count > 0;
  }

  /**
   * 获取当前并发计数
   */
  getCount(): number {
    return this.count;
  }

  /**
   * 订阅加载状态变更
   * @returns 取消订阅函数
   */
  subscribe(cb: LoadingChangeCallback): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** 通知所有订阅者 */
  private notify(): void {
    const event: LoadingChangeEvent = {
      loading: this.count > 0,
      count: this.count,
    };
    for (const cb of this.subscribers) {
      try {
        cb(event);
      } catch {
        // 订阅者回调异常不影响其他订阅者及请求流程
      }
    }
  }
}
