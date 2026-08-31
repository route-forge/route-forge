/**
 * 绑定层级的 BoundForge 构造（SPEC §4.1.6 use(level, prefix)）。
 *
 * 由工厂注入层级维度的操作（load/api/route/hasRoute/getRoutes/invalidate/isLoaded）
 * 与加载跟踪器，构造出一个「可作为函数调用（api 语法糖）+ 携带命名方法」的 BoundForge，
 * 并挂载 onLevelLoaded / useRoutePrefix 两个需要闭包引用的方法。
 */

import { resolveRouteName, resolveRouteNameSync, type RouteResolver } from './resolveRouteName.js';
import { defineImmutableProps } from './defineImmutableProps.js';
import type { LoadingTracker, LoadingChangeCallback } from './loading.js';
import type { ApiCallParams, BoundForge, RouteMeta } from './types.js';

export interface BoundForgeDeps {
  load: (level: string | string[]) => Promise<void>;
  api: (level: string, name: string, params?: ApiCallParams) => unknown;
  route: (level: string, name: string, params?: Record<string, unknown>) => string;
  hasRoute: (level: string, name: string) => boolean;
  getRoutes: (level: string) => Record<string, RouteMeta>;
  invalidate: (level: string | string[]) => void;
  isLoaded: (level: string) => boolean;
  loadingTracker: LoadingTracker;
}

/** 创建 (level, prefix?) => BoundForge 的构造函数（对应 forge.use 的绑定层级分支）。 */
export function createBoundForgeFactory(deps: BoundForgeDeps): (
  level: string,
  prefix?: string,
) => BoundForge {
  const { load, api, route, hasRoute, getRoutes, invalidate, isLoaded, loadingTracker } = deps;

  // RouteResolver 接口实现（供 resolveRouteName/resolveRouteNameSync 使用）
  const resolver: RouteResolver = { load, hasRoute };

  function createBoundForge(level: string, prefix?: string): BoundForge {
    // 自动触发 level 加载；失败时 levelLoaded 保持 reject 语义
    //（onLevelLoaded 的 onRejected 依赖它；框架层各自在 catch 中保持未加载状态）
    const levelLoadedPromise = load(level);
    // 附加空 catch 防止无人订阅时的 unhandled rejection（不改变原 Promise 的 reject 状态）
    levelLoadedPromise.catch(() => {});

    const apiFn = prefix
      ? (name: string, params?: ApiCallParams) =>
        resolveRouteName(resolver, level, prefix, name).then(
          (resolved) => api(level, resolved, params),
        )
      : (name: string, params?: ApiCallParams) =>
        api(level, name, params);

    const callable = apiFn as unknown as BoundForge;
    defineImmutableProps(callable, {
      level,
      ...(prefix !== undefined ? { prefix } : {}),
      api: apiFn,
      route: prefix
        ? (name: string, params?: Record<string, unknown>) =>
          route(level, resolveRouteNameSync(resolver, level, prefix, name), params)
        : (name: string, params?: Record<string, unknown>) =>
          route(level, name, params),
      url: prefix
        ? (name: string, params?: Record<string, unknown>) =>
          route(level, resolveRouteNameSync(resolver, level, prefix, name), params)
        : (name: string, params?: Record<string, unknown>) =>
          route(level, name, params),
      hasRoute: (name: string) => hasRoute(level, name),
      getRoutes: () => getRoutes(level),
      load: () => load(level),
      invalidate: () => invalidate(level),
      isLoaded: () => isLoaded(level),
      isLoading: () => loadingTracker.isLoading(),
      onLoadingChange: (cb: LoadingChangeCallback) => loadingTracker.subscribe(cb),
    });
    // levelLoaded 单独挂载为 configurable: true，允许框架适配层（Vue/React）覆盖
    Object.defineProperty(callable, 'levelLoaded', {
      value: levelLoadedPromise,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    return callable;
  }

  // BoundForge.onLevelLoaded() 实现
  function boundOnLevelLoaded(
    bound: BoundForge,
    levelLoadedPromise: Promise<void>,
    onFulfilled?: (bound: BoundForge) => void,
    onRejected?: (error: unknown) => void,
  ): Promise<BoundForge> {
    const p = levelLoadedPromise.then(() => bound);
    if (onFulfilled) {
      return p.then(onFulfilled, onRejected).then(() => bound);
    }
    return p;
  }

  // 为 BoundForge 挂载 onLevelLoaded 和 useRoutePrefix
  // （这两个方法需要闭包引用，不能通过 defineImmutableProps 冻结对象值）
  function attachBoundMethods(bound: BoundForge, levelLoadedPromise: Promise<void>, level: string): void {
    Object.defineProperty(bound, 'onLevelLoaded', {
      value: (
        onFulfilled?: (bound: BoundForge) => void,
        onRejected?: (error: unknown) => void,
      ) => boundOnLevelLoaded(bound, levelLoadedPromise, onFulfilled, onRejected),
      writable: false,
      enumerable: false,
      configurable: false,
    });
    Object.defineProperty(bound, 'useRoutePrefix', {
      value: (prefix: string) => createBoundForgeWithMethods(level, prefix),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  function createBoundForgeWithMethods(level: string, prefix?: string): BoundForge {
    const bound = createBoundForge(level, prefix);
    const levelLoadedPromise = bound.levelLoaded as Promise<void>;
    attachBoundMethods(bound, levelLoadedPromise, level);
    return bound;
  }

  return createBoundForgeWithMethods;
}
