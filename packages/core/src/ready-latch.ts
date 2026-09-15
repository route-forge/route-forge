/**
 * ready() 门闩：封装 ready Promise 的构造、resolve/reject、isReady 同步标记，
 * 以及「无人订阅时防 unhandled rejection」的两个兜底 catch。
 *
 * 语义（从 createRouteForge 抽出，逐字保留）：
 * - 成功 resolve 后 isReady() 才为 true；reject 不算就绪（保持 false）。
 * - 原始 readyPromise 挂一个吞掉的 catch，防无人调用 ready() 时冒泡 unhandled rejection；
 *   isSettledOk 跟踪另挂 then 的两个分支，reject 分支就地消化避免衍生 promise 再次 unhandled。
 * - ready() 有回调形态时仍返回 Promise<this>，resolve 值为门闩持有的实例本身。
 */

export interface ReadyLatch<T> {
  /** 供内部串联：discovery/eager 完成后 resolve、失败时 reject */
  resolve(value: T): void;
  reject(reason?: unknown): void;
  /** ready() 是否已成功 resolve（同步查询） */
  isReady(): boolean;
  /** 对外 ready() 门面（无参返回 Promise；有参走 then/catch 仍返回 Promise<T>） */
  ready(): Promise<T>;
  ready(onFulfilled: (value: T) => void, onRejected?: (error: unknown) => void): Promise<T>;
}

export function createReadyLatch<T>(): ReadyLatch<T> {
  let resolveReady!: (value: T) => void;
  let rejectReady!: (reason?: unknown) => void;
  const readyPromise = new Promise<T>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // 记录成功 resolve 的值：ready() 回调模式末段映射回该值（等价旧行为——resolve 为实例本身）
  let settledValue: T | undefined;
  // 无人调用 ready() 时防 unhandled rejection；不改变 reject 语义，订阅者仍能收到错误
  readyPromise.catch(() => {});
  // 就绪标记（isReady 同步查询用）：仅成功 resolve 后置 true；reject 不算就绪。
  // onRejected 必须就地消化——否则衍生 promise 在 reject 时成为 unhandled rejection
  let readySettledOk = false;
  readyPromise.then(
    (value) => {
      settledValue = value;
      readySettledOk = true;
    },
    () => {
      /* reject 不算就绪；原始错误由 readyPromise.catch 兜底，订阅者仍能收到 */
    },
  );

  function ready(
    onFulfilled?: (value: T) => void,
    onRejected?: (error: unknown) => void,
  ): Promise<T> {
    if (onFulfilled) {
      // 回调内部走 then/catch；末段映射回门闩持有的实例（即便 onRejected 已消化错误也解析为值，
      // 绝不回返 readyPromise——否则会在 reject 时重新采纳 rejection，产生无人处理的 unhandled rejection）
      return readyPromise.then(onFulfilled, onRejected).then(() => settledValue as T);
    }
    return readyPromise;
  }

  return {
    resolve: (value) => resolveReady(value),
    reject: (reason) => rejectReady(reason),
    isReady: () => readySettledOk,
    ready: ready as ReadyLatch<T>['ready'],
  };
}
