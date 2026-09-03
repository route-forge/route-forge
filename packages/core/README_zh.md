# @route-forge/core

[English](./README.md) | **中文**

框架无关的 Laravel 命名路由前端客户端核心：从后端 manifest 端点拉取路由元信息，按层级（level）懒加载与隔离缓存，用**路由名**调用 API、生成 URL，全程 TypeScript 类型保护，拦截器行为与 axios 一致。

## 它能做什么

- **按路由名调用 API**：`forge.api('admin', 'users.show', { user: 123 })`，不再硬编码路径
- **分级懒加载**：路由元信息按层级（如 `public` / `admin`）分组拉取，首屏只加载需要的层级
- **隔离缓存 + 并发去重**：每层级独立缓存（memory / sessionStorage / localStorage，TTL 过期），同层级并发拉取自动合并为一次请求
- **自动发现**：启动时拉取摘要端点，自动发现层级列表、eager 预加载层级、URL 前缀等配置
- **拦截器**：请求 / 响应拦截链，`use` / `eject` / `clear` 与 axios API 一致（请求 LIFO、响应 FIFO）
- **请求取消**：`forge.api()` 返回的 `ForgeRequest` 自带 `abort()`，与超时协同工作
- **加载状态跟踪**：并发请求计数 + 订阅，可直接驱动全局加载指示
- **类型安全**：`ForgeRouteMap` 二级映射（codegen 生成或模块增强），路由名 → 参数 → 响应编译期校验
- **多传输适配**：内置零依赖 `fetch` 实现（默认），可复用宿主 axios，或传入自定义 `Fetcher`
- **浏览器直接引入**：提供 IIFE 构建，`<script>` 标签即用，无需打包工具

## 安装

```bash
pnpm add @route-forge/core
# 可选：宿主安装了 axios 且 adapter 为 'auto'（默认）时会自动复用；
# 也可显式安装以便强制使用（'axios' 模式）
pnpm add axios
```

## 快速开始

```ts
import { createRouteForge } from '@route-forge/core'

const forge = createRouteForge({
  endpoint: '/_forge/routes',   // 后端 manifest 端点
})

// 调用 API（自动发现层级 → 自动加载层级 → 填充路径参数 → 发送请求）
const user = await forge.api('admin', 'users.show', { user: 123 })

// 生成 URL（仅拼路径，不发请求）
const url = forge.route('public', 'login.show')   // → '/login'
const url2 = forge.url('public', 'login.show')    // url() 是 route() 的语义别名

// 检查路由是否存在 / 获取路由元信息
forge.hasRoute('admin', 'users.show')             // true / false
forge.getRoutes('admin')                          // 指定层级的路由表快照（深拷贝）
forge.getRoutes()                                 // 全部已加载层级（按 level 分组）

// 层级加载与缓存管理
await forge.load('admin')                         // 加载层级（并发自动去重）
forge.isLoaded('admin')                           // 层级是否已缓存
forge.invalidate('admin')                         // 失效指定层级
forge.invalidate(['admin', 'manage'])             // 批量失效
forge.invalidate()                                // 失效全部
```

## 初始化时序与 `ready()`

`createRouteForge()` 返回后立即在后台启动 **auto-discovery**（拉取摘要端点），随后预加载 **eager** 层级。
`ready()` 在两者全部完成后 resolve（resolve 值为 forge 自身，支持链式调用）：

```ts
const forge = createRouteForge({ endpoint: '/_forge/routes' })

// 推荐：ready() 后再挂载应用（此时 route()/hasRoute() 等同步方法即刻可用）
forge.ready()
  .then(() => app.mount('#app'))
  .catch((err) => {
    // 失败必须接住：摘要端点不可达且未显式传 levels 时 ready() 会 reject，
    // 否则用户面对静默白屏
    console.error('[route-forge] init failed', err)
  })

// 回调模式：onFulfilled / onRejected（仍返回 Promise）
forge.ready(
  (f) => console.log('ready!', f),
  (err) => console.error(err),
)

// async/await 风格
await forge.ready()
```

三种加载状态及其跟踪方式：

| 阶段 | 说明 | 跟踪方式 |
|------|------|----------|
| Auto-discovery | 拉取摘要端点，发现 levels/config | `forge.ready()` |
| Level load | 拉取某层级路由元数据 | `forge.isLoaded(level)` / `bound.onLevelLoaded()` |
| API request | 业务接口请求 | `forge.isLoading()` / `forge.onLoadingChange()` |

