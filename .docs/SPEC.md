# Route Forge — 功能规格说明书

> 对外功能承诺，所有实现都应对照此文档验证。

## 1. 产品概述

**Route Forge** 是 Laravel 命名路由的全链路解决方案，包含：

- **route-forge/laravel**（composer 包）：后端路由扫描、分级、缓存、API 端点
- **@route-forge/core**（npm 包）：框架无关的命名路由客户端核心
- **@route-forge/vue**（npm 包）：Vue 3 集成（插件 + composable）
- **@route-forge/react**（npm 包，规划中）：React 集成

## 2. 目标用户

| 画像              | 典型场景                                      |
| --------------- | ----------------------------------------- |
| Laravel 全栈开发者   | Laravel + Vue/React SPA 项目，想让前端调用 API 更优雅 |
| 大型 SPA 项目维护者    | 接口数 > 100，首屏性能敏感                          |
| 多角色系统开发者        | 有 admin/user/guest 等多种权限级别                |
| TypeScript 重度用户 | 要求前后端全链路类型安全                              |

## 3. 后端功能（route-forge/laravel）

### 3.1 核心能力

Route Forge 提供三种互相兼容的路由层级分配方式，任选其一或组合使用。三层级名（如 `admin/manage/client`、`public/user/admin`）完全由项目自定义，包不预设固定层级（见 DESIGN.md §6.4）。

#### 3.1.1 定义路由时显式标记（`->tier()` 宏）

通过宏 `tier()` 在定义路由时显式标记所属层级，链式调用对资源路由同样生效：

```php
Route::post('/auth/login', [AuthController::class, 'login'])
    ->name('auth.login')
    ->tier('public');

Route::resource('users', UserController::class)
    ->tier('manage');
```

宏通过 ServiceProvider 注册到 `Illuminate\Routing\Route`，仅向 action 数组写入一个 `tier` 字段，零侵入：

```php
Route::macro('tier', function (string $tier) {
    $this->action['tier'] = $tier;
    return $this;
});
```

#### 3.1.2 配置文件按规则批量分配

`config/forge.php` 中按 `match` 规则把路由批量匹配到对应层级，无需逐条标注：

```php
// config/forge.php
return [
    'levels' => [
        'public' => [
            'description' => '公共接口（无需登录）',
            'match' => [
                'prefix'     => ['auth', 'public'],
                'middleware' => [],
            ],
            'load'  => 'eager',
            'cache' => 3600,
        ],
        'client' => [
            'description' => '客户端用户接口',
            'match' => [
                'prefix'     => ['client'],
                'middleware' => ['auth'],
            ],
            'load'  => 'lazy',
        ],
        'manage' => [
            'description' => '运营管理接口',
            'match' => [
                'prefix'     => ['manage'],
                'middleware' => ['auth', 'manage'],
            ],
            'load'  => 'lazy',
        ],
        'admin' => [
            'description' => '系统管理接口',
            'match' => [
                'prefix'     => ['admin'],
                'middleware' => ['auth', 'admin'],
            ],
            'load'  => 'lazy',
        ],
    ],

    'endpoint_prefix' => '_forge/routes',  // 路由元信息对外端点前缀
    'cache_driver'    => null,             // null=使用默认缓存驱动
    'strict_mode'     => false,            // 严格模式：未命中层级即抛异常
    'fallback_level' => 'public',        // strict_mode=false 时的兜底层级
    'classifier'     => null,            // 自定义分类回调，签名 fn(Route $r): ?string
];
```

匹配规则：

- `prefix`：路由 URI 命中任一前缀即归入此层级（支持多个）。
- `middleware`：路由中间件集合包含 `middleware` 数组中任意一项即命中。
- 显式 `->tier()` 标记优先级最高，覆盖配置匹配结果（见 3.1.4）。
- 多个层级同时命中时，按 `levels` 数组定义顺序取第一个。
- 全部未命中：`strict_mode=true` 抛 `RouteTierNotAssignedException`；`strict_mode=false` 归入 `fallback_level`。
- `classifier` 回调优先级介于「显式 tier」与「配置 match」之间，用于实现复杂自定义分类逻辑（如基于 Controller 命名空间归类）。

#### 3.1.3 路由分组分配层级（`Route::group` 透传）

在 `Route::group` 上支持 `tier` 选项，整组路由继承层级，避免重复标注。命名空间、中间件、前缀等 Laravel 原生 group 选项继续正常工作：

```php
Route::group([
    'prefix'     => 'admin',
    'middleware' => ['auth', 'admin'],
    'tier'       => 'admin',   // ← 新增选项
], function () {
    Route::get('/users', [AdminUserController::class, 'index'])
         ->name('admin.users.index');
    Route::post('/users', [AdminUserController::class, 'store'])
         ->name('admin.users.store');
    // 组内所有路由自动归属 admin 层级
});
```

