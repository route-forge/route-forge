# Route Forge

**Laravel 命名路由的全链路解决方案** — 分级懒加载 · 类型安全 · 拦截器

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

前端调用 API 应该表达"我要做什么"，而不是"我要去哪里"。

```ts
// ✅ 意图驱动 — Route Forge
const user = await forge.api('admin', 'users.show', { user: 123 })

// ❌ 位置驱动 — 传统方式
const user = await axios.get('/admin/users/123')
```

Route Forge 从 Laravel 路由注册表读取命名路由，按层级分组下发给前端。前端按需懒加载、缓存隔离、命名调用，全程
TypeScript 类型保护。

## 核心特性

| 特性           | 说明                                                                           |
|----------------|--------------------------------------------------------------------------------|
| **分级懒加载** | 路由按层级（如 `public` / `client` / `admin`）分组，前端按需拉取，优化首屏性能 |
| **隔离缓存**   | 每层级缓存独立存放，互不污染，支持 memory / sessionStorage / localStorage      |
| **并发去重**   | 同层级并发请求自动合并为一次，避免首屏请求雪崩                                 |
| **登录态感知** | 未登录用户自动跳过受保护层级，减少无效请求与信息泄露                           |
| **拦截器**     | 请求 / 响应拦截链，与 axios 行为一致（LIFO / FIFO），支持声明式注册和动态管理  |
| **类型安全**   | 后端 Artisan 命令生成 TS 类型声明，路由名 → 参数 → 响应全链路编译期校验        |
| **零侵入**     | 后端通过 Laravel macro 和 ServiceProvider 扩展，不修改框架核心                 |

## 项目结构