**降级规则**：显式传了 `levels` 时，摘要端点不可达会 `console.warn` 并降级使用显式配置；未传 `levels` 则无降级可用，`ready()` reject（错误为 `HTTPError` / `NetworkError` / `UnknownLevelError`）。

**守卫**：auto-discovery 未完成且无显式 `levels` 时，`route()` / `hasRoute()` 抛 `ForgeError (RF_FE_010)`，防止在路由数据未就绪时返回错误结果；`api()` 不受影响（内部自动等待发现完成）。

## 配置选项（`createRouteForge(options)`）

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `endpoint` | `string` | — | 摘要/manifest 端点路径（网络来源）。可选：`endpoint`、`summary`、页面内嵌 `window.__ROUTE_FORGE__` 三者必有一，否则 `createRouteForge` 抛 `TypeError` |
| `summary` | `SummaryResponse` | — | 直接提供摘要数据（测试 / 非全局引导），跳过摘要 HTTP；优先级低于页面内嵌 `window.__ROUTE_FORGE__` |
| `levels` | `string[]` | 自动发现 | 不传时从摘要自动发现；显式传入时取与后端摘要的**交集**（前端不能声明后端不存在的层级） |
| `eager` | `string[]` | 后端 `load:'eager'` 层级 | 预加载层级；显式传入时与后端标记取**并集** |
| `adapter` | `'auto' \| 'axios' \| 'builtin' \| Fetcher` | `'auto'` | 见下方「Adapter 适配」 |
| `cache.ttl` | `number`（秒） | `3600` | 前端兜底 TTL；后端全局 `config.cache_ttl` 为上限，实际取 `min(后端, 前端)`（前端只能缩短不能延长，`0` 永久，`config.cache_ttl: null` 不缓存） |
| `cache.storage` | `'memory' \| 'sessionStorage' \| 'localStorage'` | `'memory'` | 缓存介质；storage 模式维护内存镜像并通过 `storage` 事件感知跨 tab 失效 |
| `interceptors.request` | 数组 | 无 | 声明式请求拦截器：单函数（视为 `onFulfilled`）或 `[onFulfilled?, onRejected?]` 元组 |
| `interceptors.response` | 数组 | 无 | 声明式响应拦截器，形式同上 |
| `timeout` | `number`（毫秒） | `30000` | 全局超时；单次请求可用 `params.timeout` 覆盖 |
| `baseURL` | `string` | `''` | 拼接在所有生成 URL 之前的基础地址 |
| `strict` | `boolean` | — | **已废弃，传入无效**。前端校验始终开启（层级未声明抛 `UnknownLevelError`、路由名不存在抛 `UnknownRouteError`、必填参数缺失抛 `MissingRouteParamError`），静默忽略会掩盖拼写错误。后端的 `strict_mode` 是 manifest 生成侧语义，与前端无关 |

## 内嵌引导（可选 hydration）

摘要发现按级联只取一个来源：**页面内嵌 `window.__ROUTE_FORGE__` → `createRouteForge({ summary })` → 网络 `GET {endpoint}`**，三者投递的是同一份 `SummaryResponse`。

对 Laravel/Blade 服务端直出的首页，后端 `@forgeSummary` 指令把摘要内联为一个一次性、不可枚举、读后自删的 `window.__ROUTE_FORGE__` 访问器。core 命中它时**跳过摘要 HTTP 往返、同步完成 discovery**——`createRouteForge()` 返回后 `route()` / `ready()` 立即可用，消除首屏"路由未就绪"闪烁。层级路由表**仍按 level 走 HTTP 懒加载**（受保护路由不进公开 HTML）。core 的 module 级 memo 让第二个实例（React StrictMode / 第二个 Provider）在全局自删后仍能复用摘要。

若页面无内嵌（SPA 独立部署 / Vite dev），core 自动回落网络摘要。`createRouteForge({ summary })` 是显式、便于测试/SSR 的入口。当摘要完全来自内嵌时，`options` 参数本身也可省略——直接 `createRouteForge()` 无参调用。

> 诚实边界：一次性自删只缩小摘要在 `window` 上的运行时驻留面，数据仍随 HTML 源码可见；这是延迟/闪烁优化，**不是**抗 XSS 或抗网络窃取的硬边界。

## 参数智能解析

`forge.api(level, name, params)` 的第三个参数 `params` 支持四类数据：路径参数（平铺）、`query`（查询参数）、`body`（请求体）、`headers`（请求头），外加 `timeout`（单次超时）与 `params`（显式路径参数固定 key）：

