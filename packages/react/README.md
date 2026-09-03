# @route-forge/react

**English** | [中文](./README_zh.md)

The React integration for Route Forge: `RouteForgeProvider`, three hooks (`useForge` / `useForgeApi` / `useForgeRoute`), and two components (`ForgeRoute` / `ForgeLink`) for calling APIs **by route name** and generating links inside components, with loading and error states managed for you.

> All core capabilities (tiered lazy loading, isolated cache, interceptors, request cancellation, type safety) come from [@route-forge/core](../core/README.md); this package only adds React adaptation: `levelLoaded` is a plain `boolean` (state-driven re-render), `pending` / `error` are plain values, and URL generation returns a plain `string`.

## Installation

```bash
pnpm add @route-forge/react @route-forge/core
```

Requires React 18+ (React 19 compatible).

## Quick start

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

The hooks handle async internally: `useForgeApi` / `forge.api()` await level loading automatically, and `useForgeRoute` returns `''` until the level loads, then updates on its own — no render blocking needed.

**Need the whole app to wait until ready?** (e.g. the first screen calls sync methods like `route()` / `hasRoute()`) Create a forge outside the Provider as a readiness gate:

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
    // Always handle this: the summary endpoint may be unreachable
    // (network error / non-2xx / timeout) — avoid a silent stuck initialization
    console.error('[route-forge] init failed', err)
  })
```

> Note: `RouteForgeProvider` only accepts `options` (not an instance), so in the gated pattern the Provider creates a second instance and the summary endpoint is requested twice. To avoid the duplicate request, prefer the direct-render pattern above and call sync methods only after `ready()`.

> Provider options are exactly `createRouteForge(options)` (`endpoint` / `summary` / `levels` / `eager` / `adapter` / `cache` / `interceptors` / `timeout` / `baseURL`); full options table in the [core README](../core/README.md#options-createrouteforgeoptions). `options` is shallow-compared: inline literals do not rebuild the instance while the values stay the same. The `options` prop itself is optional — when the summary is embedded via `@forgeSummary` (`window.__ROUTE_FORGE__`), render `<RouteForgeProvider>` without any `options`.

## useForge — the core hook

Without `level` it returns the full `RouteForge` instance; with `{ level }` it delegates to `forge.use(level, prefix?)` (triggering the level load) and returns a `ReactBoundForge`:

```tsx
import { useForge } from '@route-forge/react'

// Unbound — full RouteForge instance
const forge = useForge()
forge.api('admin', 'users.show', { user: 1 })
forge.ready().then(f => f.use('admin'))           // bind a level once ready

// Bound to a level — callable directly, load triggered automatically
const users = useForge({ level: 'admin' })
users.level                                       // → 'admin'
users.levelLoaded                                 // boolean, true once loaded (triggers re-render)
users('users.show', { user: 1 })                  // callable (= users.api() shorthand)
users.api('users.show', { user: 1 })
users.route('users.show', { user: 1 })
users.url('users.show', { user: 1 })              // semantic alias of route()
users.onLevelLoaded()                             // wait until the level is loaded
users.useRoutePrefix('users')                     // returns a NEW BoundForge with the new prefix

// Bound level + prefix — route names joined automatically (ambiguity resolved smartly)
const userApi = useForge({ level: 'admin', prefix: 'users' })
userApi('show', { user: 1 })                      // → forge.api('admin', 'users.show', ...)
userApi.route('show', { user: 1 })                // → forge.route('admin', 'users.show', ...)

// Generic methods: in bound form they act on the bound level (no arguments)
users.load()                                      // load the bound level
users.isLoaded()                                  // check the bound level's cache
users.invalidate()                                // invalidate the bound level's cache
// Global methods: isLoading() / onLoadingChange() / hasRoute(name) / getRoutes()
```

> **Note**: the unbound full instance may throw the guard error (`RF_FE_010`) from `route()` / `hasRoute()` before auto-discovery completes. Prefer `await forge.ready()`, or use `useForgeRoute` for links.

> **Level binding is static**: `level` (and `prefix`) are fixed at first call and cannot be switched later — create another component or another `useForge` call for another level (the overhead is acceptable).

## useForgeApi — event-style calls with loading/error state

For imperative scenarios like click handlers (you cannot `await` during render): it never throws — errors are written to the `error` state and returned as `{ data: undefined, error }`:

```tsx
import { useForgeApi } from '@route-forge/react'

// Three binding forms (options object; same level semantics as useForge)
const api = useForgeApi()                                        // unbound: call(level, name, params)
const admin = useForgeApi({ level: 'admin' })                    // bound: call(name, params)
const users = useForgeApi({ level: 'admin', prefix: 'users' })   // bound + prefix: call(suffix, params)

async function handleClick() {
  const { data, error } = await admin.call('users.show', { user: 1 })
}
```

- `pending`: `boolean` — reference-counted; concurrent `call`s keep it `true` until all settle
- `error`: `unknown` — the latest failure (reset to `null` on success)

## useForgeRoute — links in JSX

Returns a plain `string` (not a ref) — drop it straight into `href`. It handles the loading state internally: returns `''` until the level loads (the render never crashes), then updates automatically when the level loads or params change — you never need to look at `levelLoaded`:

```tsx
import { useForgeRoute } from '@route-forge/react'