嵌套 group 行为（与 Laravel 中 `middleware` 合并策略一致）：

```php
Route::group(['tier' => 'admin'], function () {
    Route::get('/a', ...);              // admin

    Route::group(['tier' => 'manage'], function () {
        Route::get('/b', ...);          // manage（内层覆盖外层）
    });
});
```

实现方式：包在 boot 阶段监听 `Route::group` 调用，把 `tier` 透传到组内每条路由的 action，等价于自动给组内每条路由调用 `->tier()`。因此分组标记与显式 `->tier()` 等价，仅是语法糖。

#### 3.1.4 层级分配优先级

当多种分配方式并存时，按以下优先级决定一条路由的最终层级（高优先级覆盖低优先级）：

1. **显式** **`->tier()`** **调用**（最高）
2. **`Route::group`** **的** **`tier`** **选项**（继承自最近一层 group，内层覆盖外层）
3. **`classifier`** **自定义回调**返回非 null 值
4. **配置文件** **`match`** **规则**匹配
5. **`fallback_level`** 兜底（仅 `strict_mode=false` 时生效）

> 优先级设计意图：显式标注胜过隐式分组，分组胜过全局规则，全局规则胜过兜底。这样既支持零配置跑通（配置匹配 + 兜底），又允许对特殊路由做精确覆盖（显式 `->tier()`）。

#### 3.1.5 层级元信息查询端点

包在 `endpoint_prefix`（默认 `_forge/routes`）下注册端点，按层级返回路由元信息（名称 + URI + method + 参数定义），供前端按需懒加载：

```
GET /_forge/routes/{level}   # 返回该层级下所有命名路由的元信息
```

返回示例：

```json
{
  "level": "admin",
  "routes": {
    "admin.users.index": {
      "uri": "admin/users",
      "methods": ["GET","HEAD"],
      "parameters": []
    },
    "admin.users.show": {
      "uri": "admin/users/{user}",
      "methods": ["GET","HEAD"],
      "parameters": ["user"]
    }
  }
}
```

缓存：响应按层级独立缓存（`cache` 配置项控制 TTL，单位秒，`null` 不缓存）。

## 4. 前端功能（@route-forge/core + @route-forge/vue）

### 4.1 核心能力

`@route-forge/core` 是框架无关的命名路由客户端核心，提供按层级懒加载、隔离缓存、并发去重、登录态感知四项基础能力。`@route-forge/vue` 在其上提供 Vue 3 插件与 composable。

#### 4.1.1 客户端初始化

```ts
import { createRouteForge } from '@route-forge/core';

const forge = createRouteForge({
  endpoint: '/_forge/routes',   // 后端元信息端点前缀，与 forge.endpoint_prefix 对齐
  levels: ['public', 'client', 'manage', 'admin'],  // 与后端 levels 键对齐
  eager: ['public'],             // 初始化时立即拉取的层级
  adapter: 'auto',             // 'auto'（默认）| 'axios' | 'builtin' | 自定义 Fetcher
  // 'auto' 解析顺序：
  //   1. 检测到宿主项目装了 axios → 用 axios（自动复用其拦截器配置）
  //   2. 否则 → 使用包内置的类 axios 精简实现（见 4.1.8）
  // 显式传 'axios' 强制使用宿主 axios（未安装则抛 AdapterNotFoundError）
  // 显式传 'builtin' 强制使用内置实现（即使装了 axios 也不用）
  // 传自定义 Fetcher 接口（见 4.1.8a）跳过 auto 检测
  cache: {
    ttl: 3600,                  // 默认缓存 TTL（秒），可被后端 levels[level].cache 覆盖
    storage: 'memory',          // 'memory' | 'sessionStorage' | 'localStorage'
  },
  auth: {
    state: () => isLoggedIn(),  // 登录态读取函数；返回 false 时跳过需登录层级
    levels: { client: true, manage: true, admin: true },  // 标记哪些层级依赖登录
  },
  interceptors: {              // 声明式注册（等价于 forge.interceptors.use），可选
    request: [
      (config) => { config.headers.Authorization = `Bearer ${token()}`; return config; }, // onFulfilled 可以为undefined
      (err) => Promise.reject(err),  // onRejected 可以为 undefined
    ],
    response: [
      (res) => res.data?.data ?? res.data,  // onFulfilled 
      (err) => handle401(err),              // onRejected 可以为 undefined
    ],
  },
});

// 运行时动态注册（与 axios 一致）：use() 返回 id，eject(id) 移除
// 可多次调用 use() 注册多个拦截器，内部以数组保存，按注册顺序执行
const idAuth = forge.interceptors.request.use(
  (config) => { config.headers.Authorization = `Bearer ${token()}`; return config; },
);
const idLog = forge.interceptors.request.use(
  (config) => { console.debug('[forge]', config.route, config.method); return config; },
);
// 执行顺序：idAuth → idLog（按注册顺序，先注册先执行）

// 移除时通过 eject(id) 移除指定拦截器，互不影响
forge.interceptors.request.eject(idLog);   // 仅移除日志拦截器，鉴权拦截器保留

// 一键清空所有拦截器（如登出时重置）
forge.interceptors.request.clear();
```

