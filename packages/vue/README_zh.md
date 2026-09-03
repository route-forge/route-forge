# @route-forge/vue

[English](./README.md) | **中文**

Route Forge 的 Vue 3 集成：插件（`createRouteForgePlugin`）+ 三个 composable（`useForge` / `useForgeApi` / `useForgeRoute`）+ 两个组件（`ForgeRoute` / `ForgeLink`），在组件里用**路由名**调用 API、生成响应式链接，加载态与错误自动管理。

> 核心能力（分级懒加载、隔离缓存、拦截器、请求取消、类型安全）全部来自 [@route-forge/core](../core/README_zh.md)，本包只做 Vue 响应式适配：`levelLoaded` 是 `Ref<boolean>`、`pending` / `error` 是 `Ref`、URL 生成返回 `ComputedRef<string>`。

## 安装

```bash
pnpm add @route-forge/vue @route-forge/core
```

要求 Vue 3.3+（不支持 Vue 2）。

## 快速开始

```ts
// main.ts
import { createApp } from 'vue'
import { createRouteForgePlugin } from '@route-forge/vue'
import App from './App.vue'

const plugin = createRouteForgePlugin({
  endpoint: '/_forge/routes',
})

const app = createApp(App)
app.use(plugin)
// 推荐：ready()（摘要 + eager 层级全部完成）后再挂载应用，
// 挂载后 route()/hasRoute() 等同步方法即刻可用
plugin.ready()
  .then(() => app.mount('#app'))
  .catch((err) => {
    // 失败必须接住：摘要端点不可达（网络错误/非 2xx/超时）时避免静默白屏
    console.error('[route-forge] init failed', err)
  })
```

