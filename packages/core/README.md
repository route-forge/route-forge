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

## URL 前缀（`url_prefix`）

后端可在摘要端点 `config.url_prefix` 中下发 URL 前缀，前端生成路由 URL 时自动拼接，无需手动配置。

支持两种形式：

```ts
// 1. 路径前缀 — 拼接在 baseURL 之后、路由 URI 之前
// 后端返回 { "config": { "url_prefix": "/api/v1" } }
forge.route('public', 'users.show', { user: 1 })
// → '/api/v1/users/1'

// 2. 完整 URL（含协议+域名）— 直接作为基础 URL，忽略客户端 baseURL
//    适用于前后端不同域名的场景
// 后端返回 { "config": { "url_prefix": "https://api.example.com" } }
forge.route('public', 'users.show', { user: 1 })
// → 'https://api.example.com/users/1'
```

> `url_prefix` 为后端权威，前端不能覆盖。不下发或为空字符串时不影响 URL 生成。

## 文档

- 仓库主页: https://github.com/xyj2156/route-forge
- 设计文档: https://github.com/xyj2156/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/xyj2156/route-forge/blob/main/.docs/SPEC.md

## License

MIT
