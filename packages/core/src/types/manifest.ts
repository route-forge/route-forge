/**
 * 后端 manifest 契约类型（HTTP 层拉取的数据结构）
 * @see .docs/SPEC.md §3.1
 */

/**
 * 路由元信息（后端 /_forge/routes/{level} 返回的单条路由结构）
 */
export interface RouteMeta {
  /** 路由名，如 'admin.users.show' */
  name: string;
  /** 路由 URI 模板，如 'admin/users/{user}' */
  uri: string;
  /** 支持的 HTTP 方法集合，如 ['GET','HEAD'] */
  methods: string[];
  /** 路径参数名列表，如 ['user'] */
  parameters: string[];
  /** 路径参数默认值（Laravel ->defaults()），key 为参数名，value 为默认值 */
  parameter_defaults?: Record<string, unknown>;
  /** 所属层级（前端填充，便于隔离缓存） */
  level?: string;
  /**
   * 后端 manifest 契约预留字段：路由级缓存 TTL（秒）。
   * 当前后端层级表响应（LevelRoutesResponse）不下发此字段，缓存 TTL 统一由摘要
   * `config.cache_ttl`（全局，见 cache.ts / auto-discovery）驱动；保留字段位以便将来支持路由级缓存时不改类型。
   */
  cache?: number | null;
}

/**
 * 某层级下的全部路由元信息响应（后端 GET {levels[level].route.uri} 返回）。
 * 结构为 `{ level, routes }`，缓存 TTL 不在层级表内下发，统一取自摘要 config.cache_ttl。
 */
export interface LevelRoutesResponse {
  level: string;
  /** 路由名 → 路由元信息；后端空层级序列化为 `{}`（对象契约，非数组） */
  routes: Record<string, RouteMeta>;
}

/**
 * 摘要端点响应（SPEC §3.1.6）
 * GET {endpoint_prefix} 返回此结构；同时是 @forgeSummary 注入 window.__ROUTE_FORGE__ 的值。
 *
 * unassigned 不是顶层字段，而是 `levels` 中一个恒存在的特殊层级，
 * 前端按其 route.uri 走 HTTP 懒加载获取未分配路由明细。
 */
export interface SummaryResponse {
  /**
   * manifest 协议版本号（拼写为 scheme「方案」而非 schema；DESIGN.md §6.3），必填，默认 1；
   * 前端据此做向前兼容（>1 时告警）。
   */
  schemeVersion: number;
  levels: Record<
    string,
    {
      description: string;
      load: 'lazy' | 'eager';
      route_count: number;
      /** 该层级明细端点的自描述，前端据此拼 URL 懒加载（endpoint_prefix 仅作兜底） */
      route: {
        /** 层级明细端点绝对路径，如 '/_forge/routes/admin' */
        uri: string;
        /** 恒为 ['GET','HEAD'] */
        methods: string[];
      };
    }
  >;
  config: {
    strict_mode: boolean;
    endpoint_prefix: string;
    /** 后端下发的 URL 前缀，生成业务 URL 时拼接到路由 URI 前；未配置为 null（SPEC §3.1.6） */
    url_prefix: string | null;
    /** 全局统一缓存 TTL（秒）：null=不缓存、0=永久、正整数=N 秒；后端已把负值归一为 null */
    cache_ttl: number | null;
  };
}

/**
 * 缓存存储介质
 */
export type CacheStorage = 'memory' | 'sessionStorage' | 'localStorage';
