# @route-forge/vue

**English** | [中文](./README_zh.md)

The Vue 3 integration for Route Forge: a plugin (`createRouteForgePlugin`), three composables (`useForge` / `useForgeApi` / `useForgeRoute`), and two components (`ForgeRoute` / `ForgeLink`) for calling APIs **by route name** and generating reactive links inside components, with loading and error states managed for you.

> All core capabilities (tiered lazy loading, isolated cache, interceptors, request cancellation, type safety) come from [@route-forge/core](../core/README.md); this package only adds Vue reactivity: `levelLoaded` is a `Ref<boolean>`, `pending` / `error` are `Ref`s, and URL generation returns a `ComputedRef<string>`.

## Installation

```bash
pnpm add @route-forge/vue @route-forge/core
```

Requires Vue 3.3+ (Vue 2 is not supported).

## Quick start

```ts
// main.ts
import { createApp } from 'vue'
import { createRouteForgePlugin } from '@route-forge/vue'
import App from './App.vue'

const plugin = createRouteForgePlugin({
  endpoint: '/_forge/routes',
})

const app = createApp(App)
app.use(plugin)
// Recommended: mount the app after ready() (summary + eager levels fully loaded);
// sync methods like route()/hasRoute() are then safe immediately
plugin.ready()
  .then(() => app.mount('#app'))
  .catch((err) => {
    // Always handle this: the summary endpoint may be unreachable
    // (network error / non-2xx / timeout) — avoid a silent blank page
    console.error('[route-forge] init failed', err)
  })
```

