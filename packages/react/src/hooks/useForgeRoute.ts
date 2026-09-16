/**
 * useForgeRoute：响应式 URL 生成器，内部处理 level 加载状态
 * @see .docs/SPEC.md §4.1.7
 *
 * - level 未加载时返回空字符串 ''（不抛错，模板不崩）
 * - level 已加载时**渲染期同步求值**：首帧即出 URL，无「先空一帧再补渲染」的闪烁
 * - level 加载完成后（effect 中 bump 版本号触发重渲染）自动更新并返回正确 URL
 * - 路由名不存在或必填参数缺失等渲染期错误：降级为 '' 保证渲染不中断；
 *   错误在提交后的 effect 中以醒目的样式化 warn 输出（渲染期静默，避免并发渲染重复打印）
 * - level 为静态层级绑定：本 hook 面向固定层级使用，不支持中途动态切换 level
 *   （需要另一个层级请在别的组件 / 别的 useForgeRoute 调用里分别使用，与 useForge 契约一致）
 * - 用户无需关心 levelLoaded 状态，直接用即可
 *
 * 渲染期只读约定（铁律 5）：forge.route() 为纯缓存读，不含 ref/state 写入，
 * concurrent / StrictMode 双渲染下安全；版本号 state 仅在 effect（渲染提交后）更新。
 */

import { useContext, useEffect, useState } from 'react';
import { ForgeContext } from '../provider.js';
import { reportRenderWarn } from '../degrade.js';

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
  return useForgeRouteState(level, name, params, hooks).href;
}

/** useForgeRoute 的三态内部形态：组件层（ForgeRoute/ForgeLink）用它区分「未加载 / 解析失败」 */
export interface ForgeRouteState {
  /** 生成的 URL；未加载或解析出错时为 '' */
  href: string;
  /** 解析错误（仅 level 已加载且 route() 抛错时非 null；未加载恒为 null） */
  error: unknown;
  /** level 是否已加载（区别「未加载」与「已加载但解析失败」两种空串来源） */
  isLevelLoaded: boolean;
}

export function useForgeRouteState(
  level: string,
  name: string,
  params?: Record<string, unknown>,
  hooks?: ForgeRouteDegradeHooks,
): ForgeRouteState {
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

  // 渲染期同步求值：level 已加载时直接读缓存构建 URL（只读，无副作用）。
  // name / params 变化随下一次渲染即时生效，无需经过 effect 中转。
  const isLevelLoaded = forge.isLoaded(level);
  let href = '';
  let error: unknown = null;
  if (isLevelLoaded) {
    try {
      href = forge.route(level, name, params);
    } catch (e) {
      // 渲染期静默降级为 ''；错误在下方 effect（渲染提交后）报告
      href = '';
      error = e;
    }
  }

  // 版本号：level 加载完成后 bump，驱动重渲染 → 上方同步求值算出 URL。
  // 仅此一个 state，URL 本身不是 state（避免首帧空窗与双份真值）。
  const [version, setVersion] = useState(0);

  // params 依赖序列化：内联对象字面量每次渲染都是新引用，直接进依赖数组会导致
  // effect 每次渲染重跑。以内容（JSON 序列化）为依赖，内容不变则跳过。
  // 注：key 顺序敏感（{a,b} ≠ {b,a}）——多算一次 URL 而非出错，URL 参数场景无害。
  const paramsKey = params === undefined ? '' : JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    if (!forge.isLoaded(level)) {
      // 未加载：发起加载，完成（提交后）bump 版本号触发重渲染。
      // 失败不 bump（避免 effect 重入造成重试循环），URL 维持 ''；
      // 拒绝处理器吞掉 rejection 防止 unhandled（错误已由 store/调用方语义决定）
      forge.load(level).then(() => {
        if (!cancelled) setVersion((v) => v + 1);
      }, () => {
        /* 加载失败：保持 ''，需要重试请手动 load */
      });
      return () => {
        cancelled = true;
      };
    }
    // 已加载：提交后重放一次求值以报告降级错误（渲染期静默、此处一次性输出）
    const p = paramsKey === '' ? undefined : (JSON.parse(paramsKey) as Record<string, unknown>);
    try {
      forge.route(level, name, p);
    } catch (e) {
      if (hooks?.onDegrade) hooks.onDegrade(e);
      else reportRenderWarn(e, forge.warnings);
    }
    return () => {
      cancelled = true;
    };
    // 依赖以 paramsKey（params 的内容序列化）为准，而非 params 引用本身：
    // 内联对象字面量每次渲染都是新引用，直接列 params 会让 effect 每帧重跑。
    // hooks 不进依赖：报告钩子是稳定行为（console 输出），首渲染闭包即可
  }, [forge, level, name, paramsKey, version]);

  // 订阅路由表数据变更：本层级被 revalidate 刷新或 invalidate 后 bump 版本 → 重渲染 → 上方同步求值算出新 URL。
  // 独立 effect，仅 [forge, level] 依赖（订阅/退订各一次），不随 name/params/version 抖动重挂。
  useEffect(() => {
    return forge.onRoutesChange((changed) => {
      if (changed === level) setVersion((v) => v + 1);
    });
  }, [forge, level]);

  return { href, error, isLevelLoaded };
}
