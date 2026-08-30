import { describe, expect, it } from 'vitest';
import {
  AdapterNotFoundError,
  ForgeError,
  HTTPError,
  InvalidInterceptorReturnError,
  MissingRouteParamError,
  NetworkError,
  UnknownLevelError,
  UnknownRouteError,
} from '../src/errors.js';

describe('error class contract', () => {
  it('all forge errors inherit from ForgeError and Error', () => {
    const instances = [
      new UnknownRouteError('a.b'),
      new UnknownLevelError('admin'),
      new MissingRouteParamError('a.b', ['id']),
      new AdapterNotFoundError('axios'),
      new InvalidInterceptorReturnError(),
      new NetworkError('net down'),
      new HTTPError('HTTP 500', {}),
    ];
    for (const e of instances) {
      expect(e).toBeInstanceOf(ForgeError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('name equals constructor name for every error class', () => {
    expect(new UnknownRouteError('x').name).toBe('UnknownRouteError');
    expect(new UnknownLevelError('x').name).toBe('UnknownLevelError');
    expect(new MissingRouteParamError('x', ['p']).name).toBe('MissingRouteParamError');
    expect(new AdapterNotFoundError('x').name).toBe('AdapterNotFoundError');
    expect(new InvalidInterceptorReturnError().name).toBe('InvalidInterceptorReturnError');
    expect(new NetworkError('m').name).toBe('NetworkError');
    expect(new HTTPError('m', {}).name).toBe('HTTPError');
  });

  it('optional fields stay undefined when not provided', () => {
    // code 已收窄为 ForgeErrorCode 字面量联合（v2.0.0），测试用合法码
    const e = new ForgeError('msg', { code: 'RF_FE_001' });
    expect(e.code).toBe('RF_FE_001');
    expect(e.message).toBe('msg');
    expect(e.route).toBeUndefined();
    expect(e.level).toBeUndefined();
    expect(e.context).toBeUndefined();
    expect(e.cause).toBeUndefined();
  });
});

describe('error codes and payloads', () => {
  it('UnknownRouteError carries RF_FE_001 with route and level', () => {
    const e = new UnknownRouteError('users.show', 'admin');
    expect(e.code).toBe('RF_FE_001');
    expect(e.route).toBe('users.show');
    expect(e.level).toBe('admin');
    expect(e.message).toContain('users.show');
    expect(e.message).toContain('admin');
  });

  it('UnknownLevelError carries RF_FE_002 with level only', () => {
    const e = new UnknownLevelError('ghost');
    expect(e.code).toBe('RF_FE_002');
    expect(e.level).toBe('ghost');
    expect(e.route).toBeUndefined();
  });

  it('MissingRouteParamError lists all missing params in context', () => {
    const e = new MissingRouteParamError('posts.update', ['post', 'user']);
    expect(e.code).toBe('RF_FE_003');
    expect(e.context?.missingParams).toEqual(['post', 'user']);
    expect(e.message).toContain('post, user');
  });

  it('AdapterNotFoundError carries RF_FE_005 with adapter name in context', () => {
    const e = new AdapterNotFoundError('axios');
    expect(e.code).toBe('RF_FE_005');
    expect(e.context?.adapter).toBe('axios');
  });

  it('InvalidInterceptorReturnError carries RF_FE_006', () => {
    const e = new InvalidInterceptorReturnError('users.index');
    expect(e.code).toBe('RF_FE_006');
    expect(e.route).toBe('users.index');
  });

  it('NetworkError carries RF_FE_007 and preserves cause chain', () => {
    const cause = new TypeError('fetch failed');
    const e = new NetworkError('request failed', 'users.index', 'public', cause);
    expect(e.code).toBe('RF_FE_007');
    expect(e.route).toBe('users.index');
    expect(e.level).toBe('public');
    expect(e.cause).toBe(cause);
  });

  it('HTTPError carries RF_FE_008 with status/url/method in context', () => {
    const e = new HTTPError('HTTP 503 for route "x"', {
      route: 'x',
      level: 'public',
      status: 503,
      url: '/x',
      method: 'GET',
    });
    expect(e.code).toBe('RF_FE_008');
    expect(e.context?.status).toBe(503);
    expect(e.context?.url).toBe('/x');
    expect(e.context?.method).toBe('GET');
  });
});
