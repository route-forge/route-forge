# @route-forge/react

Route Forge 的 React 集成：Provider + hooks（`useForge` / `useForgeApi` / `useForgeLevel` /
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

createRoot(document.getElementById('root')!).render(
  <RouteForgeProvider options={{ endpoint: '/_forge/routes' }}>
    <App />
  </RouteForgeProvider>,
)
```

## useForge — 核心 hook

`useForge()` 返回一个 forge 实例对象。支持可选传入 `{ level }` 绑定层级：

```tsx
import { useForge } from '@route-forge/react'

// 不绑定层级 — 需要传 level
const forge = useForge()
forge.api('admin', 'users.show', { user: 1 })
forge.route('admin', 'users.show', { user: 1 })

// 绑定层级 — api/route/url 无需传 level
const forge = useForge({ level: 'admin' })
forge.level                                    // → 'admin'
forge.api('users.show', { user: 1 })
forge.route('users.show', { user: 1 })
forge.url('users.show', { user: 1 })           // route() 语义别名

// 绑定层级 + 前缀 — 路由名自动拼接
const forge = useForge({ level: 'admin', prefix: 'users' })
forge.api('show', { user: 1 })                 // → forge.api('admin', 'users.show', ...)
forge.route('show', { user: 1 })               // → forge.route('admin', 'users.show', ...)

// 通用方法（无论是否绑定 level 均可用）
forge.load('admin')                            // 加载层级
forge.isLoaded('admin')                        // 检查缓存
forge.invalidate('admin')                      // 失效缓存
forge.interceptors.request.use(...)            // 拦截器管理
```

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
  useForgeLevel,
  useForgeRoute,
  useForgeByPrefix,
} from '@route-forge/react'

// useForgeApi — 带 loading/error 状态的 API 调用
const { call, pending, error } = useForgeApi()
const { data } = await call('admin', 'users.show', { user: 1 })

// useForgeLevel — 挂载时自动加载层级
const { loaded, error } = useForgeLevel('admin')

// useForgeRoute — memoized URL 生成（用于 <a href> 等）
const url = useForgeRoute('public', 'login.show')

// useForgeByPrefix — 层级 + 名字前缀封装
const { api, route } = useForgeByPrefix('admin', 'users')
await api('show', { user: 1 })   // = forge.api('admin', 'users.show', { user: 1 })
```

## 文档

- 仓库主页: https://github.com/xyj2156/route-forge
- 设计文档: https://github.com/xyj2156/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/xyj2156/route-forge/blob/main/.docs/SPEC.md

## License

MIT
