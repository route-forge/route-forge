# Route Forge 进度快照

> 更新于 2026-08-28（v1.3.1 之后）。本文件是进度追踪文档，以代码实际状态为准。

**全部测试通过：core 181 + vue 26 + react 25 = 232 tests 全绿；typecheck / lint / build 全绿。**

---

## 项目总进度：~90%（npm 侧 v1.0 MVP 基本完成）

后端 Laravel 包在独立仓库 [route-forge-laravel](https://github.com/route-forge/route-forge-laravel)，
其进度（含 Laravel 9/10/11 兼容矩阵）在那边单独追踪。

### 已完成

#### 1. 工程脚手架（100%）
- pnpm workspace + turborepo + tsconfig.base 多包管理
- 三个 npm 包：`@route-forge/core` / `@route-forge/vue` / `@route-forge/react`
- tsup 构建：ESM + CJS + IIFE（含 min 生产版）、d.ts、codegen bin 入口
- CI 发布流水线（.github/workflows/publish.yml）、`pnpm publish:build` 一键发布

#### 2. 前端 Core 包（100%，v1.3.1）
- `forge.ts`：懒加载、隔离缓存、并发去重（inflight + 失效代数防旧数据回写）、
  摘要端点自动发现（levels / eager / endpoint / url_prefix 后端权威）、
  `api()` 内置 AbortController 可取消请求、`ready()` / `use()` / `BoundForge` 统一 API 表面、
  unassigned 虚拟层级、schemaVersion 向前兼容、批量 invalidate
- `interceptors.ts`：请求 LIFO / 响应 FIFO（对齐 axios），声明式 + 运行时两种注册
- `cache.ts`：memory / sessionStorage / localStorage，TTL = min(后端, 前端兜底)，storage 失败回退内存
- `adapters/`：auto 检测（动态 import 防静态打包）/ axios 包装 / builtin-http（零依赖 fetch，< 3KB）/ 自定义 Fetcher
- `codegen/`：CLI 完整实现（argv 解析、摘要自动发现、unassigned、写文件）
- `errors.ts`：RF_FE_001~010 错误体系
- 测试 181 个：forge 55 / url-building 23 / http-semantics 16 / cache 14 / builtin 12 / chain 12 / loading 12 / codegen 19 / errors 10 / axios 7 / interceptors 1

#### 3. Vue 3 插件（100%）
- `createRouteForgePlugin`（provide + `$forge.route` + ready）
- `useForge(level?, prefix?)`（levelLoaded → Ref<boolean>）
- `useForgeApi` / `useForgeRoute`（未加载返回 ''）/ `useForgeByPrefix`（智能前缀消解）
- 测试 26 个全绿

#### 4. React 集成（100%）
- `RouteForgeProvider`（options 浅比较保证实例稳定）
- `useForge({ level?, prefix? })`（levelLoaded → boolean）
- `useForgeApi` / `useForgeRoute` / `useForgeByPrefix`
- 测试 25 个全绿

#### 5. 2026-08-28 本轮修正
- 移除 `effectiveStrict` 死代码：前端校验始终开启（层级未声明必抛 `UnknownLevelError`），
  `strict` 选项标记 @deprecated（SPEC §4.1.5 / §5.2 / §5.3 / §6.2 已同步修订）
- SPEC §4.1.2：unassigned 虚拟层级 TTL 描述对齐实现（前端 `cache.ttl` 兜底，摘要契约无独立 cache 字段）

---

### 待办

| 优先级 | 项目 | 说明 |
|--------|------|------|
| P3 | 端到端示例项目（Laravel + Vue） | SPEC §7.3 定义的最小示例；README 已有较完整 quick start，示例项目暂缓 |
| P3 | v1.x 路线图 | 可视化面板（v1.1）/ OpenAPI 桥接（v1.2）/ Vite 插件（v1.3）—— 均未启动，按需排期 |
| — | 后端侧待办 | Laravel 9/10/11 兼容矩阵实测（仅 13.x 验证过），见独立仓库 |
