/**
 * @route-forge/core codegen CLI：参数解析、帮助与主流程编排。
 * @see .docs/SPEC.md §4.2
 *
 * 用法：
 *   npx @route-forge/core codegen \
 *     --endpoint http://localhost/_forge/routes \
 *     --levels public,client,manage,admin \
 *     --out src/types/forge-routes.d.ts
 */

import { fetchLevel, fetchSummary } from './summary-client.js';
import { generateRouteTypes } from './emit.js';
import type { RouteMeta } from '../types.js';

export interface CodegenOptions {
  endpoint: string;
  levels: string[];
  out: string;
}

/**
 * 解析 argv（最小手写实现，不引入 commander/yargs）
 * 支持：--endpoint VALUE / --endpoint=VALUE / --levels a,b,c / --out PATH
 */
export function parseArgs(argv: string[]): CodegenOptions {
  const opts: Partial<CodegenOptions> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) {
        throw new Error(`[route-forge/codegen] missing value for ${arg}`);
      }
      return v;
    };

    if (arg === '--endpoint') {
      opts.endpoint = next();
    } else if (arg?.startsWith('--endpoint=')) {
      opts.endpoint = arg.slice('--endpoint='.length);
    } else if (arg === '--levels') {
      opts.levels = next().split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg?.startsWith('--levels=')) {
      opts.levels = arg.slice('--levels='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--out') {
      opts.out = next();
    } else if (arg?.startsWith('--out=')) {
      opts.out = arg.slice('--out='.length);
    } else if (arg === '--responseTypes' || arg?.startsWith('--responseTypes=')) {
      // 该参数从未实现（解析后被静默忽略）；现显式报错并给出迁移方式，不再无声吞掉
      console.error(
        '[route-forge/codegen] --responseTypes has been removed (it was never implemented). ' +
          'Edit the "response" field in the generated d.ts directly, or use module augmentation on ForgeRouteMap.',
      );
      process.exit(1);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!opts.endpoint) {
    console.error('[route-forge/codegen] --endpoint is required');
    printHelp();
    process.exit(1);
  }
  if (!opts.out) {
    console.error('[route-forge/codegen] --out is required');
    printHelp();
    process.exit(1);
  }

  return {
    endpoint: opts.endpoint,
    levels: opts.levels ?? [],
    out: opts.out,
  };
}

function printHelp(): void {
  console.log(`
route-forge codegen - generate TS route types from backend summary endpoint

Usage:
  npx @route-forge/core codegen --endpoint URL --out PATH [--levels a,b,c]

Options:
  --endpoint URL         Backend summary endpoint (e.g. http://localhost/_forge/routes)
  --levels a,b,c         Optional: explicit level list (skip auto-discovery)
  --out PATH              Output .d.ts file path
  -h, --help              Show this help
`);
}

/**
 * CLI 主入口
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const opts = parseArgs(argv);

  // 尽力拉取摘要：既用于自动发现层级名，也用于取各层级 route.uri 拼明细端点
  // （与运行时 RouteStore.fetchLevel 对齐——优先 route.uri，缺省回退 endpoint 拼接）。
  // 未显式传 --levels 时：摘要拉取失败即致命（无从发现层级）。
  // 显式传 --levels 时：摘要拉取失败仅降级为「全部层级用 endpoint 兜底拼接」，不致命。
  let summary: Awaited<ReturnType<typeof fetchSummary>> | null = null;
  try {
    summary = await fetchSummary(opts.endpoint);
  } catch (e) {
    if (opts.levels.length === 0) {
      console.error(`[route-forge/codegen] failed to auto-discover levels from summary endpoint: ${(e as Error).message}`);
      console.error('hint: pass --levels explicitly to skip auto-discovery');
      process.exit(1);
    }
    console.warn(
      `[route-forge/codegen] summary endpoint unreachable: ${(e as Error).message}; falling back to endpoint-derived level URLs`,
    );
  }

  // 未指定 --levels 时从摘要自动发现层级（unassigned 现是 levels 中的真实层级，一并纳入）
  let levels = opts.levels;
  if (levels.length === 0 && summary) {
    levels = Object.keys(summary.levels);
  }

  if (levels.length === 0) {
    console.error('[route-forge/codegen] no levels found; pass --levels explicitly');
    process.exit(1);
  }

  // 所有层级（含 unassigned 真实层级）统一按 HTTP 懒加载拉取（SPEC §3.1.6）：
  // 优先用摘要 levels[].route.uri，缺省时回退 endpoint 拼接
  const levelFetches = await Promise.allSettled(
    levels.map((lvl) => fetchLevel(opts.endpoint, lvl, summary?.levels[lvl]?.route?.uri)),
  );

  const routesByLevel: Record<string, Record<string, RouteMeta>> = {};
  let failedLevels = 0;
  levelFetches.forEach((res, idx) => {
    const lvl = levels[idx]!;
    if (res.status === 'fulfilled') {
      routesByLevel[lvl] = res.value.routes;
    } else {
      failedLevels++;
      console.warn(`[route-forge/codegen] failed to fetch level "${lvl}": ${(res.reason as Error).message}`);
    }
  });

  const totalRoutes = Object.values(routesByLevel).reduce((sum, r) => sum + Object.keys(r).length, 0);
  if (totalRoutes === 0) {
    console.error('[route-forge/codegen] no routes collected from any level');
    process.exit(1);
  }

  const dts = generateRouteTypes(routesByLevel);

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const outPath = path.resolve(opts.out);
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(outPath, dts, 'utf8');

  console.log(`[route-forge/codegen] written ${totalRoutes} routes across ${Object.keys(routesByLevel).length} level(s) to ${outPath}`);
  if (failedLevels > 0) {
    console.warn(`[route-forge/codegen] ${failedLevels} level(s) failed; output may be incomplete`);
  }
}
