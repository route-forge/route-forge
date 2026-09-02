/**
 * ForgeRoute / ForgeLink 共享内部实现：降级报告、未加载提示
 * （非公共 API，不进包入口导出）
 */

/** 解析出错降级报告：红色加粗标签 + 完整错误对象，控制台一眼可见（error 级，每次出错都报） */
export function reportDegrade(component: string, error: unknown): void {
  console.error(
    `%c[route-forge]%c ${component} 路由解析失败（已降级为空字符串，渲染未中断）`,
    'color:#c0392b;font-weight:bold',
    'color:inherit',
    error,
  );
}

/** level 未加载提示：每实例仅一次（在 effect 内调用），避免正常加载瞬态刷屏 */
export function warnUnloadedOnce(component: string, level: string): void {
  console.warn(
    `[route-forge] ${component}: level "${level}" 尚未加载，链接暂不渲染（加载完成后自动出现）`,
  );
}
