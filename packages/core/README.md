# @route-forge/core

**English** | [中文](./README_zh.md)

The framework-agnostic client core for Laravel named routes: fetches route metadata from a backend manifest endpoint, lazy-loads and caches it per level, calls APIs **by route name**, and builds URLs — all with TypeScript type safety and axios-compatible interceptors.

## What it does

- **Call APIs by route name**: `forge.api('admin', 'users.show', { user: 123 })` — no hardcoded paths
- **Tiered lazy loading**: route metadata is grouped into levels (e.g. `public` / `admin`) and fetched on demand
- **Isolated cache + request deduplication**: per-level cache (memory / sessionStorage / localStorage with TTL); concurrent fetches of the same level are merged into one request
- **Auto-discovery**: on startup it fetches the summary endpoint to discover levels, eager tiers, and the URL prefix
- **Interceptors**: request / response chains with axios-compatible `use` / `eject` / `clear` (request LIFO, response FIFO)
- **Request cancellation**: `forge.api()` returns a `ForgeRequest` with a built-in `abort()` that cooperates with timeouts
- **Loading-state tracking**: in-flight request counter + subscriptions, ready to drive a global loading indicator
- **Type safety**: `ForgeRouteMap` two-level mapping (codegen or module augmentation) gives compile-time checks for route names, params, and responses
- **Pluggable transport**: zero-dependency built-in `fetch` implementation (default), host axios reuse, or a custom `Fetcher`
- **Plain `<script>` usage**: an IIFE build is provided for direct browser inclusion, no bundler required

## Installation

```bash
pnpm add @route-forge/core
# Optional: if axios is installed in the host project and adapter is 'auto' (default),
# it is detected and reused automatically; install it explicitly to force 'axios' mode
pnpm add axios
```

## Quick start

```ts
import { createRouteForge } from '@route-forge/core'

const forge = createRouteForge({
  endpoint: '/_forge/routes',   // backend manifest endpoint
})

// Call an API (auto-discovers → lazy-loads the level → fills path params → sends the request)
const user = await forge.api('admin', 'users.show', { user: 123 })

// Build URLs only (no request is sent)
const url = forge.route('public', 'login.show')   // → '/login'
const url2 = forge.url('public', 'login.show')    // url() is a semantic alias of route()

// Route existence / metadata inspection
forge.hasRoute('admin', 'users.show')             // true / false
forge.getRoutes('admin')                          // snapshot of one level (deep copy)
forge.getRoutes()                                 // all loaded levels, grouped by level

// Level loading & cache management
await forge.load('admin')                         // load a level (concurrent calls deduplicated)
forge.isLoaded('admin')                           // is the level cached?
forge.invalidate('admin')                         // invalidate one level
forge.invalidate(['admin', 'manage'])             // invalidate several
forge.invalidate()                                // invalidate all
```

## Initialization sequence & `ready()`

`createRouteForge()` immediately starts **auto-discovery** (summary endpoint) in the background, then preloads the **eager** levels. `ready()` resolves once both are done (it resolves with the forge instance itself, so chaining works):

```ts
const forge = createRouteForge({ endpoint: '/_forge/routes' })

// Recommended: mount the app after ready() — sync methods like route()/hasRoute() are then safe
forge.ready()
  .then(() => app.mount('#app'))
  .catch((err) => {
    // Always handle this: ready() rejects when the summary endpoint is unreachable
    // and no explicit levels were given — otherwise users face a silent blank page
    console.error('[route-forge] init failed', err)
  })

// Callback style: onFulfilled / onRejected (still returns a Promise)
forge.ready(
  (f) => console.log('ready!', f),
  (err) => console.error(err),
)

// async/await style
await forge.ready()
```

The three loading phases and how to track them:

| Phase | Description | Tracking |
|-------|-------------|----------|
| Auto-discovery | fetch the summary endpoint, discover levels/config | `forge.ready()` |
| Level load | fetch one level's route metadata | `forge.isLoaded(level)` / `bound.onLevelLoaded()` |
| API request | business API calls | `forge.isLoading()` / `forge.onLoadingChange()` |

