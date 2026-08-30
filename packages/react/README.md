# @route-forge/react

Route Forge 的 React 集成：Provider + hooks（`useForge` / `useForgeApi` /
`useForgeRoute`）。

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

// 推荐：Provider 外先建 forge，ready()（摘要 + eager 层级全部完成）后再渲染
// （onSummaryReady 回调已移除，统一走 ready——完整成功/失败语义链）
const forge = createRouteForge({
  endpoint: '/_forge/routes',
})
forge.ready()
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <RouteForgeProvider options={{ endpoint: '/_forge/routes' }}>
        <App />
      </RouteForgeProvider>,
    )
  })
  .catch((err) => {
    // 失败兜底：摘要端点不可达（网络错误/非 2xx/超时）时接住 reject，避免静默卡在初始化
    console.error('[route-forge] init failed', err)
  })
```

## useForge — 核心 hook

`useForge()` 返回 forge 实例对象。无 level 时返回完整 `RouteForge` 实例；传入 `{ level }` 时内部调用 `forge.use(level, prefix?)`，自动触发 load：

```tsx
import { useForge } from '@route-forge/react'

// 不绑定层级 — 返回完整 RouteForge 实例
const forge = useForge()
forge.api('admin', 'users.show', { user: 1 })
forge.ready().then(f => f.use('admin'))           // 等待就绪后绑定层级
forge.use('admin')                                 // 绑定层级，返回 BoundForge

// 绑定层级 — 可直接调用，也可通过 api/route/url
const forge = useForge({ level: 'admin' })
forge.level                                        // → 'admin'
forge.levelLoaded                                  // boolean，加载完成后为 true
forge('users.show', { user: 1 })                   // 直接调用 = forge.api() 快捷方式
forge.api('users.show', { user: 1 })
forge.route('users.show', { user: 1 })
forge.url('users.show', { user: 1 })               // route() 语义别名
forge.onLevelLoaded()                              // 等待 level 加载完成
forge.useRoutePrefix('users')                      // 追加路由名前缀

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

> **注意**：`useForge()` 无 level 时返回完整 `RouteForge` 实例，包含所有方法（`route`/`url`/`hasRoute`/`getRoutes` 等）。
> 但 auto-discovery 可能未完成，同步方法可能抛守卫错误。建议使用 `await forge.ready()` 或 `useForgeRoute`。

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
} from '@route-forge/react'

// useForgeApi — 带 loading/error 状态的 API 调用（事件处理器场景）
// 不抛异常：错误作为 { data: undefined, error } 返回，同时写入 error 状态
// 三种调用形态（选项对象，level 绑定与 useForge 一致）：
const api = useForgeApi()                                  // 未绑定：call(level, name, params)
const admin = useForgeApi({ level: 'admin' })              // 绑定层级：call(name, params)
const users = useForgeApi({ level: 'admin', prefix: 'users' })  // 绑定层级 + 前缀

const { data, error } = await admin.call('users.show', { user: 1 })
// pending: boolean，并发多个 call 时全部完成才置 false（引用计数）
// error:   unknown，最近一次失败信息

// useForgeRoute — 响应式 URL 生成器（模板层场景）
// string，内部处理 level 加载状态：
// level 未加载时返回 ''，加载后自动更新；参数变化自动重算
const url = useForgeRoute('public', 'login.show')
const profile = useForgeRoute('admin', 'users.show', { user: userId })
// 路由名错误或必填参数缺失：降级为 '' 保证渲染不中断，控制台输出完整错误（含堆栈）
```

## 文档

- 仓库主页: https://github.com/route-forge/route-forge
- 设计文档: https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md

## License

MIT
