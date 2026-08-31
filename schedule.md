# Route Forge 进度快照

> 更新于 2026-08-31（v2.0.0 已发版，处于其后维护期）。本文件是进度追踪文档，以代码实际状态为准。

**全部测试通过：core 224 + vue 25 + react 27 = 276 tests 全绿；typecheck / lint / build 全绿。**

> 版本现状：三包锁步 **2.0.0 已于 2026-08-30 发版**（npm 上线、Release 已建）。此后 core 侧完成
> `createRouteForge` 工厂大重构（抽出 url-builder / auto-discovery / route-store / http-runner /
> bound-forge 五模块 + 理顺初始化时序，纯内部重构、零 API/行为变更，7 个本地提交尚未 push），
> vue/react 侧在做一轮同源维护。本轮三包锁步发 **2.1.0**（含层级静态化 / levelLoaded 收敛等
> 行为增强，走 minor）。

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
- `forge.ts`：`createRouteForge` 收敛为装配编排；实现拆到同目录五模块——`url-builder.ts`
  （buildRequestUrl 等纯函数）、`auto-discovery.ts`（摘要拉取/折算 + DiscoveryState）、
  `route-store.ts`（RouteStore：cache/inflight/失效代数 + 层级加载 + 虚拟 unassigned）、
  `http-runner.ts`（api/doApiCall + 拦截链 + 错误转换 + loading + 可 abort）、
  `bound-forge.ts`（createBoundForgeFactory 层级绑定构造）。懒加载、隔离缓存、并发去重、
  摘要端点自动发现（levels / eager / endpoint / url_prefix 后端权威）、`ready()` / `use()` /
  `BoundForge` 统一 API 表面、schemaVersion 向前兼容、批量 invalidate 等能力不变
- `interceptors.ts`：请求 LIFO / 响应 FIFO（对齐 axios），声明式 + 运行时两种注册
- `cache.ts`：memory / sessionStorage / localStorage，TTL = min(后端, 前端兜底)，storage 失败回退内存
- `adapters/`：auto 检测（动态 import 防静态打包）/ axios 包装 /
  builtin-http（零依赖 fetch，< 3KB，`requestRaw` 原始通道供元信息拉取）/ 自定义 Fetcher
- `codegen/`：CLI 完整实现（argv 解析、摘要自动发现、unassigned、写文件）
- `errors.ts`：RF_FE_001~010 错误体系
- 测试 224 个，覆盖：懒加载 / 自动发现 / 缓存 / 拦截器 / 调用 / adapter 全路径
  （auto 检测、降级、自定义 Fetcher）/ 取消 / 生命周期时序 / 类型推断回退

#### 3. Vue 3 插件（100%）
- `createRouteForgePlugin`（provide + `$forge.route` + ready）
- `useForge(level?, prefix?)`（levelLoaded → Ref<boolean>，覆盖 descriptor 对齐 core 为 configurable）
- `useForgeApi` / `useForgeRoute`（未加载返回 ''）；前缀绑定统一走 `useForge(level, prefix)`；
  `useForgeRoute` 的 level 为 setup 快照静态绑定（不支持动态 level，name/params 保持响应式）
- 测试 25 个全绿

#### 4. React 集成（100%）
- `RouteForgeProvider`（options 浅比较保证实例稳定）
- `useForge({ level?, prefix? })`（levelLoaded → boolean：`loadedRef` 单一真值源 + getter，
  仅在 effect / 异步回调（渲染提交后）写值并驱动重渲染，消除渲染期写 ref 的并发副作用；
  level 为静态绑定，切换层级请新建组件/实例）
- `useForgeApi` / `useForgeRoute`；前缀绑定统一走 `useForge({ level, prefix })`
- 测试 27 个全绿

#### 5. 文档（100%）
- 根 README：quick start（Vue + React 对等示例）+ 完整示例章节（真实项目调用流程：挂载时序 / 登录态 / 401 /
  层级绑定 / 取消 / 错误速查），并含"层级为静态绑定"契约说明、刷新 IIFE 体积数字、澄清 `pnpm lint` 实为类型检查