```ts
// 平铺路径参数 + 查询参数
forge.api('admin', 'users.show', { user: 1, query: { include: 'posts' } })

// 冲突消解：路由 /search/{query} —— query 为 string 时自动识别为路径参数
forge.api('admin', 'search.show', { query: 'keyword' })
// → URL: /search/keyword

// 显式 params：同时需要路径参数和 query string（params 优先级最高）
forge.api('admin', 'search.show', {
  params: { query: 'keyword' },   // → 替换 {query} 占位符
  query: { page: 1 },             // → query string
  body: { detailed: true },       // → 请求体
  headers: { 'X-Trace': 'a1' },   // → 请求头
  timeout: 120_000,               // → 单次超时覆盖（默认 30s）
})
```

解析规则（按优先级）：

1. `params` 显式指定 → 路径参数，优先级最高
2. 其余平铺 key → 路径参数（不覆盖 `params` 中已有的 key）
3. 固定 key 按值类型消解：`query` / `headers` 为对象 → 固定用途，为 `string|number` → 路径参数；`body` 为非 `string|number` → 请求体，为 `string|number` → 路径参数
4. 可选参数（URI 中 `{param?}`）缺省时替换为空并清理多余 `/`；后端下发的 `parameter_defaults` 在参数缺省时自动兜底

## URL 前缀（`url_prefix`）

后端可在摘要端点 `config.url_prefix` 中下发 URL 前缀，前端生成路由 URL 时自动拼接，无需手动配置：

```ts
// 1. 路径前缀 — 拼接在 baseURL 之后、路由 URI 之前
// 后端返回 { "config": { "url_prefix": "/api/v1" } }
forge.route('public', 'users.show', { user: 1 })   // → '/api/v1/users/1'

// 2. 完整 URL（含协议+域名）— 直接作为基础 URL，忽略客户端 baseURL
//    适用于前后端不同域名的场景
// 后端返回 { "config": { "url_prefix": "https://api.example.com" } }
forge.route('public', 'users.show', { user: 1 })   // → 'https://api.example.com/users/1'
```

> `url_prefix` 为后端权威，前端不能覆盖。不下发或为空字符串时不影响 URL 生成。

## 层级绑定：`forge.use(level, prefix?)`

`use()` 是唯一的 level 绑定入口，返回 `BoundForge`——Vue / React / IIFE 共享同一套 API 表面：

```ts
// 绑定层级 — 自动触发 load，提供快捷方法
const bound = forge.use('admin')
bound('users.show', { user: 1 })      // 可直接调用（= bound.api()）
bound.route('users.show')             // URL 生成
bound.level                           // → 'admin'
bound.levelLoaded                     // Promise<void>（core 层；Vue/React 各自特化）

// 绑定层级 + 前缀 — 路由名自动拼接（歧义时智能消解：优先 prefix.suffix，回退 suffix 本身）
const users = forge.use('admin', 'users')
users('show', { user: 1 })            // → forge.api('admin', 'users.show', ...)

// BoundForge 其余方法
await bound.onLevelLoaded()           // 等待 level 加载完成（支持回调形式）
bound.hasRoute('users.show')          // 绑定层级内的路由检查
bound.useRoutePrefix('posts')         // 以新前缀返回新的 BoundForge（原绑定不变）
// 通用方法均作用于绑定层级：bound.load() / bound.invalidate() / bound.isLoaded()
// 全局方法照常可用：bound.isLoading() / bound.onLoadingChange()
```

> `use()` 每次调用都返回新的 `BoundForge`（不缓存）；`forge.use()` 不传参时返回 forge 自身。

## 请求取消

`forge.api()` 返回 `ForgeRequest`——继承 `Promise`，附加 `abort()` 方法，内部自动管理 `AbortController`：

```ts
const req = forge.api('admin', 'reports.export', { timeout: 120_000 })
req.abort()   // 请求被中止，Promise reject 为 RequestAbortedError（RF_FE_009）
```

`abort()` 与超时（`AbortSignal.timeout`）互不冲突，任一触发都会取消请求。拦截器中可通过 `config.signal` 读取 AbortSignal。

## 拦截器与认证

拦截器 API 与 axios 一致（`use` / `eject` / `clear`）；请求拦截器 **LIFO**（后注册先执行），响应拦截器 **FIFO**。Route Forge 不内置登录态管理，认证通过拦截器实现：

