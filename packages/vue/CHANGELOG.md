# Changelog — @route-forge/vue

本项目遵循语义化版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## 2.2.1 — 2026-09-03

### Changed

- `createRouteForgePlugin(options?)`：`options` 改为可选。摘要来自页面内嵌 `window.__ROUTE_FORGE__`
  时可 `createRouteForgePlugin()` 无参安装，对齐 core `createRouteForge()` 的参数可选化。

## 2.2.0 — 2026-09-02

### Added

- 组件 `ForgeRoute` / `ForgeLink`：封装 `useForgeRoute` 的"先空串、后更新"异步行为。
  未加载 / 解析失败时渲染 `loading` 插槽（缺省不渲染），加载后渲染链接；
  `ForgeLink` 探测到 vue-router 全局注册的 `RouterLink` 时自动渲染 `<RouterLink :to>`（零依赖探测）。
  `level` 未加载时每实例 `console.warn` 一次，路由解析失败 `console.error`（渲染均不中断）。

### Changed

- `useForgeRoute` 的 `level` 参数收窄为 `string` 静态绑定，移除 `() => string` 函数形式
  （层级是确定性声明，getter 形式从未真正支持动态切换——2.1.0 起即为 setup 快照语义，
  本次将契约落实到类型与运行时：传非 string 直接抛 `TypeError`，不再静默降级为空链接）。
  迁移：传 `() => 'admin'` 之类改为直接传 `'admin'`。

## 2.1.0 — 2026-08-31

### Changed

- `useForgeRoute`：`level` 收敛为 setup 快照静态绑定——`computed` 不再重新求值 level，消除
  "传入函数形式的 level 变了、但 load/levelLoaded 仍跟踪初始层级"的半吊子行为。`name` /
  `params`（getter）保持响应式。契约：换层级请新建组件 / 新建一次调用（与 React 一致）。
- `useForge`：覆盖 `levelLoaded` 的属性描述符由 `configurable: false` 改为 `true`，对齐 core
  `BoundForge.levelLoaded` 的挂载意图（允许适配层重配置）与 React 适配层，避免属性一旦固定不可改。

### Docs

- README / 注释补"层级静态绑定"契约说明。

## 2.0.0 — 2026-08-30

### Changed

- `ForgeError.code` 收窄为 `ForgeErrorCode` 字面量联合（`'RF_FE_001' | ... | 'RF_FE_010'`，004 空缺）
  并从 `@route-forge/core` 导出——用户侧 `switch (e.code)` 获得穷尽检查；
  向 `code` 赋任意 `string` 的代码将编译失败（类型级 breaking）

### Removed

- 移除 `onSummaryReady` 回调（breaking）：回调仅有成功通道，其设计曾导致失败被静默吞掉
  （ready() 挂起 + 挂载白屏无提示，即问题 #2 的根源）。初始化统一走 `ready()`——
  完整的成功/失败语义链，且 resolve 时机更安全（eager 层级也已完成）。
  迁移：`onSummaryReady: () => app.mount('#app')` →
  `forge.ready().then(() => app.mount('#app')).catch(err => { ... })`

### Docs

- 文档补 onSummaryReady 失败兜底示例

### Fixed

- `useForgeApi` 实现侧类型保真：`(forge as any).api(...)` 双重类型擦除改为按绑定形态分发的
  窄断言（bound 走 `BoundForge.api`，unbound 走 `RouteForge.api`），公共重载签名不变，
  实现不再逃过编译检查
- `useForgeApi` 的 `pending` 改引用计数：并发多个 call 时全部完成才置 false
  （原实现先完成的 call 会把其他在途请求的 pending 提前清掉）

### Fixed

- `useForgeRoute` 渲染期错误降级：路由名不存在或必填参数缺失时返回 `''` 保证渲染不中断，
  并以样式化 `console.warn` 输出完整错误（含堆栈）——开发期控制台醒目可见，生产无副作用。
  与 React 版行为对齐
### Removed

- 移除 `useForgeByPrefix` composable：与 `useForge(level, prefix)` 功能重复（前者为后者的严格子集，
  仅多一个 separator 参数），统一入口减少心智负担。前缀绑定请改用 `useForge(level, prefix)`（Vue）/
  `useForge({ level, prefix })`（React），智能前缀消解行为完全一致

## 1.4.0 — 2026-08-28

与 core 锁步发布，修复依赖锁定问题。

### Changed

- 依赖 `@route-forge/core` 从 `workspace:*`（发布为精确版本）改为 `workspace:^`（发布为 `^1.4.0`），
  用户可独立升级 core 补丁
- 承接 core 1.4.0 的元信息拦截链隔离与 `levelLoaded` reject 语义修复

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