设计要点：

- `levels` 数组仅用于声明存在性，**不预设层级名**，与后端 `levels` 配置一一对应即可（DESIGN.md §6.4）。
- `eager` 列表里出现的层级会在 `createRouteForge()` 同步阶段触发拉取；其余层级按调用懒加载。
- `adapter` 默认 `'auto'`：优先复用宿主项目已有的 axios（自动继承其拦截器/默认配置），未检测到则降级使用包内置的类 axios 精简实现（见 4.1.8）。这样既能与已用 axios 的项目无缝集成（开发者熟悉的 API + 已有拦截器复用），又能在零依赖的轻量项目里开箱即用。
- `interceptors` 与所有内置 adapter（axios、builtin）行为一致，均按 4.1.3 的执行规则工作；自定义 Fetcher 接口需自行实现拦截器逻辑（详见 4.1.8）。

#### 4.1.2 按层级懒加载与隔离缓存

```ts
// 显式拉取某层级（已加载则直接返回缓存，未加载则发起请求）
await forge.load('admin');

// 多层级并发拉取（内部自动去重，详见 4.1.4）
await forge.load(['client', 'manage']);
```

缓存规则：

- 每层级缓存条目独立存放，互不污染。拉取 `admin` 不会把 `manage` 的路由带过去。
- 缓存 key 为 `route-forge:${level}`，按 `cache.storage` 配置选择存储介质。
- TTL 优先使用后端响应里返回的 `cache` 字段；前端 `cache.ttl` 仅作本地兜底（防止后端没返回时无限缓存）。
- 调用 `forge.invalidate(level?)` 手动失效：传参失效指定层级，不传则失效全部。
- `storage: 'localStorage'` 时，跨会话保留路由表；`sessionStorage` 仅当前标签页有效；`memory` 重载即丢。

#### 4.1.3 通过路由名调用 API（核心 API）

前端不需要关心 URL 和 HTTP 方法，只需路由名 + 参数：

```ts
// 等价于 GET /admin/users/123
const user = await forge.api('admin.users.show', { user: 123 });

// 等价于 POST /manage/users + JSON body
const created = await forge.api('manage.users.store', { body: { name: 'Alice' } });

// 路由参数 + query + body 同时存在
await forge.api('client.posts.update', {
  post: 456,           // 路径参数：填充到 posts/{post}
  query: { silent: true },  // 查询参数
  body: { title: 'new' },    // 请求体
});
```

调用流程：

1. 按路由名查本地缓存；若该路由所在层级未加载，自动 `forge.load(level)` 等待完成（**隐式懒加载**）。
2. 从路由元信息读取 `uri` 和 `methods`，取第一个非 `HEAD` 的方法作为请求方法。
3. 用传入的路径参数填充 URI 模板（`{user}` → `123`），剩余参数不允许填充路径。
4. 拼 query、序列化 body，构建 `RequestConfig`（详见 4.1.3a）。
5. **请求拦截链**：按**注册顺序**（先注册先执行）依次执行 `forge.interceptors.request` 中已注册的 `onFulfilled`，每段接收上一段返回的 `RequestConfig` 并可修改后返回；任一段抛错则跳到请求拦截的 `onRejected`，仍抛错则进入调用方 `catch`，不再发请求。
6. 调用 adapter 发请求。
7. **响应拦截链**：HTTP 2xx 时，按**注册顺序**（先注册先执行）依次执行 `forge.interceptors.response` 的 `onFulfilled`，每段接收上一段返回值（首段接收 `ResponseData`，详见 4.1.3a）并返回新值；末段返回值即为 `forge.api()` 的 `resolve` 值。
8. **错误拦截链**：HTTP 非 2xx 或任一 `onFulfilled` 抛错时，按正序执行 `forge.interceptors.response` 的 `onRejected`；任一段 `reject` 或全部跳过则进入调用方 `catch`；某段返回值则恢复为正常流程，继续执行后续 `onFulfilled`。
9. 严格模式下（见 4.1.6）校验：路径参数齐全、方法与路由定义一致、未声明多余路径参数。

#### 4.1.3a 拦截器签名

