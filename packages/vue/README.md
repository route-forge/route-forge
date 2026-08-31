# @route-forge/vue

Route Forge 的 Vue 3 集成：插件 + composable（`useForge` / `useForgeApi` /
`useForgeRoute`）。

## 安装

```bash
pnpm add @route-forge/vue @route-forge/core
```

## 基本用法

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
// 推荐：ready()（摘要 + eager 层级全部完成）后再挂载应用
// （onSummaryReady 回调已移除，统一走 ready——完整成功/失败语义链）
plugin.ready()
  .then(() => app.mount('#app'))
  .catch((err) => {
    // 失败兜底：摘要端点不可达（网络错误/非 2xx/超时）时接住 reject，避免静默白屏
    console.error('[route-forge] init failed', err)
  })
```

## useForge — 核心 composable

`useForge()` 返回 forge 实例。无 level 时返回完整 `RouteForge` 实例；传入 `level` 时内部调用 `forge.use(level, prefix?)`，自动触发 load：

```ts
import { useForge } from '@route-forge/vue'

// 不绑定层级 — 返回完整 RouteForge 实例
const forge = useForge()
forge.api('admin', 'users.show', { user: 1 })     // 通过层级 + 路由名调用
forge.ready().then(f => f.use('admin'))           // 等待就绪后绑定层级
forge.use('admin')                                 // 绑定层级，返回 BoundForge

// 绑定层级 — 自动触发 load，提供同步方法 + levelLoaded 状态
const forge = useForge('admin')
forge.level                                        // → 'admin'
forge.levelLoaded                                  // Ref<boolean>，加载完成后变为 true
forge('users.show', { user: 1 })                  // 可直接调用（= forge.api() 快捷方式）
forge.api('users.show', { user: 1 })              // 同上
forge.route('users.show', { user: 1 })            // 生成 URL
forge.url('users.show', { user: 1 })              // route() 语义别名
forge.onLevelLoaded()                              // 等待 level 加载完成
forge.useRoutePrefix('users')                      // 追加路由名前缀

// 绑定层级 + 前缀 — 路由名自动拼接
const forge = useForge('admin', 'users')
forge.level                                        // → 'admin'
forge.prefix                                       // → 'users'
forge('show', { user: 1 })                         // → forge.api('admin', 'users.show', ...)
forge.route('show', { user: 1 })                   // → forge.route('admin', 'users.show', ...)

// 通用方法（无论是否绑定 level 均可用）
forge.load('admin')                                // 加载层级
forge.isLoaded('admin')                            // 检查缓存
forge.invalidate('admin')                          // 失效缓存
```

> **注意**：`useForge()` 无 level 时返回完整 `RouteForge` 实例，包含所有方法（`route`/`url`/`hasRoute`/`getRoutes` 等）。
> 但 auto-discovery 可能未完成，同步方法可能抛守卫错误。建议使用 `await forge.ready()` 或 `useForgeRoute`。

### 参数智能解析

`api()` 的参数支持智能消解：路径参数平铺传入，`query`/`body`/`headers` 为固定 key。当路径参数名与固定
key 冲突时，`string|number` 值自动识别为路径参数，对象值按原定义处理。也可通过 `params`
显式指定路径参数（优先级最高）：

```ts
// 冲突消解：query 为 string → 路径参数
forge.api('search.show', { query: 'keyword' })

// 显式 params：同时需要路径参数和 query string
forge.api('search.show', {
  params: { query: 'keyword' },
  query: { page: 1 },
})
```

## 其他 composable

```ts
import {
  useForgeApi,
  useForgeRoute,
} from '@route-forge/vue'

// useForgeApi — 带 loading/error 状态的 API 调用（事件处理器场景）
// 不抛异常：错误作为 { data: undefined, error } 返回，同时写入 error 状态
// 三种调用形态（level 绑定与 useForge 一致）：
const api = useForgeApi()                        // 未绑定：call(level, name, params)
const admin = useForgeApi('admin')               // 绑定层级：call(name, params)
const users = useForgeApi('admin', 'users')      // 绑定层级 + 前缀：call(suffix, params)

const { data, error } = await admin.call('users.show', { user: 1 })
// pending: Ref<boolean>，并发多个 call 时全部完成才置 false（引用计数）
// error:   Ref<unknown>，最近一次失败信息

// useForgeRoute — 响应式 URL 生成器（模板层场景）
// ComputedRef<string>，内部处理 level 加载状态：
// level 未加载时返回 ''，加载后自动更新；参数（getter）变化自动重算
const url = useForgeRoute('public', 'login.show')
const profile = useForgeRoute('admin', 'users.show', () => ({ user: userId.value }))
// 路由名错误或必填参数缺失：降级为 '' 保证渲染不中断，控制台输出完整错误（含堆栈）
```

## 模板内使用

模板里生成链接统一用 `useForgeRoute`：它返回 `ComputedRef<string>`，Vue 在模板中自动解包，无需写
`.value`。level 未加载时返回 `''`（渲染不崩），加载完成或依赖变化后自动重算——你不必关心 `levelLoaded`。

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

> `level` 为实例级静态绑定：即便传函数形式也只在 setup 求值一次即固定，不支持中途切换层级
> （要换层级请在别的组件 / 另一次 `useForgeRoute` 调用里分别使用，与 `useForge` 契约一致）。
> `name`、`params` 的 getter 则保持响应式，变化时自动重算。
> 路由名不存在或必填参数缺失等渲染期错误会降级为 `''` 并输出样式化 `console.warn`，不会中断渲染。

### 关于 `$forge` 全局属性（不推荐在模板中用）

插件安装后会注入 `app.config.globalProperties.$forge`（含 `route(level, name, params?)`）。它是**底层兜底入口**：
只有在对应 `level` 已加载完成后才可安全调用（例如 `plugin.ready()` resolve 之后）。渲染期若层级尚未加载，
`$forge.route()` 会因路由数据未就绪直接抛错、打断渲染——不可控。因此模板里生成链接请优先用 `useForgeRoute`
（自动处理加载态、错误降级为 `''`），`$forge` 保留给少数已确保时序安全的命令式场景。

## 文档

- 仓库主页: https://github.com/route-forge/route-forge
- 设计文档: https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md

## License

MIT
