/**
 * url-utils 纯函数单测：斜杠规范化的三个原语 + buildUrl/fetchSummary 拼接一致性
 */
import { describe, it, expect } from 'vitest';
import { trimTrailingSlash, withLeadingSlash, joinBaseAndPath } from '../src/url-utils.js';
import { buildUrl } from '../src/url-builder.js';

describe('url-utils', () => {
  it('trimTrailingSlash 去掉一个结尾斜杠、幂等安全', () => {
    expect(trimTrailingSlash('http://x/')).toBe('http://x');
    expect(trimTrailingSlash('http://x')).toBe('http://x');
    expect(trimTrailingSlash('http://x//')).toBe('http://x/'); // 只去一个
    expect(trimTrailingSlash('')).toBe('');
  });

  it('withLeadingSlash 缺则补、已有不重复补', () => {
    expect(withLeadingSlash('foo')).toBe('/foo');
    expect(withLeadingSlash('/foo')).toBe('/foo');
    expect(withLeadingSlash('')).toBe('/');
  });

  it('joinBaseAndPath 规范化 base（去尾）与 path（补头）后拼接', () => {
    expect(joinBaseAndPath('http://x/', '/api')).toBe('http://x/api');
    expect(joinBaseAndPath('http://x', 'api')).toBe('http://x/api');
    expect(joinBaseAndPath('http://x/', 'api')).toBe('http://x/api');
    expect(joinBaseAndPath('http://x', '/api')).toBe('http://x/api');
  });

  it('buildUrl 与逐段拼接等价（回归：收敛四处重复后行为不变）', () => {
    // base 带尾斜杠 / endpoint 无头斜杠：规范化后仍是 base/endpoint/level
    expect(
      buildUrl('admin', { baseURL: 'http://h/', endpoint: 'prefix' }),
    ).toBe('http://h/prefix/admin');
    // level 走 encodeURIComponent
    expect(
      buildUrl('a b', { baseURL: 'http://h', endpoint: '/p' }),
    ).toBe('http://h/p/a%20b');
  });
});
