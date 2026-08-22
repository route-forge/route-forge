# @route-forge/core

框架无关的命名路由客户端核心：分级懒加载、隔离缓存、并发去重、登录态感知、拦截器。

## 安装

```bash
pnpm add @route-forge/core
# 可选:axios 适配器
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

// 检查层级是否已加载
if (!forge.isLoaded('admin')) {
  await forge.load('admin')
}

// 失效缓存
forge.invalidate('admin')   // 失效指定层级
forge.invalidate()          // 失效全部
```

## 文档

- 仓库主页: https://github.com/xyj2156/route-forge
- 设计文档: https://github.com/xyj2156/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/xyj2156/route-forge/blob/main/.docs/SPEC.md

## License

MIT
