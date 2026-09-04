# Route Forge

[English](./README.md) | **中文**

**Laravel 命名路由的全链路解决方案** — 分级懒加载 · 类型安全 · 拦截器

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

前端调用 API 应该表达"我要做什么"，而不是"我要去哪里"。

```ts
// ✅ 意图驱动 — Route Forge
const user = await forge.api('admin', 'users.show', { user: 123 })

// ❌ 位置驱动 — 传统方式
const user = await axios.get('/admin/users/123')
```

Route Forge 从 Laravel 路由注册表读取命名路由，按层级分组下发给前端。前端按需懒加载、缓存隔离、命名调用，全程
TypeScript 类型保护。

## 核心特性

| 特性           | 说明                                                                           |
|----------------|--------------------------------------------------------------------------------|
| **分级懒加载** | 路由按层级（如 `public` / `client` / `admin`）分组，前端按需拉取，优化首屏性能 |
| **隔离缓存**   | 每层级缓存独立存放，互不污染，支持 memory / sessionStorage / localStorage      |
| **并发去重**   | 同层级并发请求自动合并为一次，避免首屏请求雪崩                                 |
| **拦截器**     | 请求 / 响应拦截链，与 axios 行为一致（LIFO / FIFO），支持声明式注册和动态管理  |
| **请求取消**   | `forge.api()` 返回的 `ForgeRequest` 自带 `abort()`，与 timeout 协同工作        |
| **类型安全**   | 后端 Artisan 命令生成 TS 类型声明，路由名 → 参数 → 响应全链路编译期校验        |
| **未分配层级** | 后端未标记层级的路由归入后端恒注入摘要的 `unassigned` 层级，与其它层级一样按 HTTP 懒加载          |
| **内嵌引导**   | Laravel/Blade 直出页可把摘要内联为一次性 `window.__ROUTE_FORGE__`，core 省掉摘要网络往返、同步就绪；无内嵌时自动回落网络摘要 |
| **零侵入**     | 后端通过 Laravel macro 和 ServiceProvider 扩展，不修改框架核心                 |
| **浏览器可用** | core 包提供 IIFE 构建，`<script>` 标签直接引入，无需打包工具                   |

## 项目结构

