/**
 * ForgeRoute / ForgeLink 共享内部实现：降级报告（转发 degrade.ts）、未加载提示
 * （非公共 API，不进包入口导出）
 */

export { reportDegrade, reportRenderWarn, __resetDegradeReportsForTests } from '../degrade.js';

/** level 未加载提示：每实例仅一次（在 effect 内调用），避免正常加载瞬态刷屏 */
export function warnUnloadedOnce(component: string, level: string): void {
  console.warn(
    `[route-forge] ${component}: level "${level}" 尚未加载，链接暂不渲染（加载完成后自动出现）`,
  );
}
