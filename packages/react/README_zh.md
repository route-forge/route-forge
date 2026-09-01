# @route-forge/react

[English](./README.md) | **中文**

Route Forge 的 React 集成：`RouteForgeProvider` + 三个 hooks（`useForge` / `useForgeApi` / `useForgeRoute`），在组件里用**路由名**调用 API、生成链接，加载态与错误自动管理。

> 核心能力（分级懒加载、隔离缓存、拦截器、请求取消、类型安全）全部来自 [@route-forge/core](../core/README_zh.md)，本包只做 React 适配：`levelLoaded` 是 `boolean`（状态驱动重渲染）、`pending` / `error` 是普通值、URL 生成返回纯 `string`。

## 安装

```bash
pnpm add @route-forge/react @route-forge/core
```

要求 React 18+（兼容 19）。

## 快速开始

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

hooks 内部已处理好异步：`useForgeApi` / `forge.api()` 自动等待层级加载，`useForgeRoute` 未加载时返回 `''`、加载后自动更新——无需阻塞渲染。

**需要整应用就绪后再渲染？**（例如首屏就要用 `route()` / `hasRoute()` 等同步方法）可在 Provider 外先建一个 forge 做就绪门控：

```tsx
const forge = createRouteForge({ endpoint: '/_forge/routes' })
forge.ready()
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <RouteForgeProvider options={{ endpoint: '/_forge/routes' }}>
        <App />
      </RouteForgeProvider>,
    )
  })
  .catch((err) => {
    // 失败必须接住：摘要端点不可达（网络错误/非 2xx/超时）时避免静默卡在初始化
    console.error('[route-forge] init failed', err)
  })
```

> 注意：`RouteForgeProvider` 只接收 `options`（不接收实例），门控写法里 Provider 内部会创建第二个实例，摘要端点会被请求两次。若不想重复请求，优先使用上面的直接渲染写法，把同步方法的调用放在 `ready()` 之后。

