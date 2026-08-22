# @route-forge/vue

Route Forge 的 Vue 3 集成:插件 + composable(`useForgeApi` / `useForgeLevel` / `useForgeRoute` / `useForgeByPrefix`)。

## 安装

```bash
pnpm add @route-forge/vue @route-forge/core
```

## 基本用法

```ts
// main.ts
import { createApp } from 'vue'
import { createRouteForgePlugin } from '@route-forge/vue'
import App from './App.vue'

const app = createApp(App)
app.use(createRouteForgePlugin({
  endpoint: '/_forge/routes',
}))
app.mount('#app')
```

```vue
<script setup lang="ts">
import { useForgeRoute } from '@route-forge/vue'

const url = useForgeRoute('public', 'login.show')
</script>
```

## 文档

- 仓库主页: https://github.com/xyj2156/route-forge
- 设计文档: https://github.com/xyj2156/route-forge/blob/main/.docs/DESIGN.md
- 规范: https://github.com/xyj2156/route-forge/blob/main/.docs/SPEC.md

## License

MIT
