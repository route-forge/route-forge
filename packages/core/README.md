# @route-forge/core

框架无关的命名路由客户端核心：分级懒加载、隔离缓存、并发去重、拦截器。

## 安装

```bash
pnpm add @route-forge/core
# 可选：axios 适配器
pnpm add axios
```

## 基本用法

```ts
import { createRouteForge } from '@route-forge/core'

const forge = createRouteForge({
  endpoint: '/_forge/routes',
})

// 调用 API（自动加载层级 + 填充参数 + 发送请求）
const user = await forge.api('admin', 'users.show', { user: 123 })

// 生成 URL（仅拼路径，不发请求）
const url = forge.route('public', 'login.show')
// → '/login'

// url() 是 route() 的语义别名
const url2 = forge.url('public', 'login.show')

// 检查路由是否存在
forge.hasRoute('admin', 'users.show')  // true / false

// 获取路由元信息
const routes = forge.getRoutes('admin')          // 指定层级
const allRoutes = forge.getRoutes()              // 全部层级

// 检查层级是否已加载
if (!forge.isLoaded('admin')) {
  await forge.load('admin')
}

// 失效缓存
forge.invalidate('admin')                     // 失效指定层级
forge.invalidate(['admin', 'manage'])         // 批量失效多个层级
forge.invalidate()                            // 失效全部
```

## URL 前缀（`url_prefix`）

后端可在摘要端点 `config.url_prefix` 中下发 URL 前缀，前端生成路由 URL 时自动拼接，无需手动配置。

支持两种形式：

```ts
// 1. 路径前缀 — 拼接在 baseURL 之后、路由 URI 之前
// 后端返回 { "config": { "url_prefix": "/api/v1" } }
forge.route('public', 'users.show', { user: 1 })
// → '/api/v1/users/1'

// 2. 完整 URL（含协议+域名）— 直接作为基础 URL，忽略客户端 baseURL
//    适用于前后端不同域名的场景
// 后端返回 { "config": { "url_prefix": "https://api.example.com" } }
forge.route('public', 'users.show', { user: 1 })
// → 'https://api.example.com/users/1'
```

> `url_prefix` 为后端权威，前端不能覆盖。不下发或为空字符串时不影响 URL 生成。

## 参数智能解析

`forge.api()` 的第二参数支持四种数据类型：路径参数（平铺）、`query`（查询参数）、`body`（请求体）、`headers`
（请求头）。同时提供 `params` 固定 key 用于显式指定路径参数。

当路径参数名与 `query`/`body`/`headers` 冲突时，按类型智能消解：

```ts
// 向后兼容：原有写法不变
forge.api('admin', 'users.show', { user: 1, query: { include: 'posts' } })

// 冲突消解：query 为 string → 自动识别为路径参数
// 路由: /search/{query}
forge.api('admin', 'search.show', { query: 'keyword' })
// → URL: /search/keyword

// 显式 params：同时需要路径参数和 query string
forge.api('admin', 'search.show', {
  params: { query: 'keyword' },   // → 替换 {query}
  query: { page: 1 },             // → query string
  body: { detailed: true },       // → 请求体
})
```

规则：`params` 优先 > 平铺 `string|number` → 路径参数 > 对象类型按原定义（`query`/`body`/`headers`）。

## 单次超时覆盖

`forge.api()` 支持通过 `timeout` 参数覆盖单次请求的超时时间（毫秒），不传时使用
`createRouteForge({ timeout })` 的全局值（默认 30s）：

```ts
// 全局超时 30s，单次导出请求覆盖为 120s
forge.api('admin', 'reports.export', { timeout: 120_000 })
```

## 认证（Authentication）

Route Forge 不内置登录态管理，认证逻辑通过拦截器实现，灵活且完全可控。

### Token 注入

```ts
// 声明式（初始化时配置）
const forge = createRouteForge({
  endpoint: '/_forge/routes',
  interceptors: {
    request: [
      (config) => {
        const token = authStore.getToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
    ],
  },
})

// 或运行时动态注册
forge.interceptors.request.use((config) => {
  const token = authStore.getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
```

### 401 响应处理

```ts
forge.interceptors.response.use(
  (res) => res,  // 2xx 正常通过
  (err) => {
    if (err instanceof HTTPError && err.context?.status === 401) {
      authStore.logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)
```