**Degradation rule**: if explicit `levels` were provided, an unreachable summary endpoint logs a `console.warn` and falls back to the explicit configuration; without explicit `levels` there is no fallback and `ready()` rejects (with `HTTPError` / `NetworkError` / `UnknownLevelError`).

**Guard**: while auto-discovery has not completed and no explicit `levels` exist, `route()` / `hasRoute()` throw `ForgeError (RF_FE_010)` to prevent wrong results from unready data; `api()` is unaffected (it awaits discovery internally).

## Options (`createRouteForge(options)`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | — | summary/manifest endpoint path (network source). Optional: at least one of `endpoint`, `summary`, or an embedded `window.__ROUTE_FORGE__` must exist, otherwise `createRouteForge` throws `TypeError` |
| `summary` | `SummaryResponse` | — | Provide the summary directly (tests / non-global bootstrap), skipping the summary HTTP request. Takes lower priority than an embedded `window.__ROUTE_FORGE__` |
| `levels` | `string[]` | auto-discovered | discovered from the summary when omitted; when given, intersected with the backend summary (the frontend cannot declare levels the backend doesn't know) |
| `eager` | `string[]` | backend `load:'eager'` levels | levels preloaded after discovery; union with the backend marks when given |
| `adapter` | `'auto' \| 'axios' \| 'builtin' \| Fetcher` | `'auto'` | see "Adapters" below |
| `cache.ttl` | `number` (seconds) | `3600` | frontend fallback TTL; the backend's global `config.cache_ttl` is the ceiling — the effective TTL is `min(backend, frontend)` (frontend may shorten but never extend; `0` = forever; `config.cache_ttl: null` = don't cache) |
| `cache.storage` | `'memory' \| 'sessionStorage' \| 'localStorage'` | `'memory'` | cache backend; storage modes keep an in-memory mirror and invalidate cross-tab writes via `storage` events |
| `interceptors.request` | array | none | declarative request interceptors: plain function (treated as `onFulfilled`) or `[onFulfilled?, onRejected?]` tuple |
| `interceptors.response` | array | none | declarative response interceptors, same shapes |
| `timeout` | `number` (ms) | `30000` | global timeout; a single call can override it via `params.timeout` |
| `baseURL` | `string` | `''` | base prepended to every generated URL |
| `strict` | `boolean` | — | **Deprecated, ignored.** Frontend validation is always on (unknown level → `UnknownLevelError`, unknown route → `UnknownRouteError`, missing required param → `MissingRouteParamError`); silently ignoring typos hides bugs. The backend's `strict_mode` is a manifest-generation concern and unrelated to the frontend |

## Embedded bootstrap (optional hydration)

Summary discovery reads from one source in this cascade: **embedded `window.__ROUTE_FORGE__` → `createRouteForge({ summary })` → network `GET {endpoint}`**. All three deliver the same `SummaryResponse`.

For Laravel/Blade server-rendered first pages, the backend `@forgeSummary` directive inlines the summary as a one-shot, non-enumerable `window.__ROUTE_FORGE__` accessor that self-deletes on first read. When core finds it, it **skips the summary HTTP round-trip and completes discovery synchronously** — `route()` / `ready()` work immediately after `createRouteForge()` returns, eliminating the "routes not ready" first-paint flash. Level route tables are still lazy-loaded per level over HTTP (protected routes never enter the public HTML). A module-level memo lets a second instance (React StrictMode / a second provider) reuse the summary after the global is gone.

If no embed exists (standalone SPA, Vite dev), core falls back to the network summary automatically. `createRouteForge({ summary })` is the explicit, test/SSR-friendly entry. When the summary comes entirely from the embed, the `options` argument itself may be omitted — call `createRouteForge()` bare.

> Honest scope: the one-shot self-delete only shrinks the summary's runtime footprint on `window`; the data is still present in the HTML source. This is a latency/flash optimization, **not** an XSS- or network-egavesdropping-proof boundary.

## Smart parameter resolution

The third argument `params` of `forge.api(level, name, params)` carries four kinds of data — path parameters (flattened), `query`, `body`, `headers` — plus `timeout` (per-call override) and the explicit `params` key:

```ts
// Flattened path params + query string
forge.api('admin', 'users.show', { user: 1, query: { include: 'posts' } })

// Conflict resolution: route /search/{query} — a string `query` is detected as a path param
forge.api('admin', 'search.show', { query: 'keyword' })
// → URL: /search/keyword

// Explicit params: need BOTH a path param and a query string (`params` wins)
forge.api('admin', 'search.show', {
  params: { query: 'keyword' },   // → fills the {query} placeholder
  query: { page: 1 },             // → query string
  body: { detailed: true },       // → request body
  headers: { 'X-Trace': 'a1' },   // → request headers
  timeout: 120_000,               // → per-call timeout override (default 30s)
})
```

Resolution rules (by priority):

1. Explicit `params` → path parameters, highest priority
2. Remaining flattened keys → path parameters (they never overwrite keys already present in `params`)
3. Fixed keys resolved by value type: object `query` / `headers` → their fixed purpose; `string|number` → path parameter; `body` non-`string|number` → request body, `string|number` → path parameter
4. Optional URI params (`{param?}`) become empty segments when missing (extra `/` cleaned up); backend-provided `parameter_defaults` fill in for missing params

## URL prefix (`url_prefix`)

The backend may deliver a URL prefix via `config.url_prefix` in the summary endpoint; generated URLs automatically include it:

```ts
// 1. Path prefix — inserted after baseURL, before the route URI
// backend returns { "config": { "url_prefix": "/api/v1" } }
forge.route('public', 'users.show', { user: 1 })   // → '/api/v1/users/1'

// 2. Full URL (protocol + host) — used as the base URL, the client's baseURL is ignored;
//    ideal when frontend and backend live on different origins
// backend returns { "config": { "url_prefix": "https://api.example.com" } }
forge.route('public', 'users.show', { user: 1 })   // → 'https://api.example.com/users/1'
```

> `url_prefix` is backend-authoritative; the frontend cannot override it. An absent or empty prefix leaves URLs unchanged.

## Level binding: `forge.use(level, prefix?)`

`use()` is the single level-binding entry point and returns a `BoundForge` — Vue / React / IIFE share the exact same API surface:

```ts
// Bind a level — triggers load automatically, exposes shortcuts
const bound = forge.use('admin')
bound('users.show', { user: 1 })      // callable directly (= bound.api())
bound.route('users.show')             // URL generation
bound.level                           // → 'admin'
bound.levelLoaded                     // Promise<void> in core (Vue/React specialize this)

// Bind level + prefix — route names are joined automatically
// (ambiguity is resolved smartly: prefer prefix.suffix, fall back to suffix itself)
const users = forge.use('admin', 'users')
users('show', { user: 1 })            // → forge.api('admin', 'users.show', ...)

// Other BoundForge methods
await bound.onLevelLoaded()           // wait until the level is loaded (callback form supported)
bound.hasRoute('users.show')          // existence check within the bound level
bound.useRoutePrefix('posts')         // returns a NEW BoundForge with the new prefix (original unchanged)
// Generic methods act on the bound level: bound.load() / bound.invalidate() / bound.isLoaded()
// Global methods still work: bound.isLoading() / bound.onLoadingChange()
```

> Every `use()` call returns a fresh `BoundForge` (not cached); `forge.use()` without arguments returns the forge itself.

## Request cancellation

`forge.api()` returns a `ForgeRequest` — a `Promise` with an extra `abort()` method; the internal `AbortController` is managed for you:

```ts
const req = forge.api('admin', 'reports.export', { timeout: 120_000 })
req.abort()   // the request is aborted; the Promise rejects with RequestAbortedError (RF_FE_009)
```

`abort()` and the timeout (`AbortSignal.timeout`) cooperate — whichever fires first cancels the request. Interceptors can read the AbortSignal via `config.signal`.

## Interceptors & authentication

The interceptor API matches axios (`use` / `eject` / `clear`); request interceptors run **LIFO** (last registered, first executed), response interceptors **FIFO**. Route Forge ships no built-in session management — auth is done via interceptors:

```ts
// Declarative (at initialization)
const forge = createRouteForge({
  endpoint: '/_forge/routes',
  interceptors: {
    request: [
      (config) => {
        const token = authStore.getToken()
        if (token) config.headers.Authorization = `Bearer ${token}`
        return config   // must return a RequestConfig object, otherwise RF_FE_006 is thrown
      },
    ],
    response: [
      (resp) => resp.data,                    // unwrap: api() resolves with business data directly
      [undefined, (err) => {                  // tuple form: [onFulfilled?, onRejected?]
        if (err instanceof HTTPError && err.context?.status === 401) {
          authStore.logout()
          window.location.href = '/login'
        }
        return Promise.reject(err)
      }],
    ],
  },
})

// Runtime registration / removal / clearing
const id = forge.interceptors.request.use((config) => { /* ... */ return config })
forge.interceptors.request.eject(id)
forge.interceptors.request.clear()
forge.interceptors.response.clear()
```

**Logout cleanup** example:

```ts
function logout() {
  authStore.clearToken()
  forge.invalidate()                     // clear the route cache
  forge.interceptors.request.clear()     // clear interceptors
  forge.interceptors.response.clear()
}
```

> With `adapter: 'auto'` reusing host axios, interceptors already registered on the host axios instance run first; Route Forge interceptors run after them.
> Metadata fetching (summary / level tables) goes through the adapter's raw channel and never passes the business interceptor chains, so unwrapping interceptors can't corrupt it.

## Loading-state tracking

The core always tracks concurrent API requests; there is nothing to configure — just don't subscribe if you don't need it:

```ts
forge.isLoading()   // boolean: any request in flight?

const unsub = forge.onLoadingChange((event) => {
  console.log(event.loading)  // true / false
  console.log(event.count)    // current number of concurrent requests
})
unsub()   // unsubscribe
```

The Vue / React packages can drive component-level loading indicators from `onLoadingChange`.

## Type safety (optional but recommended)

`ForgeRouteMap` is a two-level mapping interface: level → route name → metadata. Once defined, **level / route name / params are inferred automatically** in `useForge` / `useForgeApi` / `bound()` calls — a typo'd route name becomes a compile error.

Two ways to define it:

```bash
# Option 1: codegen CLI (fetches the backend manifest, emits a .d.ts)
npx route-forge-codegen \
  --endpoint http://localhost/_forge/routes \
  --out src/types/forge-routes.d.ts \
  [--levels public,admin] [--responseTypes path/to/map.json]
```

```ts
// Option 2: TypeScript module augmentation
declare module '@route-forge/core' {
  interface ForgeRouteMap {
    admin: {
      'users.show': { method: 'GET'; params: { user: string | number }; response: User }
      'users.index': { method: 'GET'; params: {}; response: User[] }
    }
  }
}
```

