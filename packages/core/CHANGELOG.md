# Changelog — @route-forge/core

本项目遵循语义化版本。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## 2.2.0 — 2026-09-03

### Added

- **页面内嵌摘要 hydration（Blade 直出加速）**：`createRouteForge()` 初始化时优先读取后端 `@forgeSummary`
  注入的 `window.__ROUTE_FORGE__`（一次性访问器，读后自删），命中则**跳过摘要 HTTP**、auto-discovery **同步完成**
  （构造后 `route()` / `ready()` 立即可用）。core 侧 module 级 memo 兜住同页多实例（React StrictMode / 第二个 Provider）。
  无内嵌时自动回落，SPA / Vite dev 行为不变。
- `RouteForgeOptions.summary?: SummaryResponse`：直接喂入摘要数据的显式入口（测试 / 非 Blade 引导）。摘要来源级联：
  **页面内嵌 > `summary` 字段 > 网络 `endpoint`**（对齐 SPEC §4.1.1 / §5.3）。

### Changed

- **对齐后端 `ForgeSummary` 契约**（`SummaryResponse` 形状变更）：`schemaVersion?` → **`schemeVersion`**（必填，拼写 scheme）；
  各层级新增自描述 `route: { uri, methods }`；移除 per-level `cache`；`config.url_prefix` 由可选改 `string | null`；
  `config` 新增全局 `cache_ttl`。层级懒加载 URL 优先取 `levels[].route.uri`（`endpoint_prefix` 仅兜底）。
- **缓存 TTL 唯一来源改为全局 `config.cache_ttl`**（`null`=不缓存、只留内存不落存储、每次 `load` 重取；`0`=永久；
  正整数=`min(后端, cache.ttl)`）。层级明细响应 `LevelRoutesResponse` 不再含 `cache` 字段。
- `RouteForgeOptions.endpoint` 由必填改为**可选**：命中内嵌 / `summary` 时可省略；`endpoint`、`summary`、页面内嵌三者皆无时抛 `TypeError`。
- 元信息层级拉取的请求标识由 `__forge__.load.<level>` 改为保留命名空间 **`route-forge.<level>`**（开发者不会占用，防撞名；摘要仍为 `__forge__.summary`）。

### Removed

- 移除"从摘要顶层 `unassigned` 数组就地构建虚拟层级"机制：后端现恒把 `unassigned` 作为 `levels` 中的真实层级注入，
  前端与其它层级一致按 `route.uri` 走 HTTP 懒加载。顶层 `unassigned` 字段不再消费。

## 2.1.0 — 2026-08-31

### Changed

- 内部重构（公共 API 与运行时行为零变更）：`createRouteForge` 单文件"大工厂函数"按职责拆为五个同目录模块，
  `forge.ts` 从 888 行瘦身到 335 行——
  `url-builder.ts`（URL 构建与 `ApiCallParams` 解析，纯函数）、
  `auto-discovery.ts`（摘要端点 `fetchSummary` + `applySummaryToState` 折算）、
  `route-store.ts`（`RouteStore`：`RouteCache` / inflight 去重 / 失效代数 / 层级加载 / 虚拟 `unassigned` 层级）、
  `http-runner.ts`（`createHttpRunner`：`api` / `doApiCall` + 请求/响应拦截链 + HTTP/网络/取消错误转换 + 加载中标识）、
  `bound-forge.ts`（`createBoundForgeFactory`：`use(level, prefix)` 的层级绑定 BoundForge 构造）。
  `ensureAdapter` / `fetchMeta` 作为跨子系统共享 infra 保留在工厂；原散落的 `effective*` 可变状态收敛为
  工厂持有的单个 `DiscoveryState` 对象，各处按属性实时读取以保留自动发现回填语义（非快照）。
- 内部重构：理顺 `createRouteForge()` 初始化时序——摘要发现在 `fetchMeta` / `adapterResolved` 就绪后就地启动
  （`fetchSummary` 为 async，首个 `await` 即让出，不阻塞工厂返回、无构造期 TDZ），
  移除原 `whenSummary` 挂起队列与 `Promise.resolve().then()` 微任务延迟启动机制。
- 内部清理：移除 `forge.ts` 底部与 `index.ts` 重复的 `createInterceptorManager` / `RouteCache` / `ForgeError`
  死重导出（无深路径消费者）。

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

- 文档补 onSummaryReady 失败兜底示例（摘要失败时回调不触发、mount 不执行，须接住 ready() 的 reject 避免白屏）

### Changed

- 摘要端点拉取改走 adapter 原始通道（与层级路由表拉取同一 `requestRaw` 通道，跳过业务拦截链），
  原为无超时的裸 `fetch`。摘要请求因此获得 `timeout`（含 30s 兜底）、adapter 检测/降级、
  自定义 Fetcher 兼容；端点挂起时不再永久阻塞 `ready()`/`load()`/`api()`，
  超时后按既有失败语义处理（有显式 `levels` 降级，无则 `ready()` reject）
- 摘要失败错误类型变为 `HTTPError`/`NetworkError`（携带 status/url 详情）；降级分支行为不变
- 重构：内置 http 拆为纯 fetch 底座（`fetch-core.ts`：超时/取消合并、序列化、非 2xx 转换，
  无状态可复用）+ 拦截器编排门面（`builtin-http.ts` 瘦身）；`isAbortError` 双份实现合一

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
