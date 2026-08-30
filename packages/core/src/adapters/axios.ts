/**
 * 把宿主项目的 axios 实例包装为 Fetcher adapter
 * @see .docs/SPEC.md §4.3.2, §4.3.4
 *
 * 设计约定：
 * - 不接管或修改宿主 axios 已有拦截器/defaults 配置，仅调用其 request 入口
 * - 宿主 axios 的 defaults.baseURL/defaults.headers 自动生效
 * - 宿主已注册的拦截器会先执行；Route Forge 自身拦截器在宿主拦截器之后执行
 * - 未检测到 axios 时返回 null（让 'auto' 自动降级到 builtin）
 */

import type { RequestConfig, ResponseData } from '../types.js';
import type { ResolvedAdapter } from './index.js';

/** 把 axios 响应头（可能是 AxiosHeaders 实例）安全转为标准 Headers */
function toHeaders(raw: unknown): Headers {
  if (!raw) return new Headers();
  const init =
    typeof (raw as any).toJSON === 'function' ? (raw as any).toJSON() : raw;
  try {
    return new Headers(init);
  } catch {
    return new Headers();
  }
}

export async function wrapAxiosAdapter(): Promise<ResolvedAdapter | null> {
  // ESM 友好的动态探测：尝试 import('axios')，失败则查全局 window.axios
  // 使用变量引用模块名，避免打包工具（rollup/esbuild）静态分析并打包 axios
  let axios: any;
  const axiosModule = 'axios';
  try {
    const mod = await import(/* @vite-ignore */ axiosModule);
    axios = mod.default ?? mod;
  } catch {
    if (typeof globalThis !== 'undefined' && (globalThis as any).axios) {
      axios = (globalThis as any).axios;
    }
  }
  if (!axios || typeof axios.request !== 'function') return null;

  async function request(config: RequestConfig): Promise<ResponseData> {
    const headers: Record<string, string> = { ...config.headers };
    try {
      const res = await axios.request({
        url: config.url,
        method: config.method,
        headers,
        data: config.body,
        // axios 会处理 baseURL/transformRequest 等 defaults；timeout 透传保证超时语义与 builtin 一致
        timeout: config.timeout,
        signal: config.signal,  // 请求取消信号（AbortSignal）
      });

      return {
        route: config.route,
        level: config.level,
        method: config.method,
        url: config.url,
        status: res.status,
        headers: toHeaders(res.headers),
        data: res.data,
        config,
      };
    } catch (e: any) {
      // axios 默认 validateStatus 对非 2xx 抛错：携带响应时转为 ResponseData 返回，
      // 由上层统一转 HTTPError 并触发响应拦截器 onRejected 链（与 builtin 行为一致）；
      // 无响应（网络错误/超时）则原样重抛，由上层转 NetworkError。
      if (e && e.response) {
        const resp = e.response;
        return {
          route: config.route,
          level: config.level,
          method: config.method,
          url: config.url,
          status: resp.status,
          headers: toHeaders(resp.headers),
          data: resp.data,
          config,
        };
      }
      throw e;
    }
  }

  // 不暴露宿主 axios 的 interceptors manager（避免覆盖 Route Forge 的统一时序）；
  // Route Forge 调用链由 forge.interceptors 控制，宿主拦截器先执行由 axios 内部保证。
  return { request, interceptors: undefined };
}