```ts
// 请求拦截器接收的配置对象（可变，返回修改后的版本）
type RequestConfig = {
  route: string;            // 路由名，如 'admin.users.show'
  level: string;            // 层级，如 'admin'
  method: string;           // HTTP 方法，如 'GET'
  url: string;              // 完整 URL（含 query string）
  headers: Record<string, string>;
  body?: unknown;           // 请求体（已序列化前）
  params: Record<string, unknown>;  // 已填入路径的参数
  meta: RouteMeta;          // 路由元信息（uri/methods/parameters 等）
};

// 响应拦截器接收的数据对象（首段 onFulfilled 接收完整 ResponseData，后续段接收上一段返回值）
type ResponseData = {
  route: string;
  level: string;
  method: string;
  url: string;
  status: number;           // HTTP 状态码
  headers: Headers;         // 响应头
  data: unknown;            // 响应体（adapter 已按 Content-Type 解析）
  config: RequestConfig;    // 触发本次请求的配置（请求拦截链输出）
};

// 拦截器函数：支持同步返回或 async/Promise
type RequestInterceptor  = (config: RequestConfig)  => RequestConfig | Promise<RequestConfig>;
type ResponseInterceptor = (response: ResponseData) => unknown | Promise<unknown>;
type ErrorHandler        = (error: unknown) => unknown | Promise<unknown>;

// 注册 API（与 axios 一致）：use() 返回 id，eject(id) 移除
interface InterceptorManager<T> {
  use(onFulfilled?: (value: T) => T | Promise<T>,
      onRejected?: (error: unknown) => unknown | Promise<unknown>): number;
  eject(id: number): void;
  clear(): void;
}

forge.interceptors.request:  InterceptorManager<RequestConfig>;
forge.interceptors.response: InterceptorManager<ResponseData>;
```

设计约定：

- **执行顺序**：请求拦截和响应拦截统一按**注册顺序**（先注册先执行）执行。内部以数组保存拦截器列表，`use()` 时按调用顺序入栈，遍历时正序消费。
  > 与 axios 的差异：axios 请求拦截逆序、响应拦截正序，规则不对称；Route Forge 统一正序，规则更简单直观。鉴权头等需要在最前面执行的拦截器，应在初始化时最先 `use()` 注册。
  > 顺序保证：注册顺序 = 执行顺序，声明式配置（`interceptors.request/response` 数组）按数组顺序注册，运行时 `use()` 按调用顺序注册，二者混用时声明式先于运行时注册的部分。
- **拦截器返回值**：请求拦截必须返回 `RequestConfig`（或 Promise），返回非对象会抛 `InvalidInterceptorReturnError`；响应拦截首段接收 `ResponseData`，后续段接收上一段返回值，类型由用户自行约束（默认 `unknown`）。
- **错误传播**：
  - 请求拦截 `onFulfilled` 抛错 → 同管理器的 `onRejected` 链 → 仍未消化则进入调用方 `catch`，不发请求。
  - 响应拦截 `onFulfilled` 抛错 / HTTP 非 2xx → `onRejected` 链；某段 `onRejected` 返回值则恢复正序流程，继续后续 `onFulfilled`。
- **`use`/`eject`/`clear`**：完全沿用 axios API：`use()` 返回自增 id，`eject(id)` 移除指定拦截器，`clear()` 一次清空全部（如登出重置）。注册时机不限于初始化，可任意时刻动态添加。
- **不缓存 API 响应**：拦截器只处理本次调用的请求/响应，路由表缓存（4.1.2）不受影响；同一路由多次调用会重复跑拦截链，便于实时变更（如 token 刷新）。
- **声明式配置 vs 运行时 API**：`createRouteForge({ interceptors: {...} })` 等价于创建后立即调用 `forge.interceptors.request.use(...)` / `response.use(...)`，二者可混用，运行时 API 用于需要按条件注册或动态移除的场景。
- **每调用方独立需求**：与 axios 一致，**不提供调用级拦截器覆盖**。如需按路由分支处理，请在拦截器内部用 `config.route` / `res.route` 判断；如需一次性后处理，请在 `forge.api()` 返回后再做。

#### 4.1.4 并发控制与去重

同层级并发请求自动合并为一次：

```ts
// 首屏 10 个组件同时调用 forge.api('admin.xxx', ...)，但 admin 层级尚未加载
// 内部只发起 1 次 GET /_forge/routes/admin，10 个调用共用加载完成的 Promise
const [a, b, c] = await Promise.all([
  forge.api('admin.users.index'),
  forge.api('admin.users.show', { user: 1 }),
  forge.api('admin.roles.list'),
]);
```

去重规则：

- 同层级并发 `load()` 共享一个 inflight Promise，第二个调用直接 await，不再发请求。
- 加载完成后落盘缓存，后续调用走缓存。
- `forge.invalidate(level)` 后的下一次 `load` 重新发起请求，并再次进入 inflight 去重。

批量预加载接口提供 `Promise.all` 友好的入口：

```ts
await forge.load(['client', 'manage', 'admin']);  // 并发去重 + 并发请求
```

#### 4.1.5 登录态感知

前端通过 `auth.state()` 函数读取登录态，避免未登录用户拉取受保护层级的路由表（同时减少无效请求与信息泄露，DESIGN.md §2.2）：