- core README：工具导出表 + 完整错误参考
- 三个包的 CHANGELOG（回溯 1.0.0 ~ 2.0.0 + Unreleased 区）

#### 6. 2026-08-28 审计与修复（测试审计驱动，232 → 273 用例）
- 移除 `effectiveStrict` 死代码：前端校验始终开启，`strict` 选项 @deprecated
  （SPEC §4.1.5 / §5.2 / §5.3 / §6.2 已同步修订）
- fix(react)：`levelLoaded` 改用 state 驱动，修复加载完成后不触发重渲染
- fix(core)：层级元信息拉取改走 `requestRaw`，不再经过业务拦截链（与 axios 路径对齐）
- fix(core)：adapter 非预期错误降级到 builtin 时保留 forge 拦截器管理器
- fix(core)：`BoundForge.levelLoaded` 加载失败保持 reject 语义，`onLevelLoaded`
  的 onRejected 分支可达
- 补齐审计缺口 39 个用例：adapter 全路径 / invalidate 竞态 / unassigned 真实层级 /
  useRoutePrefix / ready 语义（含失败 reject）/ abort 短路 / 类型推断等

#### 7. 2026-08-31 vue/react 同源维护（锁步 2.1.0）
- 承接 core `createRouteForge` 工厂大重构（见 §2，纯内部、零 API/行为变更，未 push）
- fix(react)：`useForge` 的 levelLoaded 由"渲染期写镜像 ref"改为 `loadedRef` 单一真值源 +
  getter，仅在 effect / 异步回调（渲染提交后）写值并驱动重渲染，消除并发渲染下的渲染期副作用
- refactor(vue)：`useForgeRoute` 的 level 明确为 setup 快照静态绑定，computed 不再重新求值 level，
  消除"level 变了但 load/levelLoaded 仍跟旧层级"的半吊子行为；name/params 保持响应式
- refactor(vue)：`useForge` 覆盖 levelLoaded 的 descriptor 由 `configurable:false` 改为 `true`，
  对齐 core BoundForge 与 React 适配层
- chore(react)：`useForgeApi` 窄断言替代 as any（既有），`useForgeRoute` 移除无效的
  `eslint-disable`（仓库未接 eslint，lint 实为 tsc）并补依赖说明注释
- docs：根 README 补对等 React 快速开始 + "层级静态绑定"契约说明、刷新 IIFE 体积（约 41 KB /
  19 KB / gzip 约 7 KB）、澄清 `pnpm lint`；schedule 同步
- 契约统一：三包所有 `useForge` / `useForgeApi` / `useForgeRoute` 的 `level`（及 `prefix`）为
  实例级静态绑定，不支持中途动态切换；换层级请新建组件 / 新建实例
- 当前基线：core 224 + vue 25 + react 27 = 276，全绿

---

### 待办

| 优先级 | 项目 | 说明 |
|--------|------|------|
| P1 | 2.1.0 锁步发版（本地已就绪） | 版本已定 2.1.0：三包 package.json 升 2.1.0、各 CHANGELOG `Unreleased` 已转正、按包拆细提交完成，全量 276 绿；唯一剩余动作 = push origin/main + 打 tag（`2.1.0` / `core-2.1.0` / `vue-2.1.0` / `react-2.1.0`）触发 CI publish —— 等用户指示 |
| P3 | 端到端示例项目（Laravel + Vue） | 已由根 README 完整示例章节替代；可运行示例暂缓 |
| P3 | 可视化面板（v1.x） | 未启动，按需排期（OpenAPI 桥接、Vite 插件因无真实使用场景已砍，不再列入路线图） |
| — | 后端侧待办 | Laravel 9/10/11 兼容矩阵实测（仅 13.x 验证过），见独立仓库 |