The backend Laravel package ([route-forge/route-forge-laravel](https://github.com/route-forge/route-forge-laravel)) also ships `php artisan route:forge:types`, which generates the same structure.

## The `unassigned` level

Routes the backend did not assign to any level live under a special `unassigned` level that the backend always injects into the summary's `levels`. The frontend treats it exactly like any other level — it lazy-loads `levels.unassigned.route.uri` over HTTP:

```ts
await forge.load('unassigned')
const data = await forge.api('unassigned', 'some.route')
```

## Adapters

| `adapter` value | Behavior |
|-----------------|----------|
| `'auto'` (default) | probes the host via dynamic `import('axios')`: reuses it when found (inheriting its interceptors / defaults), otherwise falls back to the built-in `builtin` implementation |
| `'axios'` | forces host axios; throws `AdapterNotFoundError` (RF_FE_005) when not installed |
| `'builtin'` | forces the built-in fetch implementation (zero dependencies, min+gzip < 3KB, axios-compatible interceptor behavior) |
| custom `Fetcher` | pass any object implementing `request(config): Promise<ResponseData>` for full control |

Bodies of type `FormData` / `Blob` / `ArrayBuffer` / `URLSearchParams` / `ReadableStream` skip JSON serialization automatically (plain `string` bodies pass through as well).

## IIFE browser usage

With a `<script>` tag, the `RouteForge` global becomes available:

```html
<!-- production build (minified, ~19 KB / ~7 KB gzip) -->
<script src="https://unpkg.com/@route-forge/core/dist/route-forge.global.min.js"></script>
<script>
  const forge = RouteForge.createRouteForge({ endpoint: '/_forge/routes' })
  forge.ready().then(function (f) {
    const admin = f.use('admin')
    return admin.onLevelLoaded().then(function () {
      return admin('users.show', { user: 1 })
    })
  }).then(function (data) {
    console.log(data)
  })
</script>
```

> Always reference the IIFE artifact under `dist/`; the bare unpkg package name resolves to the CJS entry, which browsers cannot execute directly.

## Error reference

All errors extend `ForgeError` and carry a stable `code` field (the `ForgeErrorCode` literal union), so you can branch on `code` (with exhaustive `switch` checking):

| Error class | code | Trigger |
|-------------|------|---------|
| `UnknownRouteError` | `RF_FE_001` | route name not found in the loaded level |
| `UnknownLevelError` | `RF_FE_002` | level not declared (frontend validation is always on) |
| `MissingRouteParamError` | `RF_FE_003` | required path parameter missing (no backend default); also thrown when a path parameter receives an object |
| `AdapterNotFoundError` | `RF_FE_005` | `adapter: 'axios'` but no usable host axios |
| `InvalidInterceptorReturnError` | `RF_FE_006` | a request interceptor did not return a RequestConfig object |
| `NetworkError` | `RF_FE_007` | network-layer failure (DNS, refused connection…); `cause` keeps the original error |
| `HTTPError` | `RF_FE_008` | non-2xx HTTP response; `context.status` holds the status code |
| `RequestAbortedError` | `RF_FE_009` | request cancelled via `abort()` / AbortSignal |
| `ForgeError` (guard) | `RF_FE_010` | `route()` / `hasRoute()` called before auto-discovery completed |

Error object shape:

```ts
{
  code: 'RF_FE_008',                     // stable error code
  route?: string,                        // related route name
  level?: string,                        // related level
  context?: Record<string, unknown>,     // extra context (HTTP status, url, method…)
  cause?: unknown,                       // original underlying error
}
```

## Utility exports

Besides `createRouteForge`, the core package exports these building blocks for advanced scenarios:

| Export | Description |
|--------|-------------|
| `createInterceptorManager` | creates an interceptor manager (`use`/`eject`/`clear`) so custom Fetchers can reuse the same interceptor implementation |
| `RouteCache` | per-level isolated route cache (memory / sessionStorage / localStorage, TTL expiry); usable standalone |
| `LoadingTracker` | loading-state tracker (reference counting + subscriptions) for building global loading indicators |
| `resolveRouteName` | async prefix-ambiguity resolution (prefer `prefix.suffix`, fall back to suffix); used by the `api()` path |
| `resolveRouteNameSync` | sync variant based on the loaded cache; used by the `route()` / `url()` path |

Type exports: `RouteForge` / `RouteForgeOptions` / `BoundForge` / `ApiCallParams` / `RequestConfig` / `ResponseData` / `ForgeRequest` / `Fetcher` / `RouteMeta` / `SummaryResponse` / `ForgeRouteMap` / `ForgeErrorCode` and more (full list in `dist/index.d.ts`).

## FAQ

**`route()` / `hasRoute()` throw `RF_FE_010`?**
Auto-discovery hasn't completed. `await forge.ready()` first, or use the framework packages' `useForgeRoute`, which handles the loading state internally (returns `''` until ready).

**`ready()` rejected — what now?**
The summary endpoint is unreachable and no explicit `levels` were provided. Either fix endpoint connectivity, or pass explicit `levels` to gain the degradation path (falls back to the explicit configuration when the summary fails).

**Responses aren't unwrapped with `resp.data`?**
Unwrapping is response-interceptor behavior — register `(resp) => resp.data` yourself; by default `api()` resolves with the final value of the interceptor chain over the full `ResponseData`.

**Cache out of sync across browser tabs?**
Storage modes (sessionStorage / localStorage) automatically invalidate the in-memory mirror when another tab writes, via `storage` events; `memory` mode is per-tab by design.

## Documentation

- Repository: <https://github.com/route-forge/route-forge>
- Design notes: <https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md>
- Specification: <https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md>
- Backend package (Laravel): <https://github.com/route-forge/route-forge-laravel>

## License

MIT
