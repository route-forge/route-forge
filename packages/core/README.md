# @route-forge/core

框架无关的命名路由客户端核心:分级懒加载、隔离缓存、并发去重、登录态感知、拦截器。

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

const url = forge.route('public', 'login.show')
// → 'http://localhost/login'
```

## 文档

- 仓库主页: https://github.com/xyj2156/route-forge
- 设计文档: https://github.com/xyj2156/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/xyj2156/route-forge/blob/main/.docs/SPEC.md

## License

MIT
