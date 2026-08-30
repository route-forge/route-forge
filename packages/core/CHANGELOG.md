# Changelog — @route-forge/core

本项目遵循语义化版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [Unreleased] v2.0.0

### Performance

- storage 模式（sessionStorage/localStorage）新增内存镜像：原 `route()`/`api()` 热路径上每次
  `cache.get()` 都执行 `getItem` + `JSON.parse` 整层路由表（同步阻塞主线程，路由表大/链接多时
  放大明显）。现在首次读盘解析后条目驻留内存，后续 `get` 直接命中；`set` 写入即建镜像；
  其他标签页修改 storage 时通过 `storage` 事件失效对应镜像，跨标签页新鲜度与原实现一致；
  镜像内同样执行 TTL 检查，无过期数据驻留

### Fixed

- `ready()` 自动发现失败时改为 reject 并携带原始错误：原 `.catch(() => {})` 吞掉错误后
  `ready()` 永久挂起（既不 resolve 也不 reject），调用方无感知；摘要端点返回非 2xx 且
  未传显式 `levels`（无可用降级）时同样 reject（原行为是告警后谎报 resolve）
- eager 层级加载失败不再静默 `console.warn`：改为逐层级 `console.error` 抛出完整异常
  （含堆栈），且不阻塞 `ready()`；失败不缓存失败态，后续 `load()`/`api()` 直接调用时
  重试该层级，再失败时向调用方抛出

### Removed

- 移除 `UseForgeByPrefixReturn` 类型导出：vue/react 的 `useForgeByPrefix` 与 `useForge(level, prefix)`
  功能重复，已随框架包一并移除（breaking change）

## 1.4.0 — 2026-08-28

### Fixed

- adapter 解析抛出非预期错误降级到 builtin 时，透传 forge 拦截器管理器，用户拦截器不再被静默跳过
- 层级元信息拉取不再经过业务拦截链：新增 `requestRaw` 原始通道，与 axios 路径行为对齐（此前解包型响应拦截器会破坏层级解析）
- `BoundForge.levelLoaded` 加载失败时保持 reject 语义（原实现把失败吞成成功，`onLevelLoaded` 的 `onRejected` 分支不可达）

### Removed

- 移除 `effectiveStrict` 死代码：前端校验始终开启（层级未声明必抛 `UnknownLevelError`）；`strict` 选项标记 `@deprecated`，传入不再有任何效果

### Tests

- 补齐审计缺口，用例 181 → 217：adapter auto 检测/降级、自定义 Fetcher、invalidate 竞态、unassigned 真实层级分支、`useRoutePrefix`、`ready()` 语义、`onSummaryReady` 时序、signal 拦截器操作、类型推断回退等

## 1.3.1 — 2026-08-28（已废弃，请使用 1.4.0+）

### Changed

- ⚠️ 请求取消改为内置 AbortController：`forge.api()` 返回的 `ForgeRequest` 自带 `abort()` 方法。
  此为破坏性变更（旧写法传入 `signal` 参数将静默失效），误发为 patch 版本，已在 npm 标记 deprecated，
  由 1.4.0 正式承接

## 1.3.0 — 2026-08-28

### Added

- 统一 API 表面：`ready()` 方法化（返回 `Promise<RouteForge>`）、`use(level?, prefix?)` 绑定入口、`BoundForge` 接口（`onLevelLoaded()` / `useRoutePrefix()`）

## 1.2.2 — 2026-08-27

### Changed

- 工程升级：pnpm 11 / Node.js 24

## 1.2.1 — 2026-08-27

### Changed

- CI 工作流迁移调整（仓库迁移至 route-forge 组织后的发布流水线验证）

## 1.2.0 — 2026-08-26

### Changed

- IIFE 构建体积优化（浏览器 `<script>` 引入产物瘦身）
- 仓库迁移至 [route-forge](https://github.com/route-forge) 组织，文档同步更新

## 1.1.1 — 2026-08-26

### Added

- auto-discovery 守卫：`route()` / `hasRoute()` 在 discovery 未完成且无显式 `levels` 时抛 `ForgeError (RF_FE_010)`
- `RouteForgeOptions.onSummaryReady` 回调：auto-discovery 完成后触发（推荐在此挂载应用）
- `ready`：discovery + eager load 全部完成后 resolve
- `onLevelLoaded(level, cb)` 订阅机制，供框架层驱动响应式更新

### Fixed

- 修复 forge.ts 5 个运行时缺陷

## 1.1.0 — 2026-08-25

### Added

- 请求取消：通过 `AbortSignal` 取消进行中的请求，与 timeout 协同
- `unassigned` 虚拟层级：后端未标记层级的路由通过摘要端点下发，前端无需独立 HTTP 请求即可消费

## 1.0.2 — 2026-08-24

### Added

- `schemaVersion` 向前兼容（后端协议版本 > 客户端支持版本时告警）
- 单次请求 `timeout` 覆盖（`api(level, name, { timeout })`）
- 批量 `invalidate(['admin', 'manage'])`

### Fixed

- 修复 8 个运行时缺陷，新增 102 个测试用例

## 1.0.0 — 2026-08-24

首个正式版本（MVP）：

- 分级懒加载、按层级隔离缓存（memory / sessionStorage / localStorage）、并发去重
- 摘要端点自动发现（levels / eager / endpoint / url_prefix / strict_mode）
- `forge.api(level, name, params)` 命名路由调用 + 参数智能消解（`params` / `query` / `body` / `headers`）
- 拦截器（请求 LIFO / 响应 FIFO，对齐 axios；声明式 + 运行时注册）
- Adapter：`auto` 检测 / `axios` 复用 / `builtin`（零依赖 fetch）/ 自定义 Fetcher
- codegen CLI：从摘要端点生成 `ForgeRouteMap` TS 类型声明
- 错误体系 `RF_FE_001~010`、加载状态跟踪（`isLoading` / `onLoadingChange`）
- IIFE 浏览器构建（`<script>` 直接引入）
