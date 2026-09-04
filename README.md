# Route Forge

**English** | [中文](./README_zh.md)

**The end-to-end solution for Laravel named routes** — tiered lazy loading · type safety · interceptors

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

Calling an API from the frontend should express *what I want to do*, not *where I want to go*.

```ts
// ✅ Intent-driven — Route Forge
const user = await forge.api('admin', 'users.show', { user: 123 })

// ❌ Location-driven — the traditional way
const user = await axios.get('/admin/users/123')
```

Route Forge reads named routes from the Laravel route registry, groups them into levels, and delivers them to the frontend. The frontend lazy-loads them on demand, keeps caches isolated, and calls APIs by name — with TypeScript protection all the way.

## Core features

| Feature | Description |
|---------|-------------|
| **Tiered lazy loading** | Routes are grouped into levels (e.g. `public` / `client` / `admin`); the frontend fetches only what it needs, improving first-paint performance |
| **Isolated cache** | Each level has its own cache entry — no cross-contamination; memory / sessionStorage / localStorage supported |
| **Request deduplication** | Concurrent fetches of the same level are merged into one request, preventing a first-paint request avalanche |
| **Interceptors** | Request / response chains with axios-compatible behavior (LIFO / FIFO), declarative registration and runtime management |
| **Request cancellation** | `ForgeRequest` returned by `forge.api()` ships with `abort()`, cooperating with timeouts |
| **Type safety** | TS type declarations generated from the backend route registry — route name → params → response checked at compile time |
| **Unassigned level** | Routes without a backend-assigned level live under an `unassigned` level the backend always exposes in the summary, lazy-loaded over HTTP like any other level |
| **Embedded bootstrap** | On Laravel/Blade server-rendered pages the summary can be inlined as a one-shot `window.__ROUTE_FORGE__` so core skips the summary round-trip and is ready synchronously; falls back to the network summary when absent |
| **Zero intrusion** | The backend extends Laravel via macros and a ServiceProvider — no framework core modification |
| **Browser-ready** | The core package ships an IIFE build usable via a plain `<script>` tag, no bundler required |

## Project structure

