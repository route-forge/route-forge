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
     */
    public function invalidate(?string $level = null): void
    {
        if ($level !== null) {
            $this->cache->forget($level);
        } else {
            $this->cache->clear();
        }
    }
}
