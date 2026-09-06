/**
 * 降级/渲染警告的统一报告器（内部实现，非公共 API，不进包入口导出）：
 * - 会话级去重：同一 (component, message) 或同一渲染错误只报告一次，
 *   name/params 联动输入等高频场景不刷屏
 * - enabled=false（createRouteForge({ warnings: false })）时静音
 * - __resetDegradeReportsForTests 仅供测试隔离使用
 */

const reportedKeys = new Set<string>();
const renderWarnKeys = new Set<string>();

function dedupeKey(component: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${component}:${message}`;
}

/** 解析出错降级报告（组件层，error 级） */
export function reportDegrade(component: string, error: unknown, enabled = true): void {
  if (!enabled) return;
  const key = dedupeKey(component, error);
  if (reportedKeys.has(key)) return;
  reportedKeys.add(key);
  console.error(
    `%c[route-forge]%c ${component} 路由解析失败（已降级为空字符串，渲染未中断）`,
    'color:#c0392b;font-weight:bold',
    'color:inherit',
    error,
  );
}

/** 渲染期错误降级输出（hook 默认路径，warn 级；组件层通常以 onDegrade 升级为 error） */
export function reportRenderWarn(error: unknown, enabled: boolean): void {
  if (!enabled) return;
  const key = `useForgeRoute:${error instanceof Error ? error.message : String(error)}`;
  if (renderWarnKeys.has(key)) return;
  renderWarnKeys.add(key);
  console.warn(
    '%c[route-forge]%c useForgeRoute 渲染期错误（已降级为空字符串，渲染未中断）',
    'color:#e67e22;font-weight:bold',
    'color:inherit',
    error,
  );
}

/** 测试隔离：清空去重状态（不进公共 API） */
export function __resetDegradeReportsForTests(): void {
  reportedKeys.clear();
  renderWarnKeys.clear();
}
