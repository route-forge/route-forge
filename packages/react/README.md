# @route-forge/react

Route Forge 的 React 集成：Provider + hooks（`useForge` / `useForgeApi` /
`useForgeRoute` / `useForgeByPrefix`）。

## 安装

```bash
pnpm add @route-forge/react @route-forge/core
```

## 基本用法

```tsx
// main.tsx
import { createRoot } from 'react-dom/client'
import { RouteForgeProvider } from '@route-forge/react'
import { createRouteForge } from '@route-forge/core'

// 推荐：使用 onSummaryReady 回调确保路由数据就绪后再渲染
createRoot(document.getElementById('root')!).render(
  <RouteForgeProvider options={{
    endpoint: '/_forge/routes',
    onSummaryReady: () => {
      // 路由数据已就绪
    },
  }}>
    <App />
  </RouteForgeProvider>,
)
```

## useForge — 核心 hook

`useForge()` 返回一个 forge 实例对象。支持可选传入 `{ level }` 绑定层级：

```tsx
import { useForge } from '@route-forge/react'

// 不绑定层级 — 仅提供异步 API + 工具方法
const forge = useForge()
forge.api('admin', 'users.show', { user: 1 })
forge.ready                                        // Promise<void>
forge.onLevelLoaded('admin', () => { ... })        // 订阅 level 加载

// 绑定层级 — 可直接调用，也可通过 api/route/url
const forge = useForge({ level: 'admin' })
forge.level                                        // → 'admin'
forge.levelLoaded                                  // boolean，加载完成后为 true
forge('users.show', { user: 1 })                   // 直接调用 = forge.api() 快捷方式
forge.api('users.show', { user: 1 })
forge.route('users.show', { user: 1 })
forge.url('users.show', { user: 1 })               // route() 语义别名

// 绑定层级 + 前缀 — 路由名自动拼接
const forge = useForge({ level: 'admin', prefix: 'users' })
forge('show', { user: 1 })                         // → forge.api('admin', 'users.show', ...)
forge.api('show', { user: 1 })                     // 同上
forge.route('show', { user: 1 })                   // → forge.route('admin', 'users.show', ...)

// 通用方法（无论是否绑定 level 均可用）
forge.load('admin')                                // 加载层级
forge.isLoaded('admin')                            // 检查缓存
forge.invalidate('admin')                          // 失效缓存
```

> **注意**：`useForge()` 无 level 时 **不提供** `route`/`url`/`hasRoute`/`getRoutes` 同步方法，
> 因为 auto-discovery 可能未完成。请使用 `useForgeRoute` 或 `await forge.ready` 后再调用。

### 参数智能解析

`api()` 的参数支持智能消解：路径参数平铺传入，`query`/`body`/`headers` 为固定 key。当路径参数名与固定
key 冲突时，`string|number` 值自动识别为路径参数，对象值按原定义处理。也可通过 `params`
显式指定路径参数（优先级最高）：

```tsx
// 冲突消解：query 为 string → 路径参数
forge.api('search.show', { query: 'keyword' })

// 显式 params：同时需要路径参数和 query string
forge.api('search.show', {
  params: { query: 'keyword' },
  query: { page: 1 },
})
```

## 其他 hooks

```tsx
import {
  useForgeApi,
  useForgeRoute,
  useForgeByPrefix,
} from '@route-forge/react'

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

## 文档

- 仓库主页: https://github.com/route-forge/route-forge
- 设计文档: https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md

## License

MIT
