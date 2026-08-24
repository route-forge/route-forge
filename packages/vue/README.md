# @route-forge/vue

Route Forge 的 Vue 3 集成：插件 + composable（`useForge` / `useForgeApi` / `useForgeLevel` /
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

const app = createApp(App)
app.use(createRouteForgePlugin({
  endpoint: '/_forge/routes',
}))
app.mount('#app')
```

## useForge — 核心 composable

`useForge()` 返回一个可直接调用的 forge 实例，是 `forge.api()` 的快捷方式。支持可选传入 `level` 绑定层级：

```ts
import { useForge } from '@route-forge/vue'

// 不绑定层级 — 直接调用需要传 level
const forge = useForge()
forge('admin', 'users.show', { user: 1 })        // = forge.api('admin', 'users.show', ...)
forge.api('admin', 'users.show', { user: 1 })     // 显式调用

// 绑定层级 — 直接调用和 api/route/url 均无需传 level
const forge = useForge('admin')
forge('users.show', { user: 1 })                  // 自动带 admin
forge.api('users.show', { user: 1 })              // 同上
forge.route('users.show', { user: 1 })            // 生成 URL，自动带 admin
forge.url('users.show', { user: 1 })              // route() 语义别名

// 绑定层级 + 前缀 — 路由名自动拼接
const forge = useForge('admin', 'users')
forge.level                                    // → 'admin'
forge.prefix                                   // → 'users'
forge('show', { user: 1 })                     // → forge.api('admin', 'users.show', ...)
forge.api('index')                             // → forge.api('admin', 'users.index')
forge.route('show', { user: 1 })               // → forge.route('admin', 'users.show', ...)

// 通用方法（无论是否绑定 level 均可用）
forge.load('admin')                               // 加载层级
forge.isLoaded('admin')                           // 检查缓存
forge.invalidate('admin')                         // 失效缓存
forge.interceptors.request.use(...)               // 拦截器管理
```

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
  useForgeLevel,
  useForgeRoute,
  useForgeByPrefix,
} from '@route-forge/vue'

// useForgeApi — 带 loading/error 状态的 API 调用
const { call, pending, error } = useForgeApi()
const { data } = await call('admin', 'users.show', { user: 1 })

// useForgeLevel — 挂载时自动加载层级
const { loaded, error } = useForgeLevel('admin')

// useForgeRoute — 响应式 URL 生成（用于 <a href> 等）
const url = useForgeRoute('public', 'login.show')

// useForgeByPrefix — 层级 + 名字前缀封装
const { api, route } = useForgeByPrefix('admin', 'users')
await api('show', { user: 1 })   // = forge.api('admin', 'users.show', { user: 1 })
```

## 模板内使用

```vue
<template>
  <a :href="$forge.route('public', 'login.show')">登录</a>
</template>
```

## 文档

- 仓库主页: https://github.com/xyj2156/route-forge
- 设计文档: https://github.com/xyj2156/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/xyj2156/route-forge/blob/main/.docs/SPEC.md

## License

MIT