本仓库（[xyj2156/route-forge](https://github.com/xyj2156/route-forge)）包含 npm 侧的前端包：

```
route-forge/
├── packages/
│   ├── core/       # @route-forge/core — 框架无关的命名路由客户端核心
│   └── vue/        # @route-forge/vue — Vue 3 集成（插件 + composable）
├── .docs/
│   ├── SPEC.md     # 功能规格说明书
│   └── DESIGN.md   # 设计思路
└── ...
```

后端包（Composer）位于独立仓库：[xyj2156/route-forge-laravel](https://github.com/xyj2156/route-forge-laravel)。

两侧通过 HTTP manifest 契约交互，版本独立演进。

## 快速开始

### 1. 后端安装（Laravel）

```bash
composer require route-forge/laravel
```

在 `routes/web.php` 或 `routes/api.php` 中为路由标记层级：

```php
// 方式一：显式标记
Route::post('/auth/login', [AuthController::class, 'login'])
    ->name('auth.login')
    ->tier('public');

// 方式二：分组继承
Route::group(['prefix' => 'admin', 'middleware' => ['auth', 'admin'], 'tier' => 'admin'], function () {
    Route::get('/users', [UserController::class, 'index'])->name('admin.users.index');
    Route::get('/users/{user}', [UserController::class, 'show'])->name('admin.users.show');
});
```

在 `config/forge.php` 中配置层级规则（支持按前缀、中间件批量匹配）：

```php
return [
    'levels' => [
        'public' => [
            'match' => ['prefix' => ['auth', 'public']],
            'load'  => 'eager',
            'cache' => 3600,
        ],
        'admin' => [
            'match' => ['prefix' => ['admin'], 'middleware' => ['auth', 'admin']],
            'load'  => 'lazy',
        ],
    ],
];
```

### 2. 前端安装

```bash
# 核心包（必须）
pnpm add @route-forge/core

# Vue 3 集成（可选）
pnpm add @route-forge/vue

# axios 适配器（可选，不装则使用内置 fetch 实现）
pnpm add axios
```

### 3. 前端使用

#### 纯 Core 用法

```ts
import { createRouteForge } from '@route-forge/core'

const forge = createRouteForge({
  endpoint: '/_forge/routes',
})

// 调用 API — 自动加载层级 + 填充参数 + 发送请求
const user = await forge.api('admin', 'users.show', { user: 123 })

// 生成 URL — 仅拼路径，不发请求
const url = forge.route('public', 'login.show')
// → '/login'

// 手动管理层级加载
await forge.load('admin')
forge.invalidate('admin')
```

参数支持智能消解：路径参数平铺传入，`query`/`body`/`headers` 为固定 key。路径参数名与固定 key 冲突时，
`string|number` 值自动识别为路径参数，也可通过 `params` 显式指定：

```ts
// 路由: /search/{query}
forge.api('admin', 'search.show', { query: 'keyword' })           // query → 路径参数
forge.api('admin', 'search.show', { params: { query: 'keyword' }, query: { page: 1 } }) // 显式指定
```

#### Vue 3 集成

```ts
// main.ts
import { createApp } from 'vue'
import { createRouteForgePlugin } from '@route-forge/vue'

const app = createApp(App)
app.use(createRouteForgePlugin({
  endpoint: '/_forge/routes',
}))
app.mount('#app')
```

```vue

<script setup lang="ts">
  import { useForge, useForgeApi } from '@route-forge/vue'

  // 绑定层级 — 后续调用无需再传 level
  const forge = useForge('admin')
  const user = await forge('users.show', { user: 1 })

  // 绑定层级 + 前缀 — 路由名自动拼接
  const userForge = useForge('admin', 'users')
  const user2 = await userForge('show', { user: 1 })  // → admin.users.show

  // 带 loading / error 状态的 API 调用（同样支持 level 绑定和前缀）
  const { call, pending, error } = useForgeApi('admin')
  const { data } = await call('users.show', { user: 1 })

  const { call: callUser } = useForgeApi('admin', 'users')
  const { data: user3 } = await callUser('show', { user: 1 })
</script>

<template>
  <a :href="$forge.route('public', 'login.show')">登录</a>
</template>
```

### 4. 类型生成（可选）

后端 Artisan 命令从路由注册表生成 TS 类型声明，编译期校验路由名和参数：

```bash
php artisan route:forge:types --out=../frontend/src/types/forge-routes.d.ts
```

生成的类型文件包含二级映射 `ForgeRouteMap`（level → routeName → meta），通过 TypeScript 模块增强自动生效：

```ts
// 生成后，路由名错拼在编译期即报错，参数类型自动推断
forge.api('admin', 'users.show', { user: 123 })  // ✅ OK — 'users.show' 自动补全，{ user } 类型校验
forge.api('admin', 'users.sho', { user: 123 })   // ❌ TS Error: 路由名不存在
forge.api('admin', 'users.show', { uid: 123 })   // ❌ TS Error: 参数名应为 user
```

## Adapter 适配

`createRouteForge({ adapter })` 支持多种 HTTP 客户端策略：

| 取值             | 行为                                                                  |
|------------------|-----------------------------------------------------------------------|
| `'auto'`（默认） | 检测到宿主有 axios 则复用（继承拦截器/配置），否则使用内置 fetch 实现 |
| `'axios'`        | 强制使用宿主 axios，未安装则报错                                      |
| `'builtin'`      | 强制使用内置 fetch 实现，即使装了 axios 也不复用                      |
| 自定义 Fetcher   | 传入符合 `Fetcher` 接口的对象，完全自定义                             |

内置 builtin adapter 基于原生 `fetch`，零外部依赖，min+gzip < 3KB，拦截器行为与 axios 完全一致。

## 开发

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8

### 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建所有包
pnpm build

# 运行测试
pnpm test

# 代码检查
pnpm lint

# 类型检查
pnpm typecheck

# 清理构建产物
pnpm clean
```

### 发布

```bash
# 类型检查 → 测试 → 构建 → 发布 core 和 vue 包
pnpm publish:build

# 或单独发布某个包
pnpm publish:core
pnpm publish:vue
```

## 兼容性

| 依赖    | 版本支持                                                                                  |
|---------|-------------------------------------------------------------------------------------------|
| Laravel | 9 / 10 / 11（详见 [route-forge-laravel](https://github.com/xyj2156/route-forge-laravel)） |
| Vue     | 3.3+（不支持 Vue 2）                                                                      |
| Node.js | LTS 版本（18 / 20 / 22）                                                                  |
| 浏览器  | 现代浏览器（Chrome / Edge / Firefox / Safari 最近 2 个大版本），不支持 IE                 |

## 文档

- [功能规格说明书](.docs/SPEC.md) — 完整的功能定义与 API 规范
- [设计思路](.docs/DESIGN.md) — 架构决策与演进思路
- [@route-forge/core](packages/core/README.md) — 核心包文档
- [@route-forge/vue](packages/vue/README.md) — Vue 3 集成文档

## License

[MIT](LICENSE) © 阿杰很厉害
