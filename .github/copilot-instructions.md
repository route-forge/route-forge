# Copilot Instructions — Route Forge

Route Forge is a TypeScript client toolkit for Laravel named routes: it fetches route metadata from a backend manifest endpoint, lazy-loads route tables per level, and lets frontends call APIs / build URLs by route name. This is a pnpm + Turborepo monorepo publishing three npm packages; the Laravel backend lives in the separate repository `route-forge/route-forge-laravel` (HTTP manifest contract, independent versioning).

For the full agent guide (commands, design invariants, test pitfalls), see [AGENTS.md](../AGENTS.md). User-facing docs: [README.md](../README.md) (English, default) / [README_zh.md](../README_zh.md) (中文).

## Layout

- `packages/core` — `@route-forge/core`: framework-agnostic client (factory, cache, interceptors, adapters, codegen CLI, IIFE build)
- `packages/vue` — `@route-forge/vue`: Vue 3 plugin + composables (`useForge` / `useForgeApi` / `useForgeRoute`) + components (`ForgeRoute` / `ForgeLink`)
- `packages/react` — `@route-forge/react`: React Provider + hooks (same names) + components (`ForgeRoute` / `ForgeLink`)
- `.docs/SPEC.md` — feature specification + manifest HTTP contract; `.docs/DESIGN.md` — architecture notes

## Commands

```bash
pnpm install
npx turbo run typecheck test build --output-logs=errors-only --force   # full validation (required before commit)
pnpm --filter @route-forge/core test                                   # single-package tests (vitest)
```

Test baseline: 296 cases (core 224 / vue 34 / react 38) — all must pass before committing.

## Conventions

- Commit messages: `type(scope): 中文描述` (type ∈ feat/fix/test/docs/refactor/chore; scope = core|vue|react)
- Every commit requires the full validation to pass; new features and fixes must include tests
- Commits are GPG-signed; never `git push` without explicit instruction
- Docs are bilingual: `README.md` (English, default) + `README_zh.md` (Chinese); keep both in sync

## Design invariants (do not violate)

- Frontend validation always throws — never silently ignore: `UnknownLevelError`, `UnknownRouteError`, `MissingRouteParamError`. `RouteForgeOptions.strict` is deprecated (ignored); `strict_mode` is a backend manifest-generation concern only.
- Error codes are a stable contract: `ForgeErrorCode` literal union `RF_FE_001`…`RF_FE_010` (004 intentionally skipped).
- Metadata fetching (summary / level tables) uses the adapter's raw channel (`requestRaw`) and must stay outside business interceptor chains.
- `forge.use(level, prefix?)` returns a fresh `BoundForge` every call; `levelLoaded` is defined with `configurable: true` so Vue/React can override it — keep it configurable.
- React `useForge`: the `loadedRef` ref is the single source of truth and may only be written in effects/async callbacks (never during render — concurrent/StrictMode tearing).
- `useForgeRoute` degrades render-time errors to `''` with a styled `console.warn`; rendering must never throw. The `ForgeRoute` / `ForgeLink` components build on this sentinel (`loaded = href !== ''`): they render the `loading` slot/prop while unloaded, warn once per instance while the level is not loaded, and `console.error` on resolution failures.
- Mocking metadata responses in tests requires a `content-type: application/json` header, or `rawFetch` keeps `data` as a string.
