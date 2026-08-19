/**
 * Adapter 入口
 * @see .docs/SPEC.md §4.3
 *
 * Route Forge 提供三种 adapter：
 *   1. 'auto'（默认）：检测到宿主 axios 则用之；否则用内置 builtin adapter
 *   2. 'axios'：强制宿主 axios，未安装抛 AdapterNotFoundError
 *   3. 'builtin'：强制内置实现
 * 自定义 Fetcher 接口直接传入即可（绕过 auto 检测）。
 */

import type { Fetcher, RequestConfig, ResponseData } from '../types.js';
import { AdapterNotFoundError } from '../errors.js';
import { createBuiltinHttp } from './builtin-http.js';
import { wrapAxiosAdapter } from './axios.js';

export type ResolvedAdapter = {
  request: (config: RequestConfig) => Promise<ResponseData>;
  interceptors?: Fetcher['interceptors'];
};

export interface ResolveAdapterOptions {
  adapter: 'auto' | 'axios' | 'builtin' | Fetcher;
}

/**
 * 解析 adapter 配置；同步阶段尝试 import('axios')，失败则降级。
 * 注意：实际 axios 探测在生产实现里需要 lazy import；此处仅为框架占位。
 */
export async function resolveAdapter(opts: ResolveAdapterOptions): Promise<ResolvedAdapter> {
  const { adapter } = opts;

  if (adapter && typeof adapter === 'object') {
    return {
      request: (config: RequestConfig) => adapter.request(config),
      interceptors: adapter.interceptors,
    };
  }

  if (adapter === 'builtin') {
    return createBuiltinHttp();
  }

  if (adapter === 'axios') {
    const wrapped = await wrapAxiosAdapter();
    if (!wrapped) throw new AdapterNotFoundError('axios');
    return wrapped;
  }

  // auto: 优先尝试 axios，失败则 builtin
  const wrapped = await wrapAxiosAdapter().catch(() => null);
  if (wrapped) return wrapped;
  return createBuiltinHttp();
}