```ts
// 声明式（初始化时配置）
const forge = createRouteForge({
  endpoint: '/_forge/routes',
  interceptors: {
    request: [
      (config) => {
        const token = authStore.getToken()
        if (token) config.headers.Authorization = `Bearer ${token}`
        return config   // 必须返回 RequestConfig 对象，否则抛 RF_FE_006
      },
    ],
    response: [
      (resp) => resp.data,                    // 统一解包：api() 直接 resolve 业务数据
      [undefined, (err) => {                  // 元组形式：[onFulfilled?, onRejected?]
        if (err instanceof HTTPError && err.context?.status === 401) {
          authStore.logout()
          window.location.href = '/login'
        }
        return Promise.reject(err)
      }],
    ],
  },
})

// 运行时动态注册 / 移除 / 清空
const id = forge.interceptors.request.use((config) => { /* ... */ return config })
forge.interceptors.request.eject(id)
forge.interceptors.request.clear()
forge.interceptors.response.clear()
```

**登出清理**示例：

```ts
function logout() {
  authStore.clearToken()
  forge.invalidate()                     // 清空路由缓存
  forge.interceptors.request.clear()     // 清空拦截器
  forge.interceptors.response.clear()
}
```

> `adapter: 'auto'` 复用宿主 axios 时，宿主已注册的 axios 拦截器会先执行，Route Forge 拦截器在其后执行。
> 元信息拉取（摘要 / 层级路由表）走 adapter 原始通道，不经过业务拦截链，避免被解包类拦截器干扰。

## 加载状态跟踪

核心始终跟踪并发 API 请求的加载状态，无需配置；不需要时不调用相关 API 即可：

```ts
forge.isLoading()   // boolean：是否仍有在途请求

const unsub = forge.onLoadingChange((event) => {
  console.log(event.loading)  // true / false
  console.log(event.count)    // 当前并发请求数
})
unsub()   // 取消订阅
```

Vue / React 包可基于 `onLoadingChange` 驱动组件级加载指示。

## 类型安全（可选但推荐）

`ForgeRouteMap` 是「层级 → 路由名 → 元信息」的二级映射接口。定义后，`useForge` / `useForgeApi` / `bound()` 等调用的 **level / 路由名 / params 全部自动推断**，拼错路由名在编译期即报错。

两种定义方式：

```bash
# 方式一：codegen CLI（拉取后端 manifest 生成 .d.ts）
npx route-forge-codegen \
  --endpoint http://localhost/_forge/routes \
  --out src/types/forge-routes.d.ts \
  [--levels public,admin] [--responseTypes path/to/map.json]
```

```ts
// 方式二：TypeScript 模块增强（手写或配合后端 Artisan 命令 route:forge:types 的产物）
declare module '@route-forge/core' {
  interface ForgeRouteMap {
    admin: {
      'users.show': { method: 'GET'; params: { user: string | number }; response: User }
      'users.index': { method: 'GET'; params: {}; response: User[] }
    }
  }
}
```

