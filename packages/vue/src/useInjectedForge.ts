/**
 * 内部 helper（非公共 API，不进包入口导出）：inject forge 实例 + 缺失守卫。
 *
 * useForgeRoute / ForgeRoute / ForgeLink 统一走这里，避免裸 `as RouteForge` 强转：
 * 未安装 plugin 时报「怎么修」的指引性错误，而不是
 * `Cannot read properties of undefined (reading 'isLoaded')` 之类的晦涩堆栈。
 */

import { inject } from 'vue';
import { FORGE_INJECTION_KEY } from './plugin.js';
import type { RouteForge } from '@route-forge/core';

export function useInjectedForge(apiName: string): RouteForge {
  const forge = inject(FORGE_INJECTION_KEY);
  if (!forge) {
    throw new Error(
      `[route-forge/vue] ${apiName} must be used inside an app with createRouteForgePlugin() installed`,
    );
  }
  return forge;
}