> 插件选项与 `createRouteForge(options)` 完全一致（`endpoint` / `summary` / `levels` / `eager` / `adapter` / `cache` / `interceptors` / `timeout` / `baseURL`），完整选项表见 [core README](../core/README_zh.md#配置选项createruteforgeoptions)。`options` 本身可选——摘要由页面内嵌 `@forgeSummary`（`window.__ROUTE_FORGE__`）提供时，可直接 `createRouteForgePlugin()` 无参安装。

## useForge — 核心 composable

无 `level` 时返回完整 `RouteForge` 实例；传入 `level` 时内部调用 `forge.use(level, prefix?)`（自动触发层级加载），返回 `VueBoundForge`：

```ts
import { useForge } from '@route-forge/vue'

// 不绑定层级 — 返回完整 RouteForge 实例
const forge = useForge()
forge.api('admin', 'users.show', { user: 1 })     // 通过层级 + 路由名调用
forge.ready().then(f => f.use('admin'))           // 等待就绪后绑定层级

// 绑定层级 — 可直接调用，自动触发 load
const users = useForge('admin')
users.level                                       // → 'admin'
users.levelLoaded                                 // Ref<boolean>，加载完成后变为 true
users('users.show', { user: 1 })                  // 可直接调用（= users.api() 快捷方式）
users.api('users.show', { user: 1 })              // 同上
users.route('users.show', { user: 1 })            // 生成 URL
users.url('users.show', { user: 1 })              // route() 语义别名
await users.onLevelLoaded()                       // 等待 level 加载完成
users.useRoutePrefix('users')                     // 以新前缀返回新的 BoundForge

// 绑定层级 + 前缀 — 路由名自动拼接（歧义时智能消解）
const userApi = useForge('admin', 'users')
userApi.prefix                                    // → 'users'
userApi('show', { user: 1 })                      // → forge.api('admin', 'users.show', ...)
userApi.route('show', { user: 1 })                // → forge.route('admin', 'users.show', ...)

// 通用方法：绑定形态下作用于绑定的层级（无参数）
users.load()                                      // 加载绑定层级
users.isLoaded()                                  // 检查绑定层级缓存
users.invalidate()                                // 失效绑定层级缓存
// 全局方法：isLoading() / onLoadingChange() / hasRoute(name) / getRoutes()
```

> **注意**：`useForge()` 无 `level` 时返回的完整实例在 auto-discovery 未完成前调用 `route()` / `hasRoute()` 可能抛守卫错误（`RF_FE_010`）。建议 `await forge.ready()`，或生成链接直接用 `useForgeRoute`。

> **level 是静态绑定**：`level`（与 `prefix`）在调用时固定，不支持中途切换层级——换层级请另起一次 `useForge` 调用（开销可接受）。

## useForgeApi — 带 loading/error 的事件型调用

面向点击事件等命令式场景：不抛异常，错误写入 `error` 状态并作为 `{ data: undefined, error }` 返回：

```ts
import { useForgeApi } from '@route-forge/vue'

// 三种调用形态（level 绑定语义与 useForge 一致）
const api = useForgeApi()                        // 未绑定：call(level, name, params)
const admin = useForgeApi('admin')               // 绑定层级：call(name, params)
const users = useForgeApi('admin', 'users')      // 绑定层级 + 前缀：call(suffix, params)

const { data, error } = await admin.call('users.show', { user: 1 })
```

- `pending`: `Ref<boolean>`——引用计数，并发多个 `call` 时全部完成才置 `false`
- `error`: `Ref<unknown>`——最近一次失败信息（成功时清为 `null`）

## useForgeRoute — 模板里的响应式链接

返回 `ComputedRef<string>`，模板自动解包无需 `.value`。内部处理加载态：`level` 未加载时返回 `''`（渲染不崩），加载完成或依赖变化后自动重算——你不必关心 `levelLoaded`：

```vue
<template>
  <!-- 1. 静态 URL -->
  <a :href="login">登录</a>

  <!-- 2. 响应式参数：userId 变化时 URL 自动重算 -->
  <a :href="profile">用户主页</a>

  <!-- 3. 响应式路由名：currentName 变化时自动重算 -->
  <NuxtLink :to="dynamic">动态入口</NuxtLink>
</template>

<script setup>
import { ref } from 'vue'
import { useForgeRoute } from '@route-forge/vue'

const userId = ref(1)
const currentName = ref('dashboard.show')

// 静态层级 + 静态路由名
const login = useForgeRoute('public', 'login.show')

// params 传 getter → 追踪响应式，userId 变了 URL 跟着变
const profile = useForgeRoute('admin', 'users.show', () => ({ user: userId.value }))

// name 传 getter → 路由名本身也可响应式切换
const dynamic = useForgeRoute('admin', () => currentName.value)
</script>
```

契约细节：

- `level` 为**静态字符串**绑定：setup 时一次固定，不支持中途切换——需要另一个层级请新建一次 `useForgeRoute` 调用（与 `useForge` 契约一致）；`name` / `params` 的 getter 保持响应式。传非 string 的 `level` 运行时直接抛 `TypeError`
- 路由名不存在、必填参数缺失等渲染期错误：**降级为 `''` 保证渲染不中断**，同时以样式化 `console.warn` 输出完整错误（含堆栈），开发期一眼可见、生产无副作用

## 组件 — ForgeRoute / ForgeLink

两个组件封装了 `useForgeRoute`，省去模板里重复的"先空串、后更新"处理。`level` 未加载（或路由解析失败）时渲染 `loading` 插槽（默认什么都不渲染），加载完成后渲染链接。

**`ForgeLink`** —— 便捷形态：加载完成后直接渲染 `<a :href>`，默认插槽内容即链接文本：

```vue
<script setup>
import { ForgeLink } from '@route-forge/vue'
</script>

<template>
  <!-- 层级加载完成后渲染 <a href="/login">登录</a> -->
  <ForgeLink level="public" name="login.show">登录</ForgeLink>

  <!-- 响应式参数（对象或 getter 形式）+ attrs 透传（class / target / …） -->
  <ForgeLink level="admin" name="users.show" :params="{ user: userId }" class="btn">
    查看用户
  </ForgeLink>

  <!-- 加载中的自定义占位 -->
  <ForgeLink level="admin" name="users.show" :params="() => ({ user: userId })">
    查看用户
    <template #loading>正在准备链接…</template>
  </ForgeLink>
</template>
```

路由库集成**零依赖、全自动**：安装了 [vue-router](https://router.vuejs.org/)（`app.use(router)`）时，`ForgeLink` 自动渲染 `<RouterLink :to="href">` 做 SPA 内部跳转；否则渲染原生 `<a>`。无需任何配置。（仅在父组件局部注册的 `RouterLink` 探测不到——探测的是 `app.use(router)` 产生的全局注册。）

**`ForgeRoute`** —— 灵活形态：通过作用域插槽暴露 `{ href, loaded }`，完全自主控制渲染：

```vue
<script setup>
import { ForgeRoute } from '@route-forge/vue'
</script>

<template>
  <ForgeRoute level="admin" name="users.show" :params="() => ({ user: userId })">
    <template #default="{ href }">
      <a :href="href">查看用户</a>
    </template>
    <template #loading>正在准备链接…</template>
  </ForgeRoute>
</template>
```

两组件共享的契约：

- `level` 为**静态字符串**绑定（与 `useForgeRoute` 契约一致，传非 string 运行时抛 `TypeError`）；`name` / `params` 支持值与 getter 函数双形态，均保持响应式
- `loaded` = `href !== ''`——`default` 插槽内恒为 `true`（该插槽只在加载完成后渲染），存在是为与 React render-prop API 对称
- 控制台行为：`level` 未加载时每实例 `console.warn` **一次**（正常瞬态，不刷屏）；路由解析失败每次都 `console.error`（渲染仍不中断）
- SSR：`level` 缓存就绪前组件只渲染 `loading` 插槽（或不渲染）——可在服务端预加载层级，或让链接在客户端 hydration 后自然出现

## 关于 `$forge` 全局属性（不推荐在模板中用）

插件安装后会注入 `app.config.globalProperties.$forge`（含 `route(level, name, params?)`）。它是**底层兜底入口**：只有在对应 `level` 已加载完成后才可安全调用（例如 `plugin.ready()` resolve 之后）。渲染期若层级尚未加载，`$forge.route()` 会因路由数据未就绪直接抛错、打断渲染——不可控。模板里生成链接请优先用 `useForgeRoute`，`$forge` 保留给少数已确保时序安全的命令式场景。

## 参数智能解析

`api()` 的参数支持与 core 一致的智能消解：路径参数平铺传入，`query` / `body` / `headers` 为固定 key；路径参数名与固定 key 冲突时，`string|number` 值自动识别为路径参数，也可用 `params` 显式指定（优先级最高）：

```ts
// 冲突消解：路由 /search/{query} —— query 为 string → 路径参数
users.api('search.show', { query: 'keyword' })

// 显式 params：同时需要路径参数和 query string
users.api('search.show', {
  params: { query: 'keyword' },
  query: { page: 1 },
})
```

完整规则与 `timeout` 覆盖见 [core README](../core/README_zh.md#参数智能解析)。

## 类型安全（可选但推荐）

定义 `ForgeRouteMap`（codegen 或模块增强）后，`useForge` / `useForgeApi` / `useForgeRoute` 的 level、路由名、params 全部自动推断：

```bash
npx route-forge-codegen --endpoint http://localhost/_forge/routes --out src/types/forge-routes.d.ts
```

```ts
// 拼错路由名 / 参数名 → 编译期报错；正确调用 → 自动补全
const users = useForge('admin', 'users')
await users('show', { user: 1 })      // ✅ params 类型自动校验
```

详见 [core README「类型安全」](../core/README_zh.md#类型安全可选但推荐)。

## 与 core / react 的差异

| 能力 | @route-forge/core | @route-forge/vue | @route-forge/react |
|------|-------------------|------------------|--------------------|
| `levelLoaded` | `Promise<void>` | `Ref<boolean>` | `boolean` |
| `useForgeApi` 的 `pending` / `error` | —（用 `LoadingTracker`） | `Ref<boolean>` / `Ref<unknown>` | `boolean` / `unknown` |
| URL 生成返回值 | `string`（同步，未就绪抛错） | `ComputedRef<string>`（未就绪为 `''`） | `string`（未就绪为 `''`） |
| `useForgeRoute` 的 params | — | getter 函数 | 普通对象（按内容对比依赖） |
| 绑定签名 | `forge.use(level, prefix?)` | `useForge(level?, prefix?)` | `useForge({ level?, prefix? })` |

## 常见问题

**模板里 `$forge.route()` 抛错？**
层级尚未加载。改用 `useForgeRoute`（自动处理加载态并降级为 `''`），或确保在 `plugin.ready()` resolve 后再渲染依赖路由的组件。

**`useForge()` 报 "must be used inside an app with createRouteForgePlugin() installed"？**
composable 在插件安装前或插件未安装的组件树里被调用了；确认 `app.use(plugin)` 已执行。

**切换页面后想重新拉取路由表？**
`forge.invalidate()`（或绑定形态 `users.invalidate()`）后，下次 `api()` / `load()` 会重新拉取。

## 文档

- 仓库主页: <https://github.com/route-forge/route-forge>
- 核心包文档: [@route-forge/core](../core/README_zh.md)
- 设计文档: <https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md>
- 规范: <https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md>

## License

MIT
