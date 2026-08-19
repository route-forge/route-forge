/**
 * 把宿主项目的 axios 实例包装为 Fetcher adapter
 * @see .docs/SPEC.md §4.3.2, §4.3.4
 *
 * 设计约定：
 * - 不接管或修改宿主 axios 已有拦截器/defaults 配置，仅调用其 request 入口
 * - 宿主 axios 的 defaults.baseURL/defaults.headers 自动生效
 * - 宿主已注册的拦截器会先执行；Route Forge 自身拦截器在宿主拦截器之后执行
 *   （由 forge.interceptors 注入到宿主 axios 时序）后续阶段填充
 * - 未检测到 axios 时返回 null（让 'auto' 自动降级到 builtin）
 */

import type { RequestConfig, ResponseData } from '../types.js';
import type { ResolvedAdapter } from './index.js';

export async function wrapAxiosAdapter(): Promise<ResolvedAdapter | null> {
  // ESM 友好的动态探测：尝试 import('axios')，失败则查全局 window.axios
  let axios: any;
  try {
    const mod = await import(/* @vite-ignore */ 'axios');
    axios = mod.default ?? mod;
  } catch {
    if (typeof globalThis !== 'undefined' && (globalThis as any).axios) {
      axios = (globalThis as any).axios;
    }
  }
  if (!axios || typeof axios.request !== 'function') return null;

  async function request(config: RequestConfig): Promise<ResponseData> {
    const headers: Record<string, string> = { ...config.headers };
    const res = await axios.request({
      url: config.url,
      method: config.method,
      headers,
      data: config.body,
      // axios 会处理 baseURL/transformRequest 等 defaults
    });

    return {
      route: config.route,
      level: config.level,
      method: config.method,
      url: config.url,
      status: res.status,
      headers: new Headers(res.headers ?? {}),
      data: res.data,
      config,
    };
  }

  // 不暴露宿主 axios 的 interceptors manager（避免覆盖 Route Forge 的统一时序）；
  // Route Forge 调用链由 forge.interceptors 控制，宿主拦截器先执行由 axios 内部保证。
  return { request, interceptors: undefined };
}
