# Route Forge 进度快照

> 更新于 2026-08-28（v1.3.1 之后，含当日审计修复）。本文件是进度追踪文档，以代码实际状态为准。

**全部测试通过：core 217 + vue 27 + react 29 = 273 tests 全绿；typecheck / lint / build 全绿。**

---

## 项目总进度：~95%（npm 侧 MVP 已收尾：实现 + 测试审计 + 文档齐备）

后端 Laravel 包在独立仓库 [route-forge-laravel](https://github.com/route-forge/route-forge-laravel)，
其进度（含 Laravel 9/10/11 兼容矩阵）在那边单独追踪。

### 已完成

#### 1. 工程脚手架（100%）
- pnpm workspace + turborepo + tsconfig.base 多包管理
- 三个 npm 包：`@route-forge/core` / `@route-forge/vue` / `@route-forge/react`
- tsup 构建：ESM + CJS + IIFE（含 min 生产版）、d.ts、codegen bin 入口
- CI 发布流水线（.github/workflows/publish.yml）、`pnpm publish:build` 一键发布

#### 2. 前端 Core 包（100%）
- `forge.ts`：懒加载、隔离缓存、并发去重（inflight + 失效代数防旧数据回写）、
  摘要端点自动发现（levels / eager / endpoint / url_prefix 后端权威）、
  `api()` 内置 AbortController 可取消请求、`ready()` / `use()` / `BoundForge` 统一 API 表面、
  unassigned 虚拟层级、schemaVersion 向前兼容、批量 invalidate
- `interceptors.ts`：请求 LIFO / 响应 FIFO（对齐 axios），声明式 + 运行时两种注册
- `cache.ts`：memory / sessionStorage / localStorage，TTL = min(后端, 前端兜底)，storage 失败回退内存
- `adapters/`：auto 检测（动态 import 防静态打包）/ axios 包装 /
  builtin-http（零依赖 fetch，< 3KB，`requestRaw` 原始通道供元信息拉取）/ 自定义 Fetcher
- `codegen/`：CLI 完整实现（argv 解析、摘要自动发现、unassigned、写文件）
- `errors.ts`：RF_FE_001~010 错误体系
- 测试 217 个，覆盖：懒加载 / 自动发现 / 缓存 / 拦截器 / 调用 / adapter 全路径
  （auto 检测、降级、自定义 Fetcher）/ 取消 / 生命周期时序 / 类型推断回退

#### 3. Vue 3 插件（100%）
- `createRouteForgePlugin`（provide + `$forge.route` + ready）
- `useForge(level?, prefix?)`（levelLoaded → Ref<boolean>）
- `useForgeApi` / `useForgeRoute`（未加载返回 ''）；前缀绑定统一走 `useForge(level, prefix)`
- 测试 27 个全绿

#### 4. React 集成（100%）
- `RouteForgeProvider`（options 浅比较保证实例稳定）
- `useForge({ level?, prefix? })`（levelLoaded → boolean，state 驱动重渲染）
- `useForgeApi` / `useForgeRoute`；前缀绑定统一走 `useForge({ level, prefix })`
- 测试 29 个全绿

#### 5. 文档（100%）
- 根 README：quick start + 完整示例章节（真实项目调用流程：挂载时序 / 登录态 / 401 /
  层级绑定 / 取消 / 错误速查），作为端到端示例项目的文档替代
- core README：工具导出表 + 完整错误参考
- 三个包的 CHANGELOG（回溯 1.0.0 ~ 1.3.1 + Unreleased 区）

#### 6. 2026-08-28 审计与修复（测试审计驱动，232 → 273 用例）
- 移除 `effectiveStrict` 死代码：前端校验始终开启，`strict` 选项 @deprecated
  （SPEC §4.1.5 / §5.2 / §5.3 / §6.2 已同步修订）
- fix(react)：`levelLoaded` 改用 state 驱动，修复加载完成后不触发重渲染
- fix(core)：层级元信息拉取改走 `requestRaw`，不再经过业务拦截链（与 axios 路径对齐）
- fix(core)：adapter 非预期错误降级到 builtin 时保留 forge 拦截器管理器
- fix(core)：`BoundForge.levelLoaded` 加载失败保持 reject 语义，`onLevelLoaded`
  的 onRejected 分支可达
- 补齐审计缺口 39 个用例：adapter 全路径 / invalidate 竞态 / unassigned 真实层级 /
  useRoutePrefix / ready 语义 / onSummaryReady 时序 / abort 短路 / 类型推断等

---

### 待办

| 优先级 | 项目 | 说明 |
|--------|------|------|
| P1 | 完成 1.4.0 锁步发布 | 版本与 CHANGELOG 已就绪（1.4.0）；待：push + 打 tag（1.4.0 / core-1.4.0 / vue-1.4.0 / react-1.4.0）触发 CI；core 1.3.1 需 npm deprecate（需 npm 登录态，用户本地执行） |
| P3 | 端到端示例项目（Laravel + Vue） | 已由根 README 完整示例章节替代；可运行示例暂缓 |
| P3 | v1.x 路线图 | 可视化面板（v1.1）/ OpenAPI 桥接（v1.2）/ Vite 插件（v1.3）—— 均未启动，按需排期 |
| — | 后端侧待办 | Laravel 9/10/11 兼容矩阵实测（仅 13.x 验证过），见独立仓库 |