后端 Laravel 包（[route-forge/route-forge-laravel](https://github.com/route-forge/route-forge-laravel)）另提供 `php artisan route:forge:types` 生成同一结构的类型文件。

## 未分配层级（`unassigned`）

后端未标记层级的路由归属一个特殊的 `unassigned` 层级——后端**恒在摘要 `levels` 中注入它**。前端把它与普通层级一视同仁，按 `levels.unassigned.route.uri` 走 HTTP 懒加载：

```ts
await forge.load('unassigned')
const data = await forge.api('unassigned', 'some.route')
```

## Adapter 适配

| `adapter` 取值 | 行为 |
|----------------|------|
| `'auto'`（默认） | 动态 `import('axios')` 探测宿主：检测到则复用（继承宿主拦截器 / defaults 配置），否则使用内置 `builtin` |
| `'axios'` | 强制宿主 axios，未安装抛 `AdapterNotFoundError`（RF_FE_005） |
| `'builtin'` | 强制内置 fetch 实现（零依赖、min+gzip < 3KB、拦截器行为与 axios 一致） |
| 自定义 `Fetcher` | 传入实现 `request(config): Promise<ResponseData>` 的对象，完全自定义 |

请求体为 `FormData` / `Blob` / `ArrayBuffer` / `URLSearchParams` / `ReadableStream` 时自动跳过 JSON 序列化（`string` 也原样透传）。

## IIFE 浏览器用法

通过 `<script>` 标签引入后，全局变量 `RouteForge` 可用：

```html
<!-- 生产版（压缩，约 19 KB / gzip 约 7 KB） -->
<script src="https://unpkg.com/@route-forge/core/dist/route-forge.global.min.js"></script>
<script>
  const forge = RouteForge.createRouteForge({ endpoint: '/_forge/routes' })
  forge.ready().then(function (f) {
    const admin = f.use('admin')
    return admin.onLevelLoaded().then(function () {
      return admin('users.show', { user: 1 })
    })
  }).then(function (data) {
    console.log(data)
  })
</script>
```

> 必须引用 `dist/` 下的 IIFE 产物；unpkg 裸包名会解析到 CJS 主入口，浏览器无法直接执行。

## 错误参考

所有错误均为 `ForgeError` 子类，携带稳定的 `code` 字段（`ForgeErrorCode` 字面量联合），可按 `code` 分支处理（`switch` 可获穷尽检查）：

| 错误类 | code | 触发场景 |
|--------|------|----------|
| `UnknownRouteError` | `RF_FE_001` | 路由名不存在于已加载层级中 |
| `UnknownLevelError` | `RF_FE_002` | 层级未在 levels 声明（前端校验始终开启） |
| `MissingRouteParamError` | `RF_FE_003` | 必填路径参数缺失（无后端默认值）；路径参数传入对象同样报此码 |
| `AdapterNotFoundError` | `RF_FE_005` | `adapter: 'axios'` 但宿主未安装 / 无有效 axios |
| `InvalidInterceptorReturnError` | `RF_FE_006` | 请求拦截器未返回 RequestConfig 对象 |
| `NetworkError` | `RF_FE_007` | 网络层失败（DNS、连接被拒等），`cause` 保留原始错误 |
| `HTTPError` | `RF_FE_008` | HTTP 非 2xx，`context.status` 为状态码 |
| `RequestAbortedError` | `RF_FE_009` | 请求被 `abort()` / AbortSignal 取消 |
| `ForgeError`（守卫） | `RF_FE_010` | auto-discovery 未完成时调用 `route()` / `hasRoute()` |

错误对象结构：

```ts
{
  code: 'RF_FE_008',                     // 稳定错误码
  route?: string,                        // 关联路由名
  level?: string,                        // 关联层级
  context?: Record<string, unknown>,     // 附加上下文（如 HTTP 状态码、url、method）
  cause?: unknown,                       // 原始底层错误
}
```

## 工具导出

除 `createRouteForge` 外，core 包还导出以下工具件，供高级场景按需使用：

| 导出 | 说明 |
|------|------|
| `createInterceptorManager` | 创建拦截器管理器（`use`/`eject`/`clear`），供自定义 Fetcher 复用统一拦截器实现 |
| `RouteCache` | 按层级隔离的路由缓存类（memory / sessionStorage / localStorage，TTL 过期），可独立使用 |
| `LoadingTracker` | 加载状态跟踪器（引用计数 + 订阅），框架适配层可基于它实现全局加载指示 |
| `resolveRouteName` | 前缀歧义异步消解（`prefix.suffix` 优先，回退后缀本身），`api()` 调用路径使用 |
| `resolveRouteNameSync` | 前缀歧义同步消解（基于已加载缓存），`route()` / `url()` 调用路径使用 |

类型导出：`RouteForge` / `RouteForgeOptions` / `BoundForge` / `ApiCallParams` / `RequestConfig` / `ResponseData` / `ForgeRequest` / `Fetcher` / `RouteMeta` / `SummaryResponse` / `ForgeRouteMap` / `ForgeErrorCode` 等（完整清单见 `dist/index.d.ts`）。

## 常见问题

**`route()` / `hasRoute()` 抛 `RF_FE_010`？**
auto-discovery 尚未完成。等待 `await forge.ready()` 后再调用，或改用框架包的 `useForgeRoute`（内部处理加载态，未加载时返回 `''`）。

**`ready()` reject 了怎么办？**
摘要端点不可达且未显式传 `levels` 时 `ready()` 会 reject。要么修复端点连通性，要么显式传 `levels` 获得降级能力（摘要失败时退回显式配置）。

**响应没有被 `resp.data` 解包？**
解包是响应拦截器行为，需要自行注册 `(resp) => resp.data`；core 默认 resolve 完整的 `ResponseData` 经拦截链后的末段返回值。

**跨标签页缓存不同步？**
`storage` 模式（sessionStorage / localStorage）通过 `storage` 事件自动失效其他 tab 写入的缓存镜像；`memory` 模式仅当前页可见。

## 文档

- 仓库主页: <https://github.com/route-forge/route-forge>
- 设计文档: <https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md>
- 规范: <https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md>
- 后端包（Laravel）: <https://github.com/route-forge/route-forge-laravel>

## License

MIT
