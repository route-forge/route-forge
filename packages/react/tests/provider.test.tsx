import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ForgeContext, RouteForgeProvider, useForge } from '../src/index.js';
import { createElement } from 'react';

describe('@route-forge/react provider (scaffold smoke test)', () => {
  it('provides forge instance via context', () => {
    let forgeInstance: ReturnType<typeof useForge> | null = null;

    function TestComponent() {
      forgeInstance = useForge();
      return createElement('div', { 'data-testid': 'test' }, 'test');
    }

    render(
      createElement(
        RouteForgeProvider,
        { options: { endpoint: '/_forge/routes', levels: ['public'] } },
        createElement(TestComponent),
      ),
    );

    expect(forgeInstance).toBeTruthy();
    expect(typeof forgeInstance!.api).toBe('function');
    expect(typeof forgeInstance!.load).toBe('function');
    expect(typeof forgeInstance!.isLoaded).toBe('function');
  });

  it('throws when useForge is used outside provider', () => {
    function TestComponent() {
      useForge();
      return createElement('div', null, 'test');
    }

    expect(() => {
      render(createElement(TestComponent));
    }).toThrow('[route-forge/react] useForge() must be used within a <RouteForgeProvider>');
  });

  it('FORGE_CONTEXT is exported', () => {
    expect(ForgeContext).toBeTruthy();
  });
});
