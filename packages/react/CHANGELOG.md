# Changelog — @route-forge/react

本项目遵循语义化版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [Unreleased] v2.0.0

### Fixed

- `useForgeRoute` 渲染期错误不再静默吞掉：路由名不存在或必填参数缺失时降级为 `''` 之外，
  以样式化 `console.warn` 输出完整错误（含堆栈）——开发期控制台醒目可见，生产无副作用。
  与 Vue 版行为对齐
### Removed

- 移除 `useForgeByPrefix` composable：与 `useForge(level, prefix)` 功能重复（前者为后者的严格子集，
  仅多一个 separator 参数），统一入口减少心智负担。前缀绑定请改用 `useForge(level, prefix)`（Vue）/
  `useForge({ level, prefix })`（React），智能前缀消解行为完全一致

## 1.4.0 — 2026-08-28

与 core 锁步发布，修复依赖锁定问题。

### Changed

- 依赖 `@route-forge/core` 从 `workspace:*`（发布为精确版本）改为 `workspace:^`（发布为 `^1.4.0`），
  用户可独立升级 core 补丁

### Fixed

- `useForge({ level })` 的 `levelLoaded` 改用 state 驱动：加载完成后正确触发组件重渲染（旧实现仅赋值闭包变量，UI 不更新）

### Tests

- 补齐 `levelLoaded` 重渲染回归测试、`useForgeRoute` 参数变化重算（M3）、`onSummaryReady` Provider 场景（M5）

## 1.3.0 — 2026-08-28

### Changed

- 适配 core 统一 API 表面：`useForge({ level?, prefix? })` 内部委托 `forge.use()`，`levelLoaded` 为 `boolean`

## 1.2.2 — 2026-08-27

### Changed

- 工程升级：pnpm 11 / Node.js 24

## 1.2.1 — 2026-08-27

### Changed

- CI 工作流迁移调整

## 1.2.0 — 2026-08-26

### Changed

- 仓库迁移至 [route-forge](https://github.com/route-forge) 组织，文档同步更新

## 1.1.1 — 2026-08-26

### Changed

- 适配 core auto-discovery 守卫与初始化时序（`ready` / `onSummaryReady`）

## 1.1.0 — 2026-08-25

### Fixed

- 补齐加载状态相关 API（`isLoading` / `onLoadingChange`）

## 1.0.2 — 2026-08-24

### Changed

- 随 core 同步发版（依赖更新）

## 1.0.0 — 2026-08-24

首个正式版本（MVP）：

- `RouteForgeProvider`：Context 注入 + options 浅比较保证实例稳定
- `useForge({ level?, prefix? })`：层级绑定 + 路由名前缀
- `useForgeApi`：带 `pending` / `error` 状态的调用封装
- `useForgeRoute`：URL 生成 hook
- `useForgeByPrefix`：智能前缀消解
