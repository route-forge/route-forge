# Changelog — @route-forge/vue

本项目遵循语义化版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## Unreleased

### Tests

- 补齐 `onSummaryReady` 插件场景测试（M5）

## 1.3.0 — 2026-08-28

### Changed

- 适配 core 统一 API 表面：`useForge(level?, prefix?)` 内部委托 `forge.use()`，`levelLoaded` 为 `Ref<boolean>`
- `createRouteForgePlugin` 返回对象携带 `ready` 方法

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

- `useForge()` 无 level 时仅保留异步 API + 工具方法；`useForge(level)` 自动触发加载并返回响应式 `levelLoaded`
- `useForgeRoute` 重写：内部处理层级加载，未加载返回 `''`，加载后自动更新
- `useForgeByPrefix` 适配：`route` 在层级未加载时返回 `''`
- 删除已废弃的 `useForgeLevel`（功能合并入 `useForge(level)`）

## 1.1.0 — 2026-08-25

### Fixed

- 补齐加载状态相关 API（`isLoading` / `onLoadingChange`）

## 1.0.2 — 2026-08-24

### Changed

- 随 core 同步发版（依赖更新）

## 1.0.0 — 2026-08-24

首个正式版本（MVP）：

- `createRouteForgePlugin`：provide 注入 + `$forge.route` 全局属性
- `useForge(level?, prefix?)`：层级绑定 + 路由名前缀
- `useForgeApi`：带 `pending` / `error` 响应式状态的调用封装
- `useForgeRoute`：响应式 URL 生成
- `useForgeByPrefix`：智能前缀消解
