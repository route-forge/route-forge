/**
 * useForgeRoute：响应式 URL 生成器，内部处理 level 加载状态
 * @see .docs/SPEC.md §4.1.7
 *
 * - level 未加载时返回空字符串 ''（不抛错，模板不崩）
 * - level 加载完成后自动更新并返回正确 URL
 * - 路由名不存在或必填参数缺失等渲染期错误：降级为 '' 保证渲染不中断，
 *   同时以醒目的样式化 warn 输出完整错误（含堆栈）——开发期可见，生产无副作用
 * - 用户无需关心 levelLoaded 状态，直接用即可
 */

import { useContext, useEffect, useState } from 'react';
import { ForgeContext } from '../provider.js';

/** 渲染期错误降级输出：橙色加粗标签 + 完整错误对象，控制台一眼可见 */
function warnRenderError(error: unknown): void {
  console.warn(
    '%c[route-forge]%c useForgeRoute 渲染期错误（已降级为空字符串，渲染未中断）',
    'color:#e67e22;font-weight:bold',
    'color:inherit',
    error,
  );
}

export function useForgeRoute(
  level: string,
  name: string,
  params?: Record<string, unknown>,
): string {
  const forge = useContext(ForgeContext);
  if (!forge) {
    throw new Error(
      '[route-forge/react] useForgeRoute() must be used within a <RouteForgeProvider>',
    );
  }

  const [url, setUrl] = useState('');

  useEffect(() => {
    let cancelled = false;

    if (!forge.isLoaded(level)) {
      forge.load(level).then(() => {
        if (!cancelled) {
          try {
            setUrl(forge.route(level, name, params));
          } catch (e) {
            warnRenderError(e);
            setUrl('');
          }
        }
      }).catch(() => {
        if (!cancelled) setUrl('');
      });
    } else {
      try {
        setUrl(forge.route(level, name, params));
      } catch (e) {
        warnRenderError(e);
        setUrl('');
      }
    }

    return () => {
      cancelled = true;
    };
  }, [forge, level, name, params]);

  return url;
}