This repository ([route-forge/route-forge](https://github.com/route-forge/route-forge)) contains the npm-side frontend packages:

```
route-forge/
├── packages/
│   ├── core/       # @route-forge/core — framework-agnostic named-route client core
│   ├── vue/        # @route-forge/vue — Vue 3 integration (plugin + composables + components)
│   └── react/      # @route-forge/react — React integration (Provider + hooks + components)
├── .docs/
│   ├── SPEC.md     # feature specification
│   └── DESIGN.md   # design notes
└── ...
```

The backend package (Composer) lives in a separate repository: [route-forge/route-forge-laravel](https://github.com/route-forge/route-forge-laravel).

The two sides communicate through an HTTP manifest contract and evolve independently.

## Quick start

### 1. Backend installation (Laravel)

```bash
composer require route-forge/laravel
```

Mark routes with levels in `routes/web.php` or `routes/api.php`:

```php
// Option 1: explicit marking
Route::post('/auth/login', [AuthController::class, 'login'])
    ->name('auth.login')
    ->tier('public');

// Option 2: group inheritance
Route::group(['prefix' => 'admin', 'middleware' => ['auth', 'admin'], 'tier' => 'admin'], function () {
    Route::get('/users', [UserController::class, 'index'])->name('admin.users.index');
    Route::get('/users/{user}', [UserController::class, 'show'])->name('admin.users.show');
});
```

Configure level rules in `config/forge.php` (bulk matching by prefix or middleware is supported):

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

### 2. Frontend installation

```bash
# Core package (required)
pnpm add @route-forge/core

# Vue 3 integration (optional)
pnpm add @route-forge/vue

# React integration (optional)
pnpm add @route-forge/react

# axios adapter (optional — falls back to the built-in fetch implementation)
pnpm add axios
```

**No bundler?** The core package provides an IIFE build for direct browser inclusion:

```html
<!-- development build (external sourcemap reference, ~41 KB) -->
<script src="https://unpkg.com/@route-forge/core/dist/route-forge.global.js"></script>
<!-- production build (minified, ~19 KB / ~7 KB gzip) -->
<script src="https://unpkg.com/@route-forge/core/dist/route-forge.global.min.js"></script>

<script>
  const forge = RouteForge.createRouteForge({ endpoint: '/_forge/routes' })
  forge.api('admin', 'users.show', { user: 123 }).then(console.log)
</script>
```

### 3. Frontend usage

#### Pure core usage

```ts
import { createRouteForge } from '@route-forge/core'

const forge = createRouteForge({
  endpoint: '/_forge/routes',
})

// Call an API — auto-loads the level + fills params + sends the request
const user = await forge.api('admin', 'users.show', { user: 123 })

// Build a URL — no request is sent
const url = forge.route('public', 'login.show')
// → '/login'

// Manual level management
await forge.load('admin')
forge.invalidate('admin')

// Cancellation: ForgeRequest ships with abort(), no manual AbortController needed
const req = forge.api('admin', 'users.show', { user: 123 })
req.abort()  // cancels the request; the Promise rejects with RequestAbortedError

// Unassigned level — routes without a backend tier live under the always-present 'unassigned' level (lazy-loaded over HTTP)
await forge.load('unassigned')
const data = await forge.api('unassigned', 'some.route')
```

Parameters support smart resolution: flattened path parameters, with `query`/`body`/`headers` as fixed keys. When a path parameter name collides with a fixed key, `string|number` values are detected as path parameters; the explicit `params` key also works:

```ts
// route: /search/{query}
forge.api('admin', 'search.show', { query: 'keyword' })           // query → path parameter
forge.api('admin', 'search.show', { params: { query: 'keyword' }, query: { page: 1 } }) // explicit
```

#### Vue 3 integration

```ts
// main.ts
import { createApp } from 'vue'
import { createRouteForgePlugin } from '@route-forge/vue'

const app = createApp(App)
const plugin = createRouteForgePlugin({
  endpoint: '/_forge/routes',
})
app.use(plugin)
// Recommended: mount after ready() (summary + eager levels done); handle failures to avoid a silent blank page
plugin.ready()
  .then(() => app.mount('#app'))
  .catch((err) => console.error('[route-forge] init failed', err))
```

```vue
<script setup lang="ts">
  import { useForge, useForgeApi, useForgeRoute } from '@route-forge/vue'

  // Bind a level — later calls don't need the level argument
  const forge = useForge('admin')
  const user = await forge('users.show', { user: 1 })

  // Bind level + prefix — route names are joined automatically
  const userForge = useForge('admin', 'users')
  const user2 = await userForge('show', { user: 1 })  // → admin.users.show

  // API calls with loading / error state (also supports level binding and prefix)
  const { call, pending, error } = useForgeApi('admin')
  const { data } = await call('users.show', { user: 1 })

  const { call: callUser } = useForgeApi('admin', 'users')
  const { data: user3 } = await callUser('show', { user: 1 })

  // Reactive URLs in templates: '' until loaded, auto-updates afterwards (preferred over $forge)
  const loginUrl = useForgeRoute('public', 'login.show')
</script>

<template>
  <a :href="loginUrl">Login</a>

  <!-- Or the ready-made link component: renders the loading slot (or nothing) while the level
       loads, then the link (auto-upgraded to <RouterLink> when vue-router is installed) -->
  <ForgeLink level="public" name="login.show">Login</ForgeLink>
</template>
```

> The Vue / React packages also ship `ForgeRoute` / `ForgeLink` components that wrap `useForgeRoute`
> (loading slot / render-prop, console hints, router-link integration) — see the package READMEs.

#### React integration

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

```tsx
// App.tsx — capability parity with Vue; differences: options object, plain-object params
import { useForge, useForgeApi, useForgeRoute } from '@route-forge/react'

export default function App() {
  // Bind a level — later calls don't need the level argument
  const forge = useForge({ level: 'admin' })

  // Bind level + prefix — route names are joined automatically
  const userForge = useForge({ level: 'admin', prefix: 'users' })

  // API calls with loading / error state (also supports level binding and prefix)
  const { call, pending, error } = useForgeApi({ level: 'admin' })
  const { call: callUser } = useForgeApi({ level: 'admin', prefix: 'users' })

  // Reactive URL generator: render-phase only; '' until loaded, auto-updates, recomputes on param change
  const detailUrl = useForgeRoute('admin', 'users.show', { user: 1 })

  // Or the ready-made link component: renders `loading` (or nothing) while the level loads,
  // then the link; `as` injects any router Link (react-router, next/link) for SPA navigation
  // <ForgeLink as={RouterLink} level="admin" name="users.show" params={{ user: 1 }}>View user</ForgeLink>

  // Imperative calls belong in event handlers (no await during render)
  async function load() {
    const user = await forge('users.show', { user: 1 })
    const user2 = await userForge('show', { user: 1 })       // → admin.users.show
    const { data } = await call('users.show', { user: 1 })
    const { data: user3 } = await callUser('show', { user: 1 })
  }

  return <a href={detailUrl}>View user</a>
}
```

> **Levels are bound statically**: the `level` (and `prefix`) of `useForge` / `useForgeApi` / `useForgeRoute` are fixed when the instance is created
> and cannot be switched later (switching would make `prefix` meaningless). Create another component / instance for another level —
> the overhead is acceptable. The Vue and React packages share this contract.

> **About Vue's `$forge` global property**: the plugin injects `$forge.route()`, but it is safe only after the target level has loaded
> (e.g. after `ready()`); during rendering an unready level throws — uncontrollable. Use `useForgeRoute` for template links
> (handles loading state, degrades to `''` on error).

### 4. Type generation (optional)

The backend Artisan command generates TS type declarations from the route registry for compile-time checks of route names and params:

```bash
php artisan route:forge:types --out=../frontend/src/types/forge-routes.d.ts
```

The generated file defines the two-level mapping `ForgeRouteMap` (level → routeName → meta), which takes effect automatically via TypeScript module augmentation:

```ts
// After generation, a typo'd route name fails at compile time; param types are inferred
forge.api('admin', 'users.show', { user: 123 })  // ✅ OK — 'users.show' autocompleted, { user } type-checked
forge.api('admin', 'users.sho', { user: 123 })   // ❌ TS Error: route name does not exist
forge.api('admin', 'users.show', { uid: 123 })   // ❌ TS Error: parameter should be `user`
```

## Full example: a real-project call flow

Using a Vue 3 admin panel as an example, this section shows how Route Forge is organized in a real project:
initialization sequence, token injection, 401 handling, level binding, request cancellation, and error handling.

### Entry: mount the app after discovery completes

```ts
// main.ts
import { createApp } from 'vue'
import { createRouteForgePlugin } from '@route-forge/vue'
import App from './App.vue'
import { tokenStore } from './stores/auth'

const app = createApp(App)

const plugin = createRouteForgePlugin({
  endpoint: '/_forge/routes',
  // no levels → auto-discovered from the summary endpoint; no eager → backend load:'eager' levels
  interceptors: {
    // Declarative config describes ONE interceptor each: a function (→ resolve),
    // a [resolve?, reject?] tuple, or a { resolve?, reject? } object.
    // Need several? Register them at runtime via forge.interceptors.*.use().
    request: (config) => {
      // Token injection: business requests carry the token automatically
      const token = tokenStore.get()
      if (token) config.headers.Authorization = `Bearer ${token}`
      return config
    },
    response: {
      resolve: (resp) => resp.data,  // unwrap: api() resolves with business data directly
      reject: (err) => {
        // 401 → clear the session and redirect to login; rethrow everything else
        if ((err as any).context?.status === 401) {
          tokenStore.clear()
          location.href = '/login'
        }
        return Promise.reject(err)
      },
    },
  },
})

app.use(plugin)
// Recommended: mount after summary discovery + eager levels are fully loaded;
// sync methods like route()/hasRoute() are then immediately usable.
// Note: mounting is delegated to ready().then — do not call mount again here.
// Failure fallback: when the summary endpoint is unreachable (network error / non-2xx / timeout),
// ready() rejects — always catch it, otherwise users face a blank page
plugin.ready().then(() => app.mount('#app')).catch((err) => {
  console.error('[route-forge] initialization failed, app not mounted', err)
  // Degrade as the business requires: error page / retry / reporting
  document.getElementById('app')!.innerHTML =
    '<p>Service temporarily unavailable — please refresh and retry</p>'
})
```

### Business component: level binding + prefix + loading state

```vue
<script setup lang="ts">
import { useForge, useForgeApi, useForgeRoute } from '@route-forge/vue'
import { ref } from 'vue'

// Bind the admin level + users prefix: route names autocomplete to admin.users.*
const users = useForge('admin', 'users')
// Calls with loading / error state (also supports level + prefix binding)
const { call: fetchOrders, pending, error } = useForgeApi('admin', 'orders')
// Reactive URL generator: template-phase only; '' until loaded, auto-updates, recomputes on param change
const userId = ref(1)
const detailUrl = useForgeRoute('admin', 'users.show', () => ({ user: userId.value }))

const user = ref(null)
const editUrl = ref('')

async function loadUser(id: number) {
  // Direct call = api shorthand; the response is already unwrapped by the interceptor
  user.value = await users('show', { user: id })
  // URL generation: route links, <a href>, window.open, etc.
  editUrl.value = users.route('edit', { user: id })
}

async function loadOrders() {
  const { data, error: err } = await fetchOrders('index', { query: { page: 1 } })
  if (err) console.error('Failed to load orders', err)
}
</script>

<template>
  <!-- useForgeRoute: reactive URL; '' until the level loads, auto-updates afterwards -->
  <a :href="detailUrl">View user</a>
  <a :href="editUrl">Edit user</a>
  <p v-if="pending">Loading orders…</p>
</template>
```

### Cancellation & error handling

```ts
// Cancellation: ForgeRequest returned by forge.api() ships with abort()
const req = forge.api('admin', 'users.show', { user: 123 })
req.abort()  // the Promise rejects with RequestAbortedError (RF_FE_009); the request is aborted

// Error quick reference: all errors extend ForgeError and carry a stable `code` — branch on it
//   RF_FE_001 UnknownRouteError        route name does not exist
//   RF_FE_002 UnknownLevelError        level not declared
//   RF_FE_003 MissingRouteParamError   required path parameter missing
//   RF_FE_007 NetworkError             network-layer failure (DNS/connection)
//   RF_FE_008 HTTPError                non-2xx HTTP response (context.status holds the code)
//   RF_FE_009 RequestAbortedError      request cancelled
```

## Adapters

`createRouteForge({ adapter })` supports several HTTP client strategies:

| Value | Behavior |
|-------|----------|
| `'auto'` (default) | reuses host axios when detected (inheriting its interceptors/configuration); otherwise the built-in fetch implementation |
| `'axios'` | forces host axios; throws when not installed |
| `'builtin'` | forces the built-in fetch implementation even if axios is installed |
| custom Fetcher | pass any object satisfying the `Fetcher` interface for full control |

The built-in `builtin` adapter is based on native `fetch` with zero external dependencies (min+gzip < 3KB), and its interceptor behavior matches axios exactly.

## Development

### Requirements

- **Node.js** >= 18
- **pnpm** >= 8

### Common commands

```bash
# Install dependencies
pnpm install

# Development mode
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint (currently delegated to each package's tsc --noEmit; no standalone linter)
pnpm lint

# Type check
pnpm typecheck

# Clean build artifacts
pnpm clean
```

### Publishing

```bash
# Type check → test → build → publish core, vue, and react
pnpm publish:build

# Or publish a single package
pnpm publish:core
pnpm publish:vue
pnpm publish:react
```

## Compatibility

| Dependency | Supported versions |
|------------|--------------------|
| Laravel | 9 / 10 / 11 (see [route-forge-laravel](https://github.com/route-forge/route-forge-laravel)) |
| Vue | 3.3+ (Vue 2 not supported) |
| Node.js | LTS versions (18 / 20 / 22) |
| Browsers | Modern browsers (last 2 major versions of Chrome / Edge / Firefox / Safari); no IE |

## Documentation

- [Specification](.docs/SPEC.md) — full feature definitions and API contract
- [Design notes](.docs/DESIGN.md) — architecture decisions and evolution
- [@route-forge/core](packages/core/README.md) — core package documentation
- [@route-forge/vue](packages/vue/README.md) — Vue 3 integration documentation
- [@route-forge/react](packages/react/README.md) — React integration documentation

## License

[MIT](LICENSE) © 阿杰很厉害