### 登出清理

```ts
function logout() {
  authStore.clearToken()
  forge.invalidate()                        // 清空路由缓存
  forge.interceptors.request.clear()        // 清空拦截器
  forge.interceptors.response.clear()
}
```

> 拦截器 API 与 axios 完全一致（`use` / `eject` / `clear`），如果项目已使用 axios 拦截器，可跳过此节——
> `adapter: 'auto'` 模式下宿主 axios 的拦截器会自动生效。

## 加载状态跟踪

核心始终跟踪并发 API 请求的加载状态，无需配置。不需要使用时，不调用相关 API 即可。

```ts
// 查询当前是否处于加载中
forge.isLoading()  // boolean

// 订阅状态变更
const unsub = forge.onLoadingChange((event) => {
  console.log(event.loading)  // true / false
  console.log(event.count)    // 当前并发请求数
})

// 取消订阅
unsub()
```

> 加载状态始终跟踪，用户不使用则不订阅即可。Vue/React 包可通过 `onLoadingChange` 订阅状态变更驱动组件显隐。

## 初始化合时序与推荐模式

### 三种加载状态

| 类型           | 说明                           | 跟踪方式                    |
|----------------|--------------------------------|-----------------------------|
| Auto-discovery | 拉取摘要端点发现 levels/config | 内部 `autoDiscoveryPromise` |
| Level load     | 拉取某层级路由元数据           | `forge.isLoaded(level)`     |
| API request    | 业务接口请求                   | `forge.isLoading()`         |

### `onSummaryReady` 回调

推荐在回调中挂载应用，确保路由数据就绪：

```ts
const forge = createRouteForge({
  endpoint: '/_forge/routes',
  onSummaryReady: () => {
    // 摘要端点完成，路由数据已可用
    app.mount('#app')
  },
})
```

### `forge.ready()` 方法

auto-discovery + eager load 完成后 resolve，返回 `Promise<RouteForge>`（resolve 值为 forge 自身），适合 async/await 风格：

```ts
const forge = createRouteForge({ endpoint: '/_forge/routes' })

// 无参模式：直接 await
await forge.ready()
// 路由数据已就绪，可安全调用 route() / hasRoute()

// 回调模式：onFulfilled / onRejected
forge.ready(
  (f) => { console.log('ready!', f) },
  (err) => { console.error(err) }
)

// 链式调用：ready 返回 forge 自身
const bound = await forge.ready().then(f => f.use('admin'))
```

### `forge.use(level?, prefix?)` 层级绑定

`forge.use()` 是 core 层唯一的 level 绑定入口，返回 `BoundForge` 对象：

```ts
// 绑定层级 — 自动触发 load，提供快捷方法
const bound = forge.use('admin')
bound('users.show', { user: 1 })   // 可直接调用（= bound.api()）
bound.route('users.show')           // URL 生成
bound.level                         // → 'admin'
bound.levelLoaded                   // Promise<void>

// 绑定层级 + 前缀 — 路由名自动拼接
const bound = forge.use('admin', 'users')
bound('show', { user: 1 })           // → forge.api('admin', 'users.show', ...)

// BoundForge 独有方法
await bound.onLevelLoaded()          // 等待 level 加载完成
const prefixed = bound.useRoutePrefix('posts')  // 追加前缀
```

### IIFE 浏览器用法

通过 `<script>` 标签引入后，`RouteForge` 全局可用：

```html
<script src="https://unpkg.com/@route-forge/core"></script>
<script>
  const forge = RouteForge.createRouteForge({
    endpoint: '/_forge/routes',
  })

  // 等待就绪后绑定层级
  forge.ready().then(function(f) {
    const admin = f.use('admin')
    return admin.onLevelLoaded()
  }).then(function(bound) {
    return bound('users.show', { user: 1 })
  }).then(function(data) {
    console.log(data)
  })
</script>
```

### Auto-discovery 守卫

`route()` / `hasRoute()` 在 auto-discovery 未完成且无 explicit levels 时抛出
`ForgeError (RF_FE_010)`， 防止在路由数据未就绪时返回错误结果。`api()` 不受影响（内部自动 await
discovery）。

## 文档

- 仓库主页: https://github.com/route-forge/route-forge
- 设计文档: https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md

## License

MIT
