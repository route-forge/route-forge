import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM + CJS（Node / 打包工具消费）
  {
    entry: {
      index: 'src/index.ts',
      codegen: 'src/codegen/index.ts',
      defineImmutableProps: 'src/defineImmutableProps.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: 'es2020',
  },
  // IIFE（浏览器 <script> 标签直接引入）
  {
    entry: { 'route-forge.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'RouteForge',
    external: ['axios'],
    outExtension: () => ({ js: '.js' }),
    sourcemap: true,
    treeshake: true,
    target: 'es2020',
  },
  // IIFE minified（生产环境）
  {
    entry: { 'route-forge.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'RouteForge',
    external: ['axios'],
    outExtension: () => ({ js: '.min.js' }),
    minify: true,
    treeshake: true,
    target: 'es2020',
  },
]);