```ts
const forge = createRouteForge({
  auth: {
    state: () => authStore.isLoggedIn,
    levels: { client: true, manage: true, admin: true },
  },
});

// 未登录时：
await forge.load('client');   // 抛 InsufficientAuthError，不发请求
await forge.api('client.xxx'); // 同上

// 登录后：
authStore.isLoggedIn = true;
await forge.load('client');    // 正常拉取
```

行为约定：

- `auth.state()` 返回 `false` 且目标层级在 `auth.levels` 里标记为 `true`：拒绝拉取，抛 `InsufficientAuthError`。
- `public` 层级（未在 `auth.levels` 中标记）不受登录态影响，随时可拉取，供登录页等场景使用。
- 登录态变化时，业务侧需主动调用 `forge.invalidate()` 清空受保护层级的缓存，避免脏数据。
- 后端在 `auth.levels` 标记的层级对应的端点应配合 `auth` 中间件，前端拦截只是优化体验，权限判定以后端为准。

#### 4.1.6 严格模式

前端同样有 `strict_mode` 开关（默认与后端配置一致，可通过 `createRouteForge({ strict: true })` 覆盖）：

| 场景 | strict=true | strict=false |
|---|---|---|
| 路径参数缺失 | 抛 `MissingRouteParamError` | 用空字符串填充并告警 |
| 路由名不存在 | 抛 `UnknownRouteError` | 返回 `undefined`，由调用方自行处理 |
| 路由所在层级未声明 | 抛 `UnknownLevelError` | 静默忽略 |
| 未登录访问受保护层级 | 抛 `InsufficientAuthError` | 同左（安全相关不允许放行） |

> 设计意图（DESIGN.md §5 原则 2）：严格模式默认开启以暴露问题，但保留逃生口便于存量项目渐进接入。

#### 4.1.7 Vue 3 集成（`@route-forge/vue`）

```ts
// main.ts
import { createApp } from 'vue';
import { createRouteForgePlugin } from '@route-forge/vue';

const app = createApp(App);
app.use(createRouteForgePlugin({ /* 同 4.1.1 */ }));
app.mount('#app');
```

组件内使用：

```vue
<script setup lang="ts">
import { useForgeApi } from '@route-forge/vue';

const { api, pending, error } = useForgeApi();

// 调用形参与 forge.api 一致；返回值带响应式状态
const { data, error: callError } = await api('admin.users.show', { user: 123 });
</script>
```

插件提供的能力：

- `useForgeApi()`：包装 `forge.api()`，自动管理 loading/error 状态。
- `useForgeByPrefix(prefix)`：带指定名字前缀的封装 方便后续减少名称传入。
- `useForgeLevel(level)`：声明组件依赖某层级，挂载时自动 `forge.load(level)`，组件销毁时不主动失效。
- `useForgeRoute(name, params?)`：仅生成 URL，不发请求（用于 `<a href>`、外部跳转等）。
- 全局属性 `$forge` 与模板内 `{{ $forge.route('admin.users.show', { user: 1 }) }}` 工具函数。

### 4.2 类型生成（可选）

包提供 CLI 把后端路由表生成为 TS 类型声明，让 `forge.api()` 调用全链路类型安全（DESIGN.md §2.4）：

```bash
npx @route-forge/core codegen \
  --endpoint http://localhost/_forge/routes \
  --levels public,client,manage,admin \
  --out src/types/forge-routes.d.ts
```

生成结果示例：

```ts
declare const routes: {
  'admin.users.show': {
    method: 'GET';
    params: { user: string | number };
    // 响应类型默认 unknown，可通过 --response-types 映射文件补充
    response: unknown;
  };
  'manage.users.store': {
    method: 'POST';
    params: {};
    body: unknown;
    response: unknown;
  };
};
```

类型推导链路：`forge.api('admin.users.show', { user: 123 })` 的参数类型由生成声明约束，路由名字面量错拼在编译期即报错。响应类型默认 `unknown`，需要业务侧通过单独的响应类型映射文件补全（避免侵入后端代码）。

### 4.3 Adapter 与内置类 axios 实现

为保证拦截器在所有部署环境下行为一致，Route Forge 提供一个**包内置的类 axios 精简实现**作为默认 fallback adapter，无需安装 axios 即可工作。同时支持把宿主项目的 axios 作为 adapter，复用其拦截器与默认配置。

#### 4.3.1 内置 builtin adapter

包内部实现一个轻量级 axios 子集（命名为 `@route-forge/builtin-http`，不对外单独发布，作为 `@route-forge/core` 的内部模块存在）。能力清单：

- `request(config)` / `get/post/put/patch/delete(url, config)` 便捷方法。
- `interceptors.request` / `interceptors.response`，与 axios 完全一致的 `use()/eject(id)/clear()` API。
- 请求/响应拦截器执行规则（注册顺序、错误分支、`onRejected` 恢复）与 4.1.3 完全一致。
- 默认按 `Content-Type` 自动 JSON 解析响应体；超时、`AbortSignal`、查询参数序列化（`paramsSerializer`）支持。
- 底层基于宿主环境 `fetch`（Node 18+ / 现代浏览器原生支持）。
- 体积目标：min+gzip < 3KB，仅作为兜底，不追求覆盖 axios 全部 API。

