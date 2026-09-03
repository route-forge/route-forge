# Changelog — @route-forge/react

本项目遵循语义化版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## 2.2.1 — 2026-09-03

### Changed

- `<RouteForgeProvider options?>`：`options` 改为可选。摘要来自页面内嵌 `window.__ROUTE_FORGE__` 时
  可直接 `<RouteForgeProvider>` 省略 `options`，内部归一为 `{}` 透传 core，对齐 `createRouteForge()` 的参数可选化。

## 2.2.0 — 2026-09-02

### Fixed

- `useForgeRoute`：`level` 增加运行时守卫——传非 string（如 getter 函数）直接抛 `TypeError`
  响亮报错，不再静默降级为永远为空的链接（类型签名本就是 `string`，此为 JS 侧误用的兜底）。

### Added

- 组件 `ForgeRoute` / `ForgeLink`：封装 `useForgeRoute` 的"先空串、后更新"异步行为。
  未加载 / 解析失败时渲染 `loading` prop（缺省不渲染），加载后渲染链接；
  `ForgeLink` 支持 `as` prop 注入任意 Link 组件（react-router `Link` / next/link 等，
  注入组件同时收到 `href` 与 `to` 两个 prop），零路由库依赖。
  `level` 未加载时每实例 `console.warn` 一次，路由解析失败 `console.error`（渲染均不中断）。

## 2.1.0 — 2026-08-31

### Fixed

- `useForge` 的 `levelLoaded`：由"渲染期直接写镜像 ref"改为 `loadedRef` 单一真值源 + getter，
  仅在 effect / 异步回调（渲染提交之后）写值并驱动重渲染。消除 concurrent / StrictMode 下
  渲染期写 ref 与已提交状态不一致（tearing）的隐患，`levelLoaded` 观感与语义不变。

### Changed

- `useForge` / `useForgeRoute` 明确契约：`level`（及 `prefix`）为实例级静态绑定，不支持中途
  动态切换——换层级请新建组件 / 新建一次 hook 调用（与 Vue 一致）。
- `useForgeRoute`：移除无效的 `eslint-disable react-hooks/exhaustive-deps`（仓库未接 eslint，
  `pnpm lint` 实为 `tsc --noEmit`），改为普通依赖说明注释。

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

- `useForgeRoute` 的 `params` 依赖序列化：内联对象字面量每次渲染都是新引用，
  原实现直接放进依赖数组导致 effect 每次渲染重跑。现以 JSON 序列化内容为依赖，
  内容不变则跳过
- `RouteForgeProvider` 实例创建移出渲染热路径：原实现在渲染期检测 options 变化并
  重建实例（内含摘要 fetch 副作用）。改为 lazy init（首次渲染）+ `useEffect` 检测
  options 变化（换实例延后一帧），StrictMode/concurrent 下提交的实例唯一

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
