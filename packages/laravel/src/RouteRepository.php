<?php

declare(strict_types=1);

namespace RouteForge\Laravel;

use Illuminate\Routing\Router;
use Illuminate\Routing\Route;
use Illuminate\Support\Collection;
use RouteForge\Laravel\Cache\RouteCache;

/**
 * 路由仓库：扫描 Laravel RouteCollection，按层级分组返回元信息。
 *
 * 元信息结构（对应前端 RouteMeta）：
 *   {
 *     "level": "admin",
 *     "routes": {
 *       "admin.users.show": { "uri": "...", "methods": [...], "parameters": [...] }
 *     },
 *     "cache": 3600
 *   }
 */
class RouteRepository
{
    public function __construct(
        private readonly Router $router,
        private readonly TierResolver $tierResolver,
        private readonly RouteCache $cache,
        private readonly array $levelsConfig,
    ) {
    }

    /**
     * 取某层级下所有命名路由的元信息（带缓存）。
     *
     * @return array{
     *   level:string,
     *   routes:array<string,array{uri:string,methods:string[],parameters:string[]}>,
     *   cache:int|null
     * }
     */
    public function getRoutesByLevel(string $level): array
    {
        if (!isset($this->levelsConfig[$level])) {
            throw new Exceptions\UnknownLevelException("Unknown level: {$level}");
        }

        $cached = $this->cache->get($level);
        if ($cached !== null) {
            return $cached;
        }

        $routes = [];
        foreach ($this->router->getRoutes() as $route) {
            /** @var Route $route */
            $name = $route->getName();
            if ($name === null) {
                continue; // 未命名路由不出现在元信息里
            }
            $resolved = $this->tierResolver->resolve($route);
            if ($resolved !== $level) {
                continue;
            }
            $routes[$name] = [
                'uri' => $route->uri(),
                'methods' => $route->methods(),
                'parameters' => $route->parameterNames(),
            ];
        }

        $payload = [
            'level' => $level,
            'routes' => $routes,
            'cache' => $this->levelsConfig[$level]['cache'] ?? null,
        ];

        $this->cache->set($level, $payload);
        return $payload;
    }

    /**
     * 返回所有层级名（仅用于调试 / 健康检查）。
     */
    public function allLevels(): array
    {
        return array_keys($this->levelsConfig);
    }

    /**
     * 失效指定层级缓存；不传参失效全部。
     *
     * 摘要端点缓存（route-forge:summary）也需一并失效，
     * 因为 levels 概览的 route_count 与 unassigned 列表均依赖路由表。
     */
    public function invalidate(?string $level = null): void
    {
        if ($level !== null) {
            $this->cache->forget($level);
        } else {
            $this->cache->clear();
        }
        // 摘要端点缓存也需失效
        $this->cache->forget('summary');
    }

    /**
     * 摘要端点响应（SPEC §3.1.6）：返回所有层级概览、全局配置、未分配路由列表。
     *
     * 缓存策略：TTL 取所有层级 cache 字段的最大值；全为 null 不缓存。
     * 缓存 key：route-forge:summary
     *
     * @return array{
     *   levels: array<string,array{description:string,load:string,cache:int|null,route_count:int}>,
     *   config: array{strict_mode:bool,endpoint_prefix:string},
     *   unassigned: array<int,array{name:string,uri:string,methods:string[],parameters:string[]}>
     * }
     */
    public function getSummary(): array
    {
        $cached = $this->cache->get('summary');
        if ($cached !== null) {
            return $cached;
        }

        // levels 概览：每个层级 description/load/cache + route_count（扫描实际命中数）
        $levelsSummary = [];
        $levelRouteCounts = $this->countRoutesPerLevel();

        foreach ($this->levelsConfig as $level => $cfg) {
            $levelsSummary[$level] = [
                'description' => $cfg['description'] ?? '',
                'load' => $cfg['load'] ?? 'lazy',
                'cache' => $cfg['cache'] ?? null,
                'route_count' => $levelRouteCounts[$level] ?? 0,
            ];
        }

        // 全局配置摘要
        $config = [
            'strict_mode' => config('forge.strict_mode', false),
            'endpoint_prefix' => (string) config('forge.endpoint_prefix', '/_forge/routes'),
        ];

        // unassigned：fallback_level=null 时列出所有未命中层级的命名路由
        $unassigned = $this->getUnassignedRoutes();

        $payload = [
            'levels' => $levelsSummary,
            'config' => $config,
            'unassigned' => $unassigned,
        ];

        // 缓存 TTL = 所有层级 cache 最大值；全 null 不缓存
        $maxTtl = null;
        foreach ($this->levelsConfig as $cfg) {
            $cache = $cfg['cache'] ?? null;
            if ($cache !== null && ($maxTtl === null || $cache > $maxTtl)) {
                $maxTtl = $cache;
            }
        }
        if ($maxTtl !== null) {
            $this->cache->set('summary', array_merge($payload, ['cache' => $maxTtl]));
        }

        return $payload;
    }

    /**
     * 扫描所有命名路由，返回每个层级命中的路由数量。
     *
     * @return array<string,int>
     */
    private function countRoutesPerLevel(): array
    {
        $counts = [];
        foreach ($this->router->getRoutes() as $route) {
            $name = $route->getName();
            if ($name === null) {
                continue;
            }
            $resolved = $this->tierResolver->resolve($route);
            if ($resolved !== null) {
                $counts[$resolved] = ($counts[$resolved] ?? 0) + 1;
            }
        }
        return $counts;
    }

    /**
     * 未分配层级的路由列表（SPEC §3.1.6 unassigned 字段）。
     *
     * 当 fallback_level=null 时，tierResolver->resolve() 返回 null 的命名路由
     * 即为"未分配"。fallback_level 非 null 时所有路由都有层级，返回空数组。
     *
     * @return array<int,array{name:string,uri:string,methods:string[],parameters:string[]}>
     */
    public function getUnassignedRoutes(): array
    {
        $fallback = config('forge.fallback_level');
        if ($fallback !== null) {
            return [];
        }

        $unassigned = [];
        foreach ($this->router->getRoutes() as $route) {
            $name = $route->getName();
            if ($name === null) {
                continue;
            }
            $resolved = $this->tierResolver->resolve($route);
            if ($resolved === null) {
                $unassigned[] = [
                    'name' => $name,
                    'uri' => $route->uri(),
                    'methods' => $route->methods(),
                    'parameters' => $route->parameterNames(),
                ];
            }
        }

        return $unassigned;
    }
}
