#!/usr/bin/env node
/**
 * @route-forge/core codegen 入口（tsup bin 入口 `src/codegen/index.ts`）。
 *
 * 实现按功能拆分：
 *   - codegen/summary-client.ts  摘要 / 层级明细拉取（route.uri 优先，endpoint 兜底）
 *   - codegen/emit.ts            d.ts 内容生成（纯字符串）
 *   - codegen/cli.ts             参数解析 / 帮助 / 主流程编排
 * 本文件仅做 re-export（保持 `parseArgs` / `main` / `generateRouteTypes` /
 * `fetchSummary` / `fetchLevel` / `runCodegen` / `CodegenOptions` 等导入路径稳定）
 * 并承载「作为 CLI 直接执行时」的自调用守卫。
 *
 * @see .docs/SPEC.md §4.2
 */

export {
  parseArgs,
  main,
  type CodegenOptions,
} from './cli.js';
export { generateRouteTypes } from './emit.js';
export { fetchSummary, fetchLevel } from './summary-client.js';
export { main as runCodegen } from './cli.js';

import { main as runCodegenMain } from './cli.js';

const invokedFromCli = (() => {
  try {
    if (!process.argv[1]) return false;
    const argv1 = process.argv[1].replace(/\\/g, '/');
    return argv1.endsWith('/codegen.js') || argv1.endsWith('/codegen.cjs') || argv1.endsWith('/codegen');
  } catch {
    return false;
  }
})();

if (invokedFromCli) {
  runCodegenMain().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
