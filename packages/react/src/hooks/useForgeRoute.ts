/**
 * useForgeRoute：响应式 URL 生成器，内部处理 level 加载状态
 * @see .docs/SPEC.md §4.1.7
 *
 * - level 未加载时返回空字符串 ''（不抛错，模板不崩）
 * - level 加载完成后自动更新并返回正确 URL
 * - 路由名不存在或必填参数缺失等渲染期错误：降级为 '' 保证渲染不中断，
 *   同时以醒目的样式化 warn 输出完整错误（含堆栈）——开发期可见，生产无副作用
 * - level 为静态层级绑定：本 hook 面向固定层级使用，不支持中途动态切换 level
 *   （需要另一个层级请在别的组件 / 别的 useForgeRoute 调用里分别使用，与 useForge 契约一致）
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

/** 降级报告钩子：组件层（ForgeRoute/ForgeLink）用它把默认 warn 升级为 error，避免双重打印 */
export interface ForgeRouteDegradeHooks {
  onDegrade?: (error: unknown) => void;
}

export function useForgeRoute(
  level: string,
  name: string,
  params?: Record<string, unknown>,
  hooks?: ForgeRouteDegradeHooks,
): string {
  // 运行时守卫：level 必须是静态字符串（防 JS 用户误用静默降级为空链接）
  if (typeof level !== 'string') {
    throw new TypeError(
      '[route-forge/react] useForgeRoute(): level must be a static string — ' +
      'getter form is not supported (levels are deterministic declarations; ' +
      'create another hook call for another level)',
    );
  }

  const forge = useContext(ForgeContext);
  if (!forge) {
    throw new Error(
      '[route-forge/react] useForgeRoute() must be used within a <RouteForgeProvider>',
    );
  }

  const [url, setUrl] = useState('');

  // params 依赖序列化：内联对象字面量每次渲染都是新引用，直接进依赖数组会导致
  // effect 每次渲染重跑。以内容（JSON 序列化）为依赖，内容不变则跳过。
  // 注：key 顺序敏感（{a,b} ≠ {b,a}）——多算一次 URL 而非出错，URL 参数场景无害。
  const paramsKey = params === undefined ? '' : JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    // 从序列化键还原参数：彻底切断对 params 引用的依赖
    const p = paramsKey === '' ? undefined : (JSON.parse(paramsKey) as Record<string, unknown>);

    if (!forge.isLoaded(level)) {
      forge.load(level).then(() => {
        if (!cancelled) {
          try {
            setUrl(forge.route(level, name, p));
          } catch (e) {
            (hooks?.onDegrade ?? warnRenderError)(e);
            setUrl('');
          }
        }
      }).catch(() => {
        if (!cancelled) setUrl('');
      });
    } else {
      try {
        setUrl(forge.route(level, name, p));
      } catch (e) {
        (hooks?.onDegrade ?? warnRenderError)(e);
        setUrl('');
      }
    }

    return () => {
      cancelled = true;
    };
    // 依赖以 paramsKey（params 的内容序列化）为准，而非 params 引用本身：
    // 内联对象字面量每次渲染都是新引用，直接列 params 会让 effect 每帧重跑。
    // hooks 不进依赖：报告钩子是稳定行为（console 输出），首渲染闭包即可
  }, [forge, level, name, paramsKey]);

  return url;
}