设计原则：

- **API 兼容优先**：内置实现刻意保持与 axios 拦截器调用约定一致，便于业务代码在两套 adapter 间零成本切换。
- **能力聚焦**：仅实现 Route Forge 调用链需要的能力（拦截器、JSON、超时、取消）。axios 的高级特性（`transformRequest`/`transformResponse`、`adapter` 自定义、`auth` Basic 等）不实现——这些可通过拦截器等价表达。
- **零依赖**：不依赖 ofetch/axios 任何第三方包；仅依赖宿主原生 `fetch`。

#### 4.3.2 Adapter 选择机制

`createRouteForge({ adapter })` 接受以下值：

| 取值 | 行为 |
|---|---|
| `'auto'`（默认） | 检测到宿主装了 axios（`require.resolve('axios')` 成功 / 全局有 `axios`）→ 用之；否则用内置 builtin adapter |
| `'axios'` | 强制使用宿主 axios；未安装则抛 `AdapterNotFoundError`，附安装提示 |
| `'builtin'` | 强制使用内置实现，即使宿主装了 axios 也不复用 |
| 自定义 Fetcher | 传入符合 `Fetcher` 接口（见 4.3.3）的对象，绕过 auto 检测 |

auto 检测的执行时机：

1. `createRouteForge()` 同步阶段尝试检测。
2. 检测方式：优先 `import('axios')` 动态探测（ESM 友好）；失败则查全局 `window.axios`（浏览器场景，便于 CDN 引入）；仍失败则用内置实现。
3. 选定后不再切换；如运行时宿主才装上 axios，需要重新 `createRouteForge()`。

> 设计意图：兼顾「已用 axios 的存量项目」与「零依赖的新项目」。前者自动复用已有 axios 实例（含其拦截器、`baseURL`、`default.headers` 等配置），后者无需任何额外安装即可开箱。

#### 4.3.3 自定义 Fetcher 接口

不想用 axios 也不想用内置实现的用户，可传一个对象作为 adapter：

```ts
type Fetcher = {
  request(config: RequestConfig): Promise<ResponseData>;
  interceptors?: {
    request?:  InterceptorManager<RequestConfig>;
    response?: InterceptorManager<ResponseData>;
  };
};

// 使用示例
const forge = createRouteForge({
  adapter: {
    async request(config) {
      const res = await myKyInst(config.url, { method: config.method, ... });
      return { route: config.route, /* ... 其他 ResponseData 字段 */ };
    },
    // 拦截器管理可选；若不提供，则 forge.interceptors.* 对该 adapter 不生效
    interceptors: undefined,
  },
});
```

约束：

- 自定义 Fetcher 必须返回 `ResponseData`（结构见 4.1.3a），由 Route Forge 接管后续拦截链处理。
- 如果想保留拦截器能力，需自行实现 `InterceptorManager` 接口；或直接借用内置 builtin adapter 的实现（包会导出 `createInterceptorManager()` 工厂函数）。
- 当 `adapter.interceptors` 为 `undefined` 时，`forge.interceptors.request/response` 仍可调用但不会生效（运行时无操作 + 开发模式告警）。

#### 4.3.4 与 axios 宿主实例的关系

当 `adapter: 'auto'` 检测到宿主 axios 时：

- Route Forge **不会**接管或修改宿主 axios 实例的拦截器。
- 宿主 axios 已注册的拦截器（如全局鉴权、错误上报）会先执行；Route Forge 自己 `forge.interceptors.use()` 注册的拦截器在宿主拦截器之后执行。
- 宿主 axios 的 `defaults.baseURL`、`defaults.headers` 等配置继承生效；Route Forge 不会覆盖，只在调用时追加 `url`/`method`/`headers`/`data`。
- 若宿主 axios 拦截器与 Route Forge 拦截器行为冲突（如都改 `Authorization`），后者覆盖前者。

> 设计意图：把 Route Forge 视为「在已有 axios 之上叠加的路由层」，而非替代宿主 HTTP 客户端。已有 axios 配置保持不变，Route Forge 只负责路由解析与命名调用，把 HTTP 细节交给宿主。

## 5. 配置项参考

