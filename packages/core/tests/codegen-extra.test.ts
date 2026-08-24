import { describe, expect, it } from 'vitest';
import { generateRouteTypes } from '../src/codegen/index.js';
import type { RouteMeta } from '../src/types.js';

function gen(routes: Record<string, RouteMeta>): string {
  return generateRouteTypes({ public: routes });
}

describe('codegen — optional parameter generation (regression)', () => {
  it('uri {param?} generates optional typed field', () => {
    const dts = gen({
      'posts.index': {
        name: 'posts.index',
        uri: 'posts/{page?}',
        methods: ['GET'],
        parameters: ['page'],
      },
    });
    expect(dts).toContain('page?: string | number;');
    expect(dts).not.toContain('page: string | number;');
  });

  it('parameter with backend default value generates optional field', () => {
    const dts = gen({
      'list.index': {
        name: 'list.index',
        uri: 'list/{sort}',
        methods: ['GET'],
        parameters: ['sort'],
        parameter_defaults: { sort: 'created_at' },
      },
    });
    expect(dts).toContain('sort?: string | number;');
  });

  it('required parameter stays required', () => {
    const dts = gen({
      'user.show': {
        name: 'user.show',
        uri: 'users/{user}',
        methods: ['GET'],
        parameters: ['user'],
      },
    });
    expect(dts).toContain('user: string | number;');
    expect(dts).not.toContain('user?:');
  });

  it('mixed required and optional params in one route', () => {
    const dts = gen({
      'posts.show': {
        name: 'posts.show',
        uri: '{locale?}/posts/{post}',
        methods: ['GET'],
        parameters: ['locale', 'post'],
      },
    });
    expect(dts).toContain('locale?: string | number;');
    expect(dts).toContain('post: string | number;');
  });

  it('required param wins over optionality of unrelated placeholder', () => {
    // uri 含 {a?} 不应影响参数 b 的必填性（按参数名精确匹配 {b?}）
    const dts = gen({
      'mix.show': {
        name: 'mix.show',
        uri: 'mix/{a?}/{b}',
        methods: ['GET'],
        parameters: ['a', 'b'],
      },
    });
    expect(dts).toContain('a?: string | number;');
    expect(dts).toContain('b: string | number;');
  });
});

describe('codegen — method & body field selection extras', () => {
  it('PATCH route gets body field', () => {
    const dts = gen({
      'user.patch': {
        name: 'user.patch',
        uri: 'users/{user}',
        methods: ['PATCH'],
        parameters: ['user'],
      },
    });
    expect(dts).toContain('method: "PATCH"');
    expect(dts).toContain('body: unknown;');
  });

  it('DELETE route does not get body field', () => {
    const dts = gen({
      'user.destroy': {
        name: 'user.destroy',
        uri: 'users/{user}',
        methods: ['DELETE'],
        parameters: ['user'],
      },
    });
    expect(dts).toContain('method: "DELETE"');
    expect(dts).not.toContain('body:');
  });

  it('HEAD-only route falls back to GET', () => {
    const dts = gen({
      'ping.check': {
        name: 'ping.check',
        uri: 'ping',
        methods: ['HEAD'],
        parameters: [],
      },
    });
    expect(dts).toContain('method: "GET"');
  });

  it('empty params object is emitted as empty braces', () => {
    const dts = gen({
      'home': { name: 'home', uri: 'home', methods: ['GET'], parameters: [] },
    });
    expect(dts).toContain('params: {  };');
  });
});
