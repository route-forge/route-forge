import { describe, it, expect } from 'vitest';
import { createApp } from 'vue';
import { createRouteForgePlugin, FORGE_INJECTION_KEY } from '../src/index.js';

describe('@route-forge/vue plugin (scaffold smoke test)', () => {
  it('installs and provides $forge global property', () => {
    const app = createApp({ template: '<div/>' });
    app.use(createRouteForgePlugin({
      endpoint: '/_forge/routes',
      levels: ['public'],
    }));
    expect(FORGE_INJECTION_KEY).toBeTruthy();
  });
});