> Provider 选项与 `createRouteForge(options)` 完全一致（`levels` / `eager` / `adapter` / `cache` / `interceptors` / `timeout` / `baseURL`），完整选项表见 [core README](../core/README_zh.md#配置选项createruteforgeoptions)。`options` 做浅比较：内联字面量在值不变时不会重建实例。

## useForge — 核心 hook

无 `level` 时返回完整 `RouteForge` 实例；传入 `{ level }` 时内部调用 `forge.use(level, prefix?)`（自动触发层级加载），返回 `ReactBoundForge`：

```tsx
import { useForge } from '@route-forge/react'

// 不绑定层级 — 返回完整 RouteForge 实例
const forge = useForge()
forge.api('admin', 'users.show', { user: 1 })
forge.ready().then(f => f.use('admin'))           // 等待就绪后绑定层级

// 绑定层级 — 可直接调用，自动触发 load
const users = useForge({ level: 'admin' })
users.level                                       // → 'admin'
users.levelLoaded                                 // boolean，加载完成后为 true（触发重渲染）
users('users.show', { user: 1 })                  // 直接调用 = users.api() 快捷方式
users.api('users.show', { user: 1 })
users.route('users.show', { user: 1 })
users.url('users.show', { user: 1 })              // route() 语义别名
users.onLevelLoaded()                             // 等待 level 加载完成
users.useRoutePrefix('users')                     // 以新前缀返回新的 BoundForge

// 绑定层级 + 前缀 — 路由名自动拼接（歧义时智能消解）
const userApi = useForge({ level: 'admin', prefix: 'users' })
userApi('show', { user: 1 })                      // → forge.api('admin', 'users.show', ...)
userApi.route('show', { user: 1 })                // → forge.route('admin', 'users.show', ...)

// 通用方法：绑定形态下作用于绑定的层级（无参数）
users.load()                                      // 加载绑定层级
users.isLoaded()                                  // 检查绑定层级缓存
users.invalidate()                                // 失效绑定层级缓存
// 全局方法：isLoading() / onLoadingChange() / hasRoute(name) / getRoutes()
```

> **注意**：`useForge()` 无 `level` 时返回的完整实例在 auto-discovery 未完成前调用 `route()` / `hasRoute()` 可能抛守卫错误（`RF_FE_010`）。建议 `await forge.ready()`，或生成链接直接用 `useForgeRoute`。

> **level 是静态绑定**：`level`（与 `prefix`）在首次调用时固定，不支持中途切换层级——换层级请另起组件或另一次 `useForge` 调用（开销可接受）。

## useForgeApi — 带 loading/error 的事件型调用

面向点击事件等命令式场景（不能在渲染期 `await`）：不抛异常，错误写入 `error` 状态并作为 `{ data: undefined, error }` 返回：

```tsx
import { useForgeApi } from '@route-forge/react'

// 三种调用形态（选项对象，level 绑定语义与 useForge 一致）
const api = useForgeApi()                                        // 未绑定：call(level, name, params)
const admin = useForgeApi({ level: 'admin' })                    // 绑定层级：call(name, params)
const users = useForgeApi({ level: 'admin', prefix: 'users' })   // 绑定层级 + 前缀：call(suffix, params)

async function handleClick() {
  const { data, error } = await admin.call('users.show', { user: 1 })
}
```

- `pending`: `boolean`——引用计数，并发多个 `call` 时全部完成才置 `false`
- `error`: `unknown`——最近一次失败信息（成功时清为 `null`）

## useForgeRoute — JSX 里的链接

返回纯 `string`（不是 ref），直接放进 `href`。内部处理加载态：`level` 未加载时返回 `''`（渲染不崩），加载完成或参数变化后自动更新——你不必关心 `levelLoaded`：

```tsx
import { useForgeRoute } from '@route-forge/react'

function UserLinks({ userId, userName }) {
  // 静态 URL
  const login = useForgeRoute('public', 'login.show')
  // 带参数：params 传普通对象，内容变化才触发重算（内联字面量不会导致每帧重算）
  const profile = useForgeRoute('admin', 'users.show', { user: userId })

  return (
    <>
      <a href={login}>登录</a>
      <a href={profile}>{userName}</a>
    </>
  )
}
```

契约细节：

- **与 Vue 版的差异**：返回 `string`（Vue 版返回 `ComputedRef<string>`，模板自动解包）；`params` 收普通对象（Vue 版收 getter）。React 内部按 `params` 的**内容**做依赖对比（序列化），直接写内联对象字面量也安全，不会因引用变化而每帧重算
- `level` 为静态绑定，不支持中途切换（要换层级请另起组件 / 另一次调用，与 `useForge` 契约一致）
- 路由名不存在、必填参数缺失等渲染期错误：**降级为 `''` 保证渲染不中断**，同时以样式化 `console.warn` 输出完整错误（含堆栈）

## 参数智能解析

`api()` 的参数支持与 core 一致的智能消解：路径参数平铺传入，`query` / `body` / `headers` 为固定 key；路径参数名与固定 key 冲突时，`string|number` 值自动识别为路径参数，也可用 `params` 显式指定（优先级最高）：

```tsx
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

```tsx
// 拼错路由名 / 参数名 → 编译期报错；正确调用 → 自动补全
const users = useForge({ level: 'admin', prefix: 'users' })
await users('show', { user: 1 })      // ✅ params 类型自动校验
```

详见 [core README「类型安全」](../core/README_zh.md#类型安全可选但推荐)。

## 与 core / vue 的差异

| 能力 | @route-forge/core | @route-forge/vue | @route-forge/react |
|------|-------------------|------------------|--------------------|
| `levelLoaded` | `Promise<void>` | `Ref<boolean>` | `boolean` |
| `useForgeApi` 的 `pending` / `error` | —（用 `LoadingTracker`） | `Ref<boolean>` / `Ref<unknown>` | `boolean` / `unknown` |
| URL 生成返回值 | `string`（同步，未就绪抛错） | `ComputedRef<string>`（未就绪为 `''`） | `string`（未就绪为 `''`） |
| `useForgeRoute` 的 params | — | getter 函数 | 普通对象（按内容对比依赖） |
| 绑定签名 | `forge.use(level, prefix?)` | `useForge(level?, prefix?)` | `useForge({ level?, prefix? })` |

## 常见问题

**`useForge()` 报 "must be used within a `<RouteForgeProvider>`"？**
hook 在 Provider 之外被调用了；确认组件树包裹在 `<RouteForgeProvider>` 里。

**`options` 传内联对象会每次渲染都重建实例吗？**
不会。Provider 对 `options` 做浅比较（含数组元素与嵌套纯对象），值不变则复用同一实例；只有配置实际变化才重建。

**命令式调用写在哪？**
放在事件处理器 / `useEffect` 里，不要在渲染期 `await`；渲染期只适合 `useForgeRoute`（同步返回字符串）。

## 文档

- 仓库主页: <https://github.com/route-forge/route-forge>
- 核心包文档: [@route-forge/core](../core/README_zh.md)
- 设计文档: <https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md>
- 规范: <https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md>

## License

MIT