> Plugin options are exactly `createRouteForge(options)` (`levels` / `eager` / `adapter` / `cache` / `interceptors` / `timeout` / `baseURL`); full options table in the [core README](../core/README.md#options-createrouteforgeoptions).

## useForge — the core composable

Without `level` it returns the full `RouteForge` instance; with `level` it delegates to `forge.use(level, prefix?)` (triggering the level load) and returns a `VueBoundForge`:

```ts
import { useForge } from '@route-forge/vue'

// Unbound — full RouteForge instance
const forge = useForge()
forge.api('admin', 'users.show', { user: 1 })     // call with level + route name
forge.ready().then(f => f.use('admin'))           // bind a level once ready

// Bound to a level — callable directly, load triggered automatically
const users = useForge('admin')
users.level                                       // → 'admin'
users.levelLoaded                                 // Ref<boolean>, flips to true once loaded
users('users.show', { user: 1 })                  // callable (= users.api() shorthand)
users.api('users.show', { user: 1 })              // same thing
users.route('users.show', { user: 1 })            // build a URL
users.url('users.show', { user: 1 })              // semantic alias of route()
await users.onLevelLoaded()                       // wait until the level is loaded
users.useRoutePrefix('users')                     // returns a NEW BoundForge with the new prefix

// Bound level + prefix — route names joined automatically (ambiguity resolved smartly)
const userApi = useForge('admin', 'users')
userApi.prefix                                    // → 'users'
userApi('show', { user: 1 })                      // → forge.api('admin', 'users.show', ...)
userApi.route('show', { user: 1 })                // → forge.route('admin', 'users.show', ...)

// Generic methods: in bound form they act on the bound level (no arguments)
users.load()                                      // load the bound level
users.isLoaded()                                  // check the bound level's cache
users.invalidate()                                // invalidate the bound level's cache
// Global methods: isLoading() / onLoadingChange() / hasRoute(name) / getRoutes()
```

> **Note**: the unbound full instance may throw the guard error (`RF_FE_010`) from `route()` / `hasRoute()` before auto-discovery completes. Prefer `await forge.ready()`, or use `useForgeRoute` for links.

> **Level binding is static**: `level` (and `prefix`) are fixed at call time and cannot be switched later — create another `useForge` call for another level (the overhead is acceptable).

## useForgeApi — event-style calls with loading/error state

For imperative scenarios like click handlers: it never throws — errors are written to the `error` state and returned as `{ data: undefined, error }`:

```ts
import { useForgeApi } from '@route-forge/vue'

// Three binding forms (same level semantics as useForge)
const api = useForgeApi()                        // unbound: call(level, name, params)
const admin = useForgeApi('admin')               // bound: call(name, params)
const users = useForgeApi('admin', 'users')      // bound + prefix: call(suffix, params)

const { data, error } = await admin.call('users.show', { user: 1 })
```

- `pending`: `Ref<boolean>` — reference-counted; concurrent `call`s keep it `true` until all settle
- `error`: `Ref<unknown>` — the latest failure (reset to `null` on success)

## useForgeRoute — reactive links in templates

Returns a `ComputedRef<string>` (auto-unwrapped in templates, no `.value` needed). It handles the loading state internally: returns `''` until the level loads (the render never crashes), then recomputes automatically when the level loads or dependencies change — you never need to look at `levelLoaded`:

```vue
<template>
  <!-- 1. Static URL -->
  <a :href="login">Login</a>

  <!-- 2. Reactive params: URL recomputes when userId changes -->
  <a :href="profile">User home</a>

  <!-- 3. Reactive route name: recomputes when currentName changes -->
  <NuxtLink :to="dynamic">Dynamic entry</NuxtLink>
</template>

<script setup>
import { ref } from 'vue'
import { useForgeRoute } from '@route-forge/vue'

const userId = ref(1)
const currentName = ref('dashboard.show')

// Static level + static route name
const login = useForgeRoute('public', 'login.show')

// params as a getter → tracked reactively; URL follows userId
const profile = useForgeRoute('admin', 'users.show', () => ({ user: userId.value }))

// name as a getter → the route name itself can switch reactively
const dynamic = useForgeRoute('admin', () => currentName.value)
</script>
```

Contract details:

- `level` is a **static string** binding: fixed once at setup and cannot be switched later — create another `useForgeRoute` call for another level (same contract as `useForge`); the `name` / `params` getters stay reactive
- Render-time errors (unknown route, missing required param…) **degrade to `''` so rendering never breaks**, while a styled `console.warn` prints the full error (with stack) — visible during development, harmless in production

## Components — ForgeRoute / ForgeLink

Both components wrap `useForgeRoute`, so templates don't repeat the "empty string first, update later" handling. While the level is not loaded (or route resolution fails), the `loading` slot renders (nothing by default); once loaded, the link renders.

**`ForgeLink`** — the convenient one: renders `<a :href>` directly with slot content as the link text:

```vue
<script setup>
import { ForgeLink } from '@route-forge/vue'
</script>

<template>
  <!-- Renders <a href="/login">Login</a> once the level is loaded -->
  <ForgeLink level="public" name="login.show">Login</ForgeLink>

  <!-- Reactive params (object or getter form) + attrs passthrough (class / target / …) -->
  <ForgeLink level="admin" name="users.show" :params="{ user: userId }" class="btn">
    View user
  </ForgeLink>

  <!-- Custom placeholder while loading -->
  <ForgeLink level="admin" name="users.show" :params="() => ({ user: userId })">
    View user
    <template #loading>Preparing link…</template>
  </ForgeLink>
</template>
```

Router integration is **zero-dependency and automatic**: if [vue-router](https://router.vuejs.org/) is installed (`app.use(router)`), `ForgeLink` renders `<RouterLink :to="href">` for in-app navigation; otherwise it renders a native `<a>`. Nothing to configure. (A `RouterLink` registered only locally in a parent component is not detected — the global registration from `app.use(router)` is what's probed.)

**`ForgeRoute`** — the flexible one: exposes `{ href, loaded }` through a scoped slot for full control:

```vue
<script setup>
import { ForgeRoute } from '@route-forge/vue'
</script>

<template>
  <ForgeRoute level="admin" name="users.show" :params="() => ({ user: userId })">
    <template #default="{ href }">
      <a :href="href">View user</a>
    </template>
    <template #loading>Preparing link…</template>
  </ForgeRoute>
</template>
```

Shared contract (both components):

- `level` is a **static string** binding (same contract as `useForgeRoute`); `name` / `params` accept both plain values and getter functions and stay reactive
- `loaded` = `href !== ''` — inside the `default` slot it is always `true` (the slot only renders once loaded); it exists for symmetry with the React render-prop API
- Console behavior: while the level is not loaded each instance `console.warn`s **once** (a normal transient state — no spam); route resolution failures log `console.error` every time (rendering still never breaks)
- SSR: the components simply render the `loading` slot (or nothing) until the level cache is populated — preload the level on the server, or let the link appear after client hydration

## About the `$forge` global property (not recommended in templates)

Installing the plugin injects `app.config.globalProperties.$forge` (with `route(level, name, params?)`). It is a **low-level fallback entry**: safe to call only after the target `level` has loaded (e.g. after `plugin.ready()` resolves). During rendering, if the level is not ready yet, `$forge.route()` throws on unready route data and breaks the render — uncontrollable. Prefer `useForgeRoute` for template links; keep `$forge` for the rare imperative scenarios where timing is guaranteed.

## Smart parameter resolution

`api()` supports the same smart resolution as core: flattened path parameters, with `query` / `body` / `headers` as fixed keys; when a path parameter name collides with a fixed key, `string|number` values are detected as path parameters, and the explicit `params` key always wins:

```ts
// Conflict resolution: route /search/{query} — string `query` → path parameter
users.api('search.show', { query: 'keyword' })

// Explicit params: need BOTH a path param and a query string
users.api('search.show', {
  params: { query: 'keyword' },
  query: { page: 1 },
})
```

Full rules and the `timeout` override: [core README](../core/README.md#smart-parameter-resolution).

## Type safety (optional but recommended)

Once `ForgeRouteMap` is defined (codegen or module augmentation), level, route names, and params are inferred in `useForge` / `useForgeApi` / `useForgeRoute`:

```bash
npx route-forge-codegen --endpoint http://localhost/_forge/routes --out src/types/forge-routes.d.ts
```

```ts
// Typo'd route name / param name → compile error; correct call → autocompletion
const users = useForge('admin', 'users')
await users('show', { user: 1 })      // ✅ params checked at compile time
```

See the [core README "Type safety" section](../core/README.md#type-safety-optional-but-recommended).

## Differences vs core / react

| Capability | @route-forge/core | @route-forge/vue | @route-forge/react |
|------------|-------------------|------------------|--------------------|
| `levelLoaded` | `Promise<void>` | `Ref<boolean>` | `boolean` |
| `useForgeApi` `pending` / `error` | — (use `LoadingTracker`) | `Ref<boolean>` / `Ref<unknown>` | `boolean` / `unknown` |
| URL generation returns | `string` (sync; throws when unready) | `ComputedRef<string>` (`''` until ready) | `string` (`''` until ready) |
| `useForgeRoute` params | — | getter function | plain object (content-compared deps) |
| Binding signature | `forge.use(level, prefix?)` | `useForge(level?, prefix?)` | `useForge({ level?, prefix? })` |

## FAQ

**`$forge.route()` throws in a template?**
The level hasn't loaded yet. Use `useForgeRoute` instead (handles the loading state and degrades to `''`), or make sure the dependent components render only after `plugin.ready()` resolves.

**`useForge()` says "must be used inside an app with createRouteForgePlugin() installed"?**
A composable ran before the plugin was installed, or in a component tree without it; confirm `app.use(plugin)` happened first.

**Need to re-fetch the route table after navigating?**
Call `forge.invalidate()` (or `users.invalidate()` in bound form); the next `api()` / `load()` refetches.

## Documentation

- Repository: <https://github.com/route-forge/route-forge>
- Core package: [@route-forge/core](../core/README.md)
- Design notes: <https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md>
- Specification: <https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md>

## License

MIT
