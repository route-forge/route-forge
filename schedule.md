
全部测试通过：**core 13 + vue 1 + laravel 13 = 27 tests / 49 assertions 全绿**。

---

## 项目总进度：~70%（v1.0 MVP 核心 P0 完成）

### 已完成（v1.0 MVP 核心 P0）

#### 1. 工程脚手架（100%）
- pnpm workspace + turborepo + tsconfig.base 多包管理
- npm 侧两个包：`@route-forge/core`（TS）、`@route-forge/vue`（Vue 3）
- Composer 侧已拆分至独立仓库：[`route-forge/laravel`](https://github.com/xyj2156/route-forge-laravel)
- MIT LICENSE 已加

#### 2. 后端 Laravel 包（100%）→ 已拆分至 [route-forge-laravel](https://github.com/xyj2156/route-forge-laravel)

- `ForgeServiceProvider.php`：注册 `->tier()` 宏、重绑 `router` 为 ForgeRouter、注册 RouteCache/TierResolver/RouteRepository 单例、注册元信息端点、发布 config
- `ForgeRouter.php`：覆盖 `updateGroupStack` + `mergeGroupAttributesIntoRoute`，解决 Laravel 11 `array_merge_recursive` 把嵌套 group 的 string tier 合并成 array 的坑
- `TierResolver.php`：5 级优先级（显式 tier → group 透传 → classifier → config match → fallback）
- `RouteRepository.php`：扫描 RouteCollection 按层级分组、隔离缓存
- `RouteMetadataController.php`：`GET /_forge/routes/{level}` + `ForgeExceptionContract` try/catch + HTTP 状态码映射
- 异常体系 4 个：RF_BE_001~004，全部实现 `ForgeExceptionContract`
- 后端测试 **13 tests 全绿**：GroupTier 5（tier 宏/group 透传/嵌套覆盖/优先级）+ Exceptions 2 + Endpoint 6（200 结构/level 隔离/未命名路由/404/500 strict/缓存命中）

#### 3. 前端 Core 包（~85%）
- [forge.ts](file:///f:/web/route-forge/packages/core/src/forge.ts)：`createRouteForge` 主入口，含懒加载、隔离缓存、**并发去重**（已实测验证无 bug）、登录态感知、strict 模式、`api(name, params)` 调用
- [interceptors.ts](file:///f:/web/route-forge/packages/core/src/interceptors.ts)：基于标准 Promise 链语义，API 完全匹配 axios（use/eject/clear），注册正序执行
- [cache.ts](file:///f:/web/route-forge/packages/core/src/cache.ts)：memory/sessionStorage/localStorage 三种 storage，TTL 后端 > 前端兜底
- [adapters/](file:///f:/web/route-forge/packages/core/src/adapters)：auto 检测 / builtin-http（fetch）/ axios 包装 / 自定义 Fetcher
- [errors.ts](file:///f:/web/route-forge/packages/core/src/errors.ts)：前端错误 RF_FE_001~008
- core 测试 **13 tests 全绿**：chain 12（拦截器串联）+ interceptors 1

#### 4. Vue 插件（~40%，仅脚手架）
- [plugin.ts](file:///f:/web/route-forge/packages/vue/src/plugin.ts)：`createRouteForgePlugin` + `useForge()` inject
- 4 个 composables 占位：`useForgeApi`/`useForgeLevel`/`useForgeRoute`/`useForgeByPrefix`
- 测试 1 个 smoke test

---

### 待完成（v1.0 剩余 30%）

| 优先级 | 项目 | 状态 |
|---|---|---|
| P1 | core 包 forge.ts 完整单测（懒加载/缓存/调用/strict/登录态） | 缺失 |
| P1 | Vue composables 完整实现 + 单测 | 仅占位 |
| P1 | codegen CLI 实现（argv 解析 + fetch + merge + 写文件） | [codegen/index.ts](file:///f:/web/route-forge/packages/core/src/codegen/index.ts) 仅 stub |
| P2 | Adapter 完整单测（auto/builtin/axios/自定义） | 缺失 |
| P2 | 三版本兼容矩阵实测（Laravel 11/12/13 + Testbench 9/10/11） | 仅 13.x 验证过 |
| P3 | 端到端示例项目（Laravel + Vue） | 缺失 |

---

## 本轮提交的核心实现逻辑

**本次会话累计实现的逻辑（最近这一段是 EndpointTest + inflight bug 验证）：**

1. **依赖注入**：`ForgeServiceProvider::registerBindings()` 绑定 RouteCache（按 `forge.cache_driver` 选 store）、TierResolver（levels+classifier+strict+fallback）、RouteRepository（router+tierResolver+cache+levelsConfig）三个单例

2. **端点异常映射**：`RouteMetadataController::show()` 加 `try/catch ForgeExceptionContract`，异常返 `{error:{code,message,level}}` + `e->httpStatus()`

3. **6 个端点测试**：200+结构 / level 隔离 / 未命名路由 / 404 (RF_BE_002) / 500 strict (RF_BE_001) / 缓存命中

4. **并发去重验证**：用户报告 inflight 缓存设置 bug → 写测试实测 → **bug 不存在**（inflight 已保存含 `cache.set` 的完整 Promise，p resolve 时 cache 已写）→ 未改代码