### 5.1 后端 config/forge.php

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `levels` | `array<string, LevelConfig>` | 见 3.1.2 | 层级定义表，键为层级名（自定义），值为该层级的匹配规则与缓存策略 |
| `levels.{name}.description` | `string` | `''` | 层级描述，仅用于文档与调试输出 |
| `levels.{name}.match.prefix` | `string[]` | `[]` | URI 前缀匹配列表，命中任一即归入此层级 |
| `levels.{name}.match.middleware` | `string[]` | `[]` | 中间件匹配列表，路由中间件集合包含任一即命中 |
| `levels.{name}.load` | `'eager'\|'lazy'` | `'lazy'` | 是否在端点响应里标记为「前端应预加载」；前端可读后自行决定是否拉取 |
| `levels.{name}.cache` | `int\|null` | `null` | 该层级元信息缓存 TTL（秒）；`null` 不缓存，`0` 永久缓存 |
| `endpoint_prefix` | `string` | `'_forge/routes'` | 路由元信息对外端点前缀 |
| `cache_driver` | `string\|null` | `null` | 缓存驱动；`null` 用默认驱动，可指定 `redis`/`file`/`array` 等 |
| `strict_mode` | `bool` | `false` | 严格模式；未命中层级时抛异常（true）或归入 fallback（false） |
| `fallback_level` | `string\|null` | `null` | 兜底层级名；`strict_mode=false` 时未命中路由归入此层级；`null` 表示不兜底（路由仍可被前端调用，但元信息端点不返回） |
| `classifier` | `callable\|null` | `null` | 自定义分类回调，签名 `fn(Route $r): ?string`，返回层级名或 null |

### 5.2 前端 createRouteForge 配置

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `endpoint` | `string` | 必填 | 后端元信息端点前缀，与后端 `endpoint_prefix` 对齐 |
| `levels` | `string[]` | 必填 | 声明存在的层级名列表，与后端 `levels` 键一一对应 |
| `eager` | `string[]` | `[]` | 初始化时立即拉取的层级（通常含 `public`） |
| `adapter` | `'auto'\|'axios'\|'builtin'\|Fetcher` | `'auto'` | 详见 §4.3.2 |
| `cache.ttl` | `number` | `3600` | 本地兜底缓存 TTL（秒）；后端响应 `cache` 字段优先 |
| `cache.storage` | `'memory'\|'sessionStorage'\|'localStorage'` | `'memory'` | 缓存存储介质 |
| `auth.state` | `() => boolean` | `() => true` | 登录态读取函数 |
| `auth.levels` | `Record<string, boolean>` | `{}` | 标记哪些层级依赖登录态 |
| `interceptors.request` | `Array<[onFulfilled?, onRejected?]>` | `[]` | 声明式请求拦截器列表 |
| `interceptors.response` | `Array<[onFulfilled?, onRejected?]>` | `[]` | 声明式响应拦截器列表 |
| `strict` | `boolean` | `true` | 前端严格模式，覆盖后端 `strict_mode`；详见 §4.1.6 |
| `timeout` | `number` | `30000` | 默认请求超时（毫秒） |
| `baseURL` | `string` | `''` | 前端 baseURL；为空时使用相对路径 |
| `nameSeparator` | `string` | `'.'` | 路由名分隔符（如 `admin.users.show` 用 `.`） |

### 5.3 配置覆盖关系

后端配置 → 前端运行时配置 → 单次调用参数，三层覆盖：

```
后端 forge.php                前端 createRouteForge        forge.api(name, params)
─────────────                ──────────────────          ───────────────────────
levels[level].cache    ←───  cache.ttl（兜底）
endpoint_prefix         ←───  endpoint
strict_mode             ←───  strict（覆盖）              （单次调用不覆盖全局规则）
```

- 后端 `cache` 字段通过响应头/响应体下发，前端优先使用。
- 前端 `strict` 默认与后端 `strict_mode` 一致；显式传入则覆盖。
- 单次 `forge.api()` 调用不能覆盖全局规则（与 axios 一致），如需分支处理请用拦截器内 `config.route` 判断。

## 6. 错误码

所有 Route Forge 抛出的错误都继承自 `ForgeError`，附带 `code`、`route`、`level`、`context` 字段，便于调用方 catch 后统一处理。

### 6.1 后端错误

| 错误类 | code | 触发场景 | HTTP 状态 |
|---|---|---|---|
| `RouteTierNotAssignedException` | `RF_BE_001` | `strict_mode=true` 且路由未命中任何层级 | 500 |
| `UnknownLevelException` | `RF_BE_002` | 请求的层级名不在 `levels` 配置中 | 404 |
| `CacheDriverException` | `RF_BE_003` | 指定的 `cache_driver` 不可用 | 500 |
| `ClassifierException` | `RF_BE_004` | `classifier` 回调抛错 | 500 |

### 6.2 前端错误