function UserLinks({ userId, userName }) {
  // Static URL
  const login = useForgeRoute('public', 'login.show')
  // With params: pass a plain object; recomputation is content-driven
  // (inline literals are safe and won't recompute every render)
  const profile = useForgeRoute('admin', 'users.show', { user: userId })

  return (
    <>
      <a href={login}>Login</a>
      <a href={profile}>{userName}</a>
    </>
  )
}
```

Contract details:

- **Difference vs the Vue version**: returns `string` (Vue returns `ComputedRef<string>`, auto-unwrapped in templates); `params` is a plain object (Vue takes a getter). React compares dependencies by the **content** of `params` (serialization), so inline object literals are safe — no per-render recomputation from identity changes
- `level` is bound statically and cannot be switched later (create another component / call for another level, same contract as `useForge`); a non-string `level` throws `TypeError` at runtime
- Render-time errors (unknown route, missing required param…) **degrade to `''` so rendering never breaks**, while a styled `console.warn` prints the full error (with stack)

## Components — ForgeRoute / ForgeLink

Both components wrap `useForgeRoute`, so JSX doesn't repeat the "empty string first, update later" handling. While the level is not loaded (or route resolution fails), `loading` renders (nothing by default); once loaded, the link renders.

**`ForgeLink`** — the convenient one: renders the link directly with `children` as its content:

```tsx
import { ForgeLink } from '@route-forge/react'

// Native <a href="/login"> once the level is loaded
<ForgeLink level="public" name="login.show">Login</ForgeLink>

// SPA navigation: inject your router's Link via `as` (zero router dependency)
import { Link as RouterLink } from 'react-router-dom'
<ForgeLink as={RouterLink} level="admin" name="users.show" params={{ user: userId }} className="btn">
  View user
</ForgeLink>

// next/link works the same way
import Link from 'next/link'
<ForgeLink as={Link} level="admin" name="users.show" params={{ user: userId }}>View user</ForgeLink>

// Custom placeholder while loading
<ForgeLink level="admin" name="users.show" params={{ user: userId }} loading={<span>Preparing…</span>} />
```

The injected component receives the generated URL as **both `href` and `to`** (react-router's `Link` consumes `to`, next/link consumes `href`), so popular router links work without adapters. Any other component accepting `href` works too. Without `as`, a native `<a>` is rendered.

**`ForgeRoute`** — the flexible one: pass a function as `children` (render-prop) to receive `{ href, loaded }`:

```tsx
import { ForgeRoute } from '@route-forge/react'

<ForgeRoute level="admin" name="users.show" params={{ user: userId }} loading={<span>Preparing…</span>}>
  {({ href }) => <a href={href}>View user</a>}
</ForgeRoute>
```

Shared contract (both components):

- `level` is a **static string** binding (same contract as `useForgeRoute`; a non-string throws `TypeError` at runtime); `params` is a plain object, recomputation is content-driven (same as `useForgeRoute`)
- `loaded` = `href !== ''` — inside the render-prop it is always `true` (children only render once loaded); it exists for API symmetry
- Console behavior: while the level is not loaded each instance `console.warn`s **once** (a normal transient state — no spam); route resolution failures log `console.error` every time (rendering still never breaks)
- SSR: the components simply render `loading` (or nothing) until the level cache is populated — preload the level on the server, or let the link appear after client hydration

## Smart parameter resolution

`api()` supports the same smart resolution as core: flattened path parameters, with `query` / `body` / `headers` as fixed keys; when a path parameter name collides with a fixed key, `string|number` values are detected as path parameters, and the explicit `params` key always wins:

```tsx
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

```tsx
// Typo'd route name / param name → compile error; correct call → autocompletion
const users = useForge({ level: 'admin', prefix: 'users' })
await users('show', { user: 1 })      // ✅ params checked at compile time
```

See the [core README "Type safety" section](../core/README.md#type-safety-optional-but-recommended).

## Differences vs core / vue

| Capability | @route-forge/core | @route-forge/vue | @route-forge/react |
|------------|-------------------|------------------|--------------------|
| `levelLoaded` | `Promise<void>` | `Ref<boolean>` | `boolean` |
| `useForgeApi` `pending` / `error` | — (use `LoadingTracker`) | `Ref<boolean>` / `Ref<unknown>` | `boolean` / `unknown` |
| URL generation returns | `string` (sync; throws when unready) | `ComputedRef<string>` (`''` until ready) | `string` (`''` until ready) |
| `useForgeRoute` params | — | getter function | plain object (content-compared deps) |
| Binding signature | `forge.use(level, prefix?)` | `useForge(level?, prefix?)` | `useForge({ level?, prefix? })` |

## FAQ

**`useForge()` says "must be used within a `<RouteForgeProvider>`"?**
The hook ran outside the Provider; make sure the component tree is wrapped in `<RouteForgeProvider>`.

**Do inline `options` objects rebuild the instance every render?**
No. The Provider shallow-compares `options` (including array elements and nested plain objects) and keeps the same instance while values are unchanged; it rebuilds only when the configuration actually changes.

**Where do imperative calls go?**
Inside event handlers / `useEffect` — never `await` during render; only `useForgeRoute` (which returns a string synchronously) belongs in the render phase.

## Documentation

- Repository: <https://github.com/route-forge/route-forge>
- Core package: [@route-forge/core](../core/README.md)
- Design notes: <https://github.com/route-forge/route-forge/blob/main/.docs/DESIGN.md>
- Specification: <https://github.com/route-forge/route-forge/blob/main/.docs/SPEC.md>

## License

MIT
