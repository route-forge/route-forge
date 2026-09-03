# AGENTS.md — Route Forge 仓库 AI 协作指南

本文件面向 AI 编码代理（Coding Agent）与人类贡献者，说明本仓库的结构、命令、约定与不可违背的设计铁律。
产品与 API 文档见 [README.md](./README.md)（English，默认）/ [README_zh.md](./README_zh.md)（中文），`llms.txt` 提供全部文档索引。

## 项目概览

Route Forge 是 Laravel 命名路由的前端客户端方案：从后端 manifest 端点拉取路由元信息，按层级（level）懒加载与隔离缓存，用路由名调用 API / 生成 URL。本仓库为 **npm monorepo**（pnpm workspace + Turborepo），包含三个公共包；Laravel 后端包在独立仓库 [route-forge/route-forge-laravel](https://github.com/route-forge/route-forge-laravel)，两侧经 HTTP manifest 契约交互、版本独立演进。

```
packages/
├── core/    @route-forge/core   框架无关核心（工厂/缓存/拦截器/adapter/codegen CLI/IIFE）
├── vue/     @route-forge/vue    Vue 3 集成（插件 + useForge/useForgeApi/useForgeRoute + ForgeRoute/ForgeLink 组件）
└── react/   @route-forge/react  React 集成（Provider + 同名 hooks + ForgeRoute/ForgeLink 组件）
.docs/       SPEC.md（功能规格 + manifest 契约）、DESIGN.md（设计思路）
```

## 常用命令

```bash
pnpm install                       # 安装依赖（pnpm >= 8，Node >= 18）
pnpm build                         # turbo：构建全部包
pnpm test                          # turbo：运行全部包测试（test 依赖 build）
pnpm typecheck                     # turbo：类型检查（各包 tsc --noEmit）
pnpm lint                          # 同 typecheck（本仓库无独立 linter）

# 全量验证（提交前必跑）：
npx turbo run typecheck test build --output-logs=errors-only --force

# 单包测试：
pnpm --filter @route-forge/core test
pnpm --filter @route-forge/vue test
pnpm --filter @route-forge/react test
```

当前测试基线：**302 例**（core 230 / vue 34 / react 38），全部通过是提交前置条件。

## 提交与协作约定

- 提交信息格式：`type(scope): 中文描述`；type ∈ feat/fix/test/docs/refactor/chore，scope 用包名（core/vue/react，跨包可省略）
- **任何提交前必跑全量验证并全部通过**；新功能与缺陷修复必须同步补测试，测试组织遵循各包现有结构（`packages/*/tests/`，vitest）
- 提交使用 GPG 签名；**不要自行 `git push`**，等用户指示
- 发版由 tag 触发 GitHub Actions（OIDC Trusted Publishing）：`x.y.z` 全量、`core-x.y.z` / `vue-x.y.z` / `react-x.y.z` 单包；tag 为**无 v 前缀**纯版本号

## 设计铁律（改动前必读）

1. **前端校验始终抛错，绝不静默忽略**：层级未声明抛 `UnknownLevelError`、路由名不存在抛 `UnknownRouteError`、必填参数缺失抛 `MissingRouteParamError`。`RouteForgeOptions.strict` 已废弃（传入无效果），不要基于它做任何分支；`strict_mode` 是**后端**生成 manifest 的语义，与前端无关。
2. **初始化时序**：`createRouteForge` 折算 `DiscoveryState` 的摘要来源为级联（**页面内嵌 `window.__ROUTE_FORGE__` > `options.summary` > 网络 `GET options.endpoint`**）→ eager 预加载 → `ready()` settle。命中内嵌/配置时 discovery **同步完成、不发网络**（构造后 `route()`/`ready()` 立即可用；一次性访问器读后自删 + core module-memo 兜同页多实例）；命中网络时后台异步启动（`fetchSummary` 首个 `await` 即让出，不阻塞工厂返回）。`route()` / `hasRoute()` 有 `RF_FE_010` 守卫；`api()` 内部 await discovery，不受守卫影响。`endpoint` 现为**可选**（有内嵌/summary 时可省略，三者皆无抛 `TypeError`）；层级懒加载 URL 取自摘要 `levels[].route.uri`（`endpoint_prefix` 兜底），缓存 TTL 唯一来源为全局 `config.cache_ttl`。网络路径失败语义：显式 `levels` 可降级（warn），否则 `ready()` reject——不要吞掉 reject。`unassigned` 是后端恒注入 `levels` 的真实层级（按 route.uri HTTP 懒加载），**不再有"顶层数组 + 虚拟层级"机制**。`options` 入参本身可选：core `createRouteForge()`、vue `createRouteForgePlugin()`、react `<RouteForgeProvider>`（不传 `options`）在摘要全来自内嵌时均可无参调用。
3. **元信息拉取走 adapter 原始通道**（`requestRaw`，跳过业务拦截链），与业务 `api()` 的拦截链严格分离；改 `fetchMeta` 时保持该隔离。
4. **错误码是稳定契约**：`ForgeErrorCode` 字面量联合（`RF_FE_001`…`RF_FE_010`，004 空缺），错误类、码、语义见 `packages/core/src/errors.ts`；新增错误必须进联合与 README 错误表。
5. **框架适配层只改响应式外壳，不改语义**：
   - core `forge.use()` 每次新建 `BoundForge`（不缓存）；`levelLoaded` 以 `configurable: true` 定义，供 Vue（`Ref<boolean>`）/React（`boolean` getter）覆盖——覆盖时必须保持 `configurable: true` 对齐。
   - React `useForge`：`loadedRef` 是单一真值源，只能在 effect / 异步回调（渲染提交后）写入，**禁止渲染期写 ref**（concurrent/StrictMode tearing）；`useState` 版本号仅驱动重渲染。
   - Vue / React 的 `level` 均为实例级静态绑定契约，不支持中途切换。
6. **渲染期错误降级**：`useForgeRoute` 遇路由错误降级为 `''` + 样式化 `console.warn`，不中断渲染——不要在渲染路径抛错。
7. **adapter 'auto' 探测用动态 `import('axios')`**（变量引用模块名防静态打包），失败降级 `builtin`；`builtin` 的 `runsInterceptors=true`（拦截链在 adapter 内执行），`http-runner` 依此跳过重复执行——改拦截编排时两侧一起看。
8. **包自身路由排除是后端职责**：后端 `forge.routes.*` / `forge.manager.*` 路由不参与元信息扫描（否则 `strict_mode` 必 500）——在 SPEC/后端文档语境讨论时记住这一点。

## 测试注意事项

- 元信息通道（`rawFetch`）按响应 `Content-Type` 判定 JSON：**mock 响应必须带 `content-type: application/json` header**，否则 `data` 保持字符串。
- React Testing Library 测并发状态：闭包快照（如 `api.pending`）在非 `act` 的 setState 下不刷新，须渲染到 DOM 用 `getByTestId` + `waitFor` 断言；不要在一个 `act` 里并发触发两个 `call`。
- vitest 汇总行含 ANSI 色码，脚本里统计用例数先 `sed -E 's/\x1b\[[0-9;]*m//g'`。

## 文档约定

- 公共文档双语：`README.md`（English，默认——AI 可发现性优先）+ `README_zh.md`（中文），顶部互链；两份必须同步维护
- `llms.txt` 维护全仓库文档索引；`.github/copilot-instructions.md` 与本文件保持一致
- 差异化表述用**能力自述**，不写与竞品的对比表
- 版本变更记录在各包 `CHANGELOG.md`（Keep a Changelog，中文）
