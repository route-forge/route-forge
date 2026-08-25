# @route-forge/vue

Route Forge 的 Vue 3 集成：插件 + composable（`useForge` / `useForgeApi` /
`useForgeRoute` / `useForgeByPrefix`）。

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
  onSummaryReady: () => {
    // 推荐：在路由数据就绪后挂载应用
    app.mount('#app')
  },
})

const app = createApp(App)
app.use(plugin)
// 如果不使用 onSummaryReady 回调，也可以直接挂载
// app.mount('#app')
```

## useForge — 核心 composable

`useForge()` 返回一个 forge 实例。支持可选传入 `level` 绑定层级：

```ts
import { useForge } from '@route-forge/vue'

// 不绑定层级 — 仅提供异步 API + 工具方法
const forge = useForge()
forge('admin', 'users.show', { user: 1 })        // = forge.api('admin', 'users.show', ...)
forge.api('admin', 'users.show', { user: 1 })     // 显式调用
forge.ready                                        // Promise<void>
forge.onLevelLoaded('admin', () => { ... })        // 订阅 level 加载

// 绑定层级 — 自动触发 load，提供同步方法 + levelLoaded 状态
const forge = useForge('admin')
forge.level                                        // → 'admin'
forge.levelLoaded                                  // Ref<boolean>，加载完成后变为 true
forge('users.show', { user: 1 })                  // 自动带 admin
forge.api('users.show', { user: 1 })              // 同上
forge.route('users.show', { user: 1 })            // 生成 URL，自动带 admin
forge.url('users.show', { user: 1 })              // route() 语义别名

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
forge.interceptors.request.use(...)                // 拦截器管理
```

> **注意**：`useForge()` 无 level 时 **不提供** `route`/`url`/`hasRoute`/`getRoutes` 同步方法，
> 因为 auto-discovery 可能未完成。请使用 `useForgeRoute` 或 `await forge.ready` 后再调用。

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
  useForgeByPrefix,
} from '@route-forge/vue'

// useForgeApi — 带 loading/error 状态的 API 调用
const { call, pending, error } = useForgeApi()
const { data } = await call('admin', 'users.show', { user: 1 })

// useForgeRoute — 响应式 URL 生成器，内部处理 level 加载状态
// level 未加载时返回 ''，加载后自动更新
const url = useForgeRoute('public', 'login.show')

// useForgeByPrefix — 层级 + 名字前缀封装
const { api, route } = useForgeByPrefix('admin', 'users')
await api('show', { user: 1 })   // = forge.api('admin', 'users.show', { user: 1 })
```

## 模板内使用

```vue
<template>
  <!-- useForgeRoute 内部处理加载状态，可直接在模板中使用 -->
  <a :href="url">登录</a>

  <!-- 或通过 $forge 全局属性（需确保 level 已加载） -->
  <a :href="$forge.route('public', 'login.show')">登录</a>
</template>

<script setup>
import { useForgeRoute } from '@route-forge/vue'
const url = useForgeRoute('public', 'login.show')
</script>
```

## 文档

- 仓库主页: https://github.com/xyj2156/route-forge
- 设计文档: https://github.com/xyj2156/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/xyj2156/route-forge/blob/main/.docs/SPEC.md

## License

MIT
