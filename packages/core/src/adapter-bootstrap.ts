/**
 * Adapter 引导：解析配置的 adapter（auto / axios / builtin / 自定义 Fetcher），
 * 惰性 await 并附带「非 AdapterNotFoundError 的初始化失败 → 降级 builtin」的响亮告警。
 *
 * 从 createRouteForge 抽出，隔离初始化时序细节；返回的 ensureAdapter 幂等（只解析一次）。
 */

import { resolveAdapter, type ResolvedAdapter } from './adapters/index.js';
import { AdapterNotFoundError } from './errors.js';
import type { InterceptorManager, RequestConfig, ResponseData, AdapterOption } from './types.js';

export interface AdapterBootstrapDeps {
  adapter: AdapterOption;
  requestInterceptors: InterceptorManager<RequestConfig, RequestConfig>;
  responseInterceptors: InterceptorManager<ResponseData, unknown>;
  /** 非致命警告开关：adapter 显式指定却降级为 builtin 时是否 console.warn */
  warnings: boolean;
}

/** 创建 ensureAdapter()：首次调用 await 解析结果并缓存，后续直接返回。 */
export function createAdapterBootstrap(
  deps: AdapterBootstrapDeps,
): () => Promise<ResolvedAdapter> {
  const { adapter, requestInterceptors, responseInterceptors, warnings } = deps;

  const adapterPromise = resolveAdapter({
    adapter,
    forgeInterceptors: { request: requestInterceptors, response: responseInterceptors },
  });

  let adapterResolved = false;
  let adapterObj: ResolvedAdapter | null = null;

  return async function ensureAdapter(): Promise<ResolvedAdapter> {
    if (!adapterResolved) {
      adapterObj = await adapterPromise.catch((e) => {
        if (e instanceof AdapterNotFoundError) throw e;
        // 其他错误降级到 builtin（避免初始化失败）；
        // 传入 forge 拦截器管理器，确保降级后拦截链语义不变。
        // 降级必须响亮：用户显式指定了 adapter/Fetcher，实际却运行 builtin，静默会掩盖行为差异
        if (warnings) {
          console.warn(
            `[route-forge] adapter initialization failed (${(e as Error)?.message ?? String(e)}); falling back to builtin`,
          );
        }
        return resolveAdapter({
          adapter: 'builtin',
          forgeInterceptors: { request: requestInterceptors, response: responseInterceptors },
        });
      });
      adapterResolved = true;
    }
    return adapterObj!;
  };
}
