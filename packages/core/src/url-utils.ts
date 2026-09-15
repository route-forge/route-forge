/**
 * URL 基础拼接工具：统一「base + path」的斜杠规范化，消除
 * url-builder / route-store / auto-discovery 三处各自实现的重复逻辑。
 *
 * 语义（四处原本一致，收敛为单一实现）：
 *   - base 去掉一个结尾 `/`（若有）
 *   - path 补一个开头 `/`（若缺）
 *   - 结果 = 规范化 base + 规范化 path
 */

/** 去掉结尾的一个 `/`（若有）。 */
export function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** 保证开头有一个 `/`（若缺则补）。 */
export function withLeadingSlash(s: string): string {
  return s.startsWith('/') ? s : `/${s}`;
}

/** 规范化 base（去尾斜杠）与 path（补头斜杠）后拼接。 */
export function joinBaseAndPath(base: string, path: string): string {
  return `${trimTrailingSlash(base)}${withLeadingSlash(path)}`;
}