| 错误类 | code | 触发场景 |
|---|---|---|
| `UnknownRouteError` | `RF_FE_001` | 路由名不存在于已加载层级中 |
| `UnknownLevelError` | `RF_FE_002` | 路由所在层级未在 `levels` 声明 |
| `MissingRouteParamError` | `RF_FE_003` | 路径参数缺失（strict=true 时） |
| `InsufficientAuthError` | `RF_FE_004` | 未登录访问受保护层级 |
| `AdapterNotFoundError` | `RF_FE_005` | `adapter: 'axios'` 但未检测到 axios |
| `InvalidInterceptorReturnError` | `RF_FE_006` | 请求拦截器返回非 `RequestConfig` |
| `NetworkError` | `RF_FE_007` | adapter 抛出的网络错误（DNS、连接超时等） |
| `HTTPError` | `RF_FE_008` | HTTP 非 2xx 且未被 `onRejected` 拦截器恢复 |

### 6.3 错误对象结构

```ts
class ForgeError extends Error {
  readonly code: string;        // 如 'RF_FE_003'
  readonly route?: string;      // 触发错误的路由名（如适用）
  readonly level?: string;      // 触发错误的层级（如适用）
  readonly context?: Record<string, unknown>;  // 额外上下文（如缺失的参数名、HTTP 状态等）
  readonly cause?: unknown;     // 原始错误（如 adapter 抛出的底层错误）
}
```

约定：

- 所有错误都可通过 `error.code` 精确匹配，便于在 `onRejected` 拦截器中分支处理。
- `error.route` / `error.level` 让错误日志能定位到具体路由，便于排查。
- `error.cause` 保留原始错误链，便于深层调试；序列化时建议只输出 `code + route + message`。
- 网络层与 HTTP 层错误（`NetworkError`/`HTTPError`）的 `context` 包含 `status`、`url`、`method`、`headers`。
- 拦截器 `onRejected` 收到的错误都是 `ForgeError` 实例；用户在 `onRejected` 中抛新错误会替换原错误（与 axios 一致）。

## 7. 测试矩阵

### 7.1 后端测试（PHPUnit）

| 测试维度 | 覆盖点 |
|---|---|
| 层级分配 | 显式 `->tier()`、配置 match、`Route::group` 透传、classifier、fallback、优先级覆盖 |
| 端点响应 | `/_forge/routes/{level}` 返回结构、缓存命中、未声明层级 404 |
| 严格模式 | `strict_mode=true` 未命中抛异常、`false` 归入 fallback |
| Laravel 兼容 | Laravel 9/10/11 三版本矩阵；资源路由、嵌套 group、命名空间 |
| 缓存 | `cache_driver` 各驱动（redis/file/array）、TTL 过期、手动失效 |

### 7.2 前端测试（Vitest）

| 测试维度 | 覆盖点 |
|---|---|
| 懒加载 | 隐式懒加载、显式 `load(level)`、并发去重、`invalidate` 失效 |
| 缓存 | 三种 storage、TTL 优先级（后端 > 前端兜底）、跨层级隔离 |
| 拦截器 | 多段串联、注册顺序执行、`onFulfilled`/`onRejected` 链、`eject`/`clear`、async 拦截器 |
| 调用 | 路径参数填充、query/body 拼装、方法自动选取、strict 校验 |
| Adapter | auto 检测、builtin adapter 行为、axios 复用、自定义 Fetcher |
| 登录态 | 未登录拒绝拉取、登录后拉取、`invalidate` 清理 |
| 类型生成 | codegen CLI 输出结构、参数类型校验、路由名字面量校验 |

### 7.3 端到端测试

最小示例项目（Laravel + Vue）覆盖完整链路：

1. 后端定义 admin/manage/client 三层级路由。
2. 前端 `createRouteForge()` 初始化、登录、按层级懒加载、调用 API。
3. 验证：未登录访问 client 抛 `InsufficientAuthError`、登录后正常调用、路由名错拼编译期报错。

## 8. 版本与发布

### 8.1 v1.0 能力清单（MVP）

- ✅ 后端：层级分配（3 种方式）、优先级、元信息端点、缓存
- ✅ 前端：懒加载、隔离缓存、并发去重、登录态感知、拦截器、严格模式
- ✅ Adapter：auto 检测、内置 builtin、axios 复用、自定义 Fetcher
- ✅ Vue 插件：`useForgeApi`/`useForgeLevel`/`useForgeRoute`/`useForgeByPrefix`
- ✅ 类型生成 CLI

### 8.2 v1.x 路线图

- v1.1：React 集成（`@route-forge/react`）
- v1.2：可视化路由管理面板（独立 SPA，连接 Route Forge 端点）
- v1.3：OpenAPI 桥接（从 OpenAPI spec 生成 Route Forge 类型）
- v1.4：Vite 插件（dev 时自动 codegen，HMR 同步路由变更）

### 8.3 兼容性承诺

- Laravel：支持当前活跃维护的 3 个大版本（v1 发布时为 9/10/11）；新版本发布 6 个月内适配。
- Vue：支持 Vue 3.3+；不主动支持 Vue 2。
- Node：支持 LTS 版本（v1 发布时为 18/20/22）。
- 浏览器：现代浏览器（Chrome/Edge/Firefox/Safari 最近 2 个大版本）；不支持 IE。