本仓库（[route-forge/route-forge](https://github.com/route-forge/route-forge)）包含 npm 侧的前端包：

```
route-forge/
├── packages/
│   ├── core/       # @route-forge/core — 框架无关的命名路由客户端核心
│   ├── vue/        # @route-forge/vue — Vue 3 集成（插件 + composable + 组件）
│   └── react/      # @route-forge/react — React 集成（Provider + hooks + 组件）
├── .docs/
│   ├── SPEC.md     # 功能规格说明书
│   └── DESIGN.md   # 设计思路
└── ...
```

后端包（Composer）位于独立仓库：[route-forge/route-forge-laravel](https://github.com/route-forge/route-forge-laravel)。

两侧通过 HTTP manifest 契约交互，版本独立演进。

## 快速开始

### 1. 后端安装（Laravel）

```bash
composer require route-forge/laravel
```

在 `routes/web.php` 或 `routes/api.php` 中为路由标记层级：

```php
// 方式一：显式标记
Route::post('/auth/login', [AuthController::class, 'login'])
    ->name('auth.login')
    ->tier('public');

// 方式二：分组继承
Route::group(['prefix' => 'admin', 'middleware' => ['auth', 'admin'], 'tier' => 'admin'], function () {
    Route::get('/users', [UserController::class, 'index'])->name('admin.users.index');
    Route::get('/users/{user}', [UserController::class, 'show'])->name('admin.users.show');
});
```

在 `config/forge.php` 中配置层级规则（支持按前缀、中间件批量匹配）：

```php
return [
    'levels' => [
        'public' => [
            'match' => ['prefix' => ['auth', 'public']],
            'load'  => 'eager',
            'cache' => 3600,
        ],
        'admin' => [
            'match' => ['prefix' => ['admin'], 'middleware' => ['auth', 'admin']],
            'load'  => 'lazy',
        ],
    ],
];
```

### 2. 前端安装

```bash
# 核心包（必须）
pnpm add @route-forge/core

# Vue 3 集成（可选）
pnpm add @route-forge/vue

# React 集成（可选）
pnpm add @route-forge/react

# axios 适配器（可选，不装则使用内置 fetch 实现）
pnpm add axios
```

**不使用打包工具？** core 包提供浏览器直接引入的 IIFE 构建：

```html
<!-- 开发版（引用外部 sourcemap，约 41 KB） -->
<script src="https://unpkg.com/@route-forge/core/dist/route-forge.global.js"></script>
<!-- 生产版（压缩，约 19 KB / gzip 约 7 KB） -->
<script src="https://unpkg.com/@route-forge/core/dist/route-forge.global.min.js"></script>

<script>
  const forge = RouteForge.createRouteForge({ endpoint: '/_forge/routes' })
  forge.api('admin', 'users.show', { user: 123 }).then(console.log)
</script>
```

### 3. 前端使用

#### 纯 Core 用法

```ts
import { createRouteForge } from '@route-forge/core'

const forge = createRouteForge({
  endpoint: '/_forge/routes',
})

// 调用 API — 自动加载层级 + 填充参数 + 发送请求
const user = await forge.api('admin', 'users.show', { user: 123 })

// 生成 URL — 仅拼路径，不发请求
const url = forge.route('public', 'login.show')
// → '/login'

// 手动管理层级加载
await forge.load('admin')
forge.invalidate('admin')

// 请求取消：ForgeRequest 自带 abort()，无需自行管理 AbortController
const req = forge.api('admin', 'users.show', { user: 123 })
req.abort()  // 取消请求，Promise reject 为 RequestAbortedError

// 未分配层级 — 后端未标记 tier 的路由归入恒存在的 'unassigned' 真实层级（按 HTTP 懒加载）
await forge.load('unassigned')
const data = await forge.api('unassigned', 'some.route')
```

参数支持智能消解：路径参数平铺传入，`query`/`body`/`headers` 为固定 key。路径参数名与固定 key 冲突时，
`string|number` 值自动识别为路径参数，也可通过 `params` 显式指定：

```ts
// 路由: /search/{query}
forge.api('admin', 'search.show', { query: 'keyword' })           // query → 路径参数
forge.api('admin', 'search.show', { params: { query: 'keyword' }, query: { page: 1 } }) // 显式指定
```

#### Vue 3 集成

```ts
// main.ts
import { createApp } from 'vue'
import { createRouteForgePlugin } from '@route-forge/vue'

const app = createApp(App)
const plugin = createRouteForgePlugin({
  endpoint: '/_forge/routes',
})
app.use(plugin)
// 推荐：ready()（摘要 + eager 层级完成）后再挂载，失败接住避免静默白屏
plugin.ready()
  .then(() => app.mount('#app'))
  .catch((err) => console.error('[route-forge] init failed', err))
```

```vue
<script setup lang="ts">
  import { useForge, useForgeApi, useForgeRoute } from '@route-forge/vue'

  // 绑定层级 — 后续调用无需再传 level
  const forge = useForge('admin')
  const user = await forge('users.show', { user: 1 })

  // 绑定层级 + 前缀 — 路由名自动拼接
  const userForge = useForge('admin', 'users')
  const user2 = await userForge('show', { user: 1 })  // → admin.users.show

  // 带 loading / error 状态的 API 调用（同样支持 level 绑定和前缀）
  const { call, pending, error } = useForgeApi('admin')
  const { data } = await call('users.show', { user: 1 })

  const { call: callUser } = useForgeApi('admin', 'users')
  const { data: user3 } = await callUser('show', { user: 1 })

  // 模板里的响应式 URL：未加载返回 ''、加载后自动更新（优先于 $forge）
  const loginUrl = useForgeRoute('public', 'login.show')
</script>

<template>
  <a :href="loginUrl">登录</a>

  <!-- 或现成的链接组件：层级加载中渲染 loading 插槽（或不渲染），加载后渲染链接
       （安装了 vue-router 时自动升级为 <RouterLink>） -->
  <ForgeLink level="public" name="login.show">登录</ForgeLink>
</template>
```

> Vue / React 包还提供封装 `useForgeRoute` 的 `ForgeRoute` / `ForgeLink` 组件
> （loading 插槽 / render-prop、控制台提示、路由库链接集成）——详见各包 README。

#### React 集成

```tsx
// main.tsx
import { createRoot } from 'react-dom/client'
import { RouteForgeProvider } from '@route-forge/react'

createRoot(document.getElementById('root')!).render(
  <RouteForgeProvider options={{ endpoint: '/_forge/routes' }}>
    <App />
  </RouteForgeProvider>,
)
```

```tsx
// App.tsx —— 与 Vue 对等的能力，差异在 React 用选项对象、params 传普通对象
import { useForge, useForgeApi, useForgeRoute } from '@route-forge/react'

export default function App() {
  // 绑定层级 — 后续调用无需再传 level
  const forge = useForge({ level: 'admin' })

  // 绑定层级 + 前缀 — 路由名自动拼接
  const userForge = useForge({ level: 'admin', prefix: 'users' })

  // 带 loading / error 状态的 API 调用（同样支持层级绑定和前缀）
  const { call, pending, error } = useForgeApi({ level: 'admin' })
  const { call: callUser } = useForgeApi({ level: 'admin', prefix: 'users' })

  // 响应式 URL 生成器：渲染期专用，未加载返回 ''、加载后自动更新、参数变化重算
  const detailUrl = useForgeRoute('admin', 'users.show', { user: 1 })

  // 或现成的链接组件：层级加载中渲染 loading（或不渲染），加载后渲染链接；
  // as 可注入任意路由库 Link（react-router / next/link）做 SPA 跳转
  // <ForgeLink as={RouterLink} level="admin" name="users.show" params={{ user: 1 }}>查看用户</ForgeLink>

  // 命令式调用放在事件处理里（不能在渲染期 await）
  async function load() {
    const user = await forge('users.show', { user: 1 })
    const user2 = await userForge('show', { user: 1 })       // → admin.users.show
    const { data } = await call('users.show', { user: 1 })
    const { data: user3 } = await callUser('show', { user: 1 })
  }

  return <a href={detailUrl}>查看用户</a>
}
```

> **层级是静态绑定**：`useForge` / `useForgeApi` / `useForgeRoute` 的 `level`（及 `prefix`）在实例创建时固定，
> 不支持中途动态切换 level（换 level 会让 `prefix` 失去绑定意义）。需要另一个层级时，请新建组件 / 新建一次实例，
> 开销可接受。Vue、React 两包契约一致。

> **关于 Vue 的 `$forge` 全局属性**：插件会注入 `$forge.route()`，但它只在对应 level 加载完成后（如 `ready()` 之后）
> 才可安全调用，渲染期层级未就绪会抛错、不可控。模板里生成链接请用 `useForgeRoute`（自动处理加载态、错误降级为 `''`）。

### 4. 类型生成（可选）

后端 Artisan 命令从路由注册表生成 TS 类型声明，编译期校验路由名和参数：

```bash
php artisan route:forge:types --out=../frontend/src/types/forge-routes.d.ts
```

生成的类型文件包含二级映射 `ForgeRouteMap`（level → routeName → meta），通过 TypeScript 模块增强自动生效：

```ts
// 生成后，路由名错拼在编译期即报错，参数类型自动推断
forge.api('admin', 'users.show', { user: 123 })  // ✅ OK — 'users.show' 自动补全，{ user } 类型校验
forge.api('admin', 'users.sho', { user: 123 })   // ❌ TS Error: 路由名不存在
forge.api('admin', 'users.show', { uid: 123 })   // ❌ TS Error: 参数名应为 user
```

## 完整示例：真实项目的调用流程

下面以一个 Vue 3 管理端为例，演示 Route Forge 在真实项目中的完整组织方式：
初始化时序、登录态注入、401 处理、层级绑定、请求取消与错误处理。

### 入口：摘要发现完成后再挂载应用

```ts
// main.ts
import { createApp } from 'vue'
import { createRouteForgePlugin } from '@route-forge/vue'
import App from './App.vue'
import { tokenStore } from './stores/auth'

const app = createApp(App)

const plugin = createRouteForgePlugin({
  endpoint: '/_forge/routes',
  // levels 不传 → 从摘要端点自动发现；eager 不传 → 取后端标记为 load:'eager' 的层级
  interceptors: {
    // 声明式配置每个键只描述「一个」拦截器：函数（→ resolve）、[resolve?, reject?] 元组、或 { resolve?, reject? } 对象。
    // 需要注册多个？改用运行时 forge.interceptors.*.use()。
    request: (config) => {
      // 登录态注入：业务请求自动携带 Token
      const token = tokenStore.get()
      if (token) config.headers.Authorization = `Bearer ${token}`
      return config
    },
    response: {
      resolve: (resp) => resp.data,  // 统一解包：api() 直接 resolve 业务数据
      reject: (err) => {
        // 401 → 清空登录态并跳转登录页；其余错误继续上抛
        if ((err as any).context?.status === 401) {
          tokenStore.clear()
          location.href = '/login'
        }
        return Promise.reject(err)
      },
    },
  },
})

app.use(plugin)
// 推荐：摘要发现 + eager 层级全部完成后挂载应用，route()/hasRoute() 等同步方法即刻可用
// 注意：mount 已委托给 ready().then，此处不再重复调用
// 失败兜底：摘要端点不可达（网络错误/非 2xx/超时）时 ready() reject，
// 必须接住，否则用户面对白屏（onSummaryReady 已移除，统一走 ready）
plugin.ready().then(() => app.mount('#app')).catch((err) => {
  console.error('[route-forge] 初始化失败，应用未挂载', err)
  // 按业务需要降级：渲染错误页 / 重试 / 上报
  document.getElementById('app')!.innerHTML =
    '<p>服务暂不可用，请刷新重试</p>'
})
```

### 业务组件：层级绑定 + 前缀 + 加载状态

```vue
<script setup lang="ts">
import { useForge, useForgeApi, useForgeRoute } from '@route-forge/vue'
import { ref } from 'vue'

// 绑定 admin 层级 + users 前缀：路由名自动补全为 admin.users.*
const users = useForge('admin', 'users')
// 带 loading / error 状态的调用（同样支持层级 + 前缀绑定）
const { call: fetchOrders, pending, error } = useForgeApi('admin', 'orders')
// 响应式 URL 生成器：模板层专用，未加载返回 ''、加载后自动更新、参数变化重算
const userId = ref(1)
const detailUrl = useForgeRoute('admin', 'users.show', () => ({ user: userId.value }))

const user = ref(null)
const editUrl = ref('')

async function loadUser(id: number) {
  // 直接调用 = api 快捷方式；响应已被拦截器解包为业务数据
  user.value = await users('show', { user: id })
  // URL 生成：路由链接、<a href>、window.open 等场景
  editUrl.value = users.route('edit', { user: id })
}

async function loadOrders() {
  const { data, error: err } = await fetchOrders('index', { query: { page: 1 } })
  if (err) console.error('订单加载失败', err)
}
</script>

<template>
  <!-- useForgeRoute：响应式 URL，level 未加载时为 ''，加载后自动更新 -->
  <a :href="detailUrl">查看用户</a>
  <a :href="editUrl">编辑用户</a>
  <p v-if="pending">订单加载中…</p>
</template>
```

### 请求取消与错误处理

```ts
// 取消：forge.api() 返回的 ForgeRequest 自带 abort()
const req = forge.api('admin', 'users.show', { user: 123 })
req.abort()  // Promise reject 为 RequestAbortedError（RF_FE_009），请求被中止

// 错误速查：所有错误均为 ForgeError 子类，带稳定 code 字段，可按 code 分支处理
//   RF_FE_001 UnknownRouteError        路由名不存在
//   RF_FE_002 UnknownLevelError        层级未声明
//   RF_FE_003 MissingRouteParamError   必填路径参数缺失
//   RF_FE_007 NetworkError             网络层失败（DNS/连接）
//   RF_FE_008 HTTPError                HTTP 非 2xx（context.status 为状态码）
//   RF_FE_009 RequestAbortedError      请求被取消
```

## Adapter 适配

`createRouteForge({ adapter })` 支持多种 HTTP 客户端策略：

| 取值             | 行为                                                                  |
|------------------|-----------------------------------------------------------------------|
| `'auto'`（默认） | 检测到宿主有 axios 则复用（继承拦截器/配置），否则使用内置 fetch 实现 |
| `'axios'`        | 强制使用宿主 axios，未安装则报错                                      |
| `'builtin'`      | 强制使用内置 fetch 实现，即使装了 axios 也不复用                      |
| 自定义 Fetcher   | 传入符合 `Fetcher` 接口的对象，完全自定义                             |

内置 builtin adapter 基于原生 `fetch`，零外部依赖，min+gzip < 3KB，拦截器行为与 axios 完全一致。

## 开发

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8

### 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建所有包
pnpm build

# 运行测试
pnpm test

# 代码检查（当前委托各包 tsc --noEmit，未接入独立 linter）
pnpm lint

# 类型检查
pnpm typecheck

# 清理构建产物
pnpm clean
```

### 发布

```bash
# 类型检查 → 测试 → 构建 → 发布 core、vue 和 react 包
pnpm publish:build

# 或单独发布某个包
pnpm publish:core
pnpm publish:vue
pnpm publish:react
```

## 兼容性

| 依赖    | 版本支持                                                                                      |
|---------|-----------------------------------------------------------------------------------------------|
| Laravel | 9 / 10 / 11（详见 [route-forge-laravel](https://github.com/route-forge/route-forge-laravel)） |
| Vue     | 3.3+（不支持 Vue 2）                                                                          |
| Node.js | LTS 版本（18 / 20 / 22）                                                                      |
| 浏览器  | 现代浏览器（Chrome / Edge / Firefox / Safari 最近 2 个大版本），不支持 IE                     |

## 文档

- [功能规格说明书](.docs/SPEC.md) — 完整的功能定义与 API 规范
- [设计思路](.docs/DESIGN.md) — 架构决策与演进思路
- [@route-forge/core](packages/core/README_zh.md) — 核心包文档
- [@route-forge/vue](packages/vue/README_zh.md) — Vue 3 集成文档
- [@route-forge/react](packages/react/README_zh.md) — React 集成文档

## License

[MIT](LICENSE) © 阿杰很厉害
