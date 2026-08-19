<?php

declare(strict_types=1);

namespace RouteForge\Laravel;

use Illuminate\Routing\Route;
use Illuminate\Support\Arr;
use RouteForge\Laravel\Exceptions\RouteTierNotAssignedException;
use RouteForge\Laravel\Exceptions\ClassifierException;

/**
 * 层级分配器：根据 SPEC §3.1.4 的优先级规则，决定一条路由最终归属的层级。
 *
 * 优先级（高 → 低）：
 *   1. 显式 ->tier() 调用（route.action['tier']）
 *   2. Route::group 的 tier 选项（同样写入 action['tier']，等价语法糖）
 *   3. classifier 自定义回调返回非 null 值
 *   4. 配置 match 规则匹配（prefix / middleware）
 *   5. fallback_level 兜底（仅 strict_mode=false 时生效）
 */
class TierResolver
{
    public function __construct(
        private readonly array $levelsConfig,
        private readonly ?\Closure $classifier = null,
        private readonly bool $strictMode = false,
        private readonly ?string $fallbackLevel = null,
    ) {
    }

    /**
     * 解析一条路由的最终层级。
     *
     * @throws RouteTierNotAssignedException 当 strict_mode=true 且未命中任何层级
     * @throws ClassifierException 当 classifier 回调抛错
     */
    public function resolve(Route $route): ?string
    {
        // 1 & 2：显式 ->tier() 与 group tier 透传（最终都写入 action['tier']）
        $explicit = Arr::get($route->getAction(), 'tier');
        if (is_string($explicit) && $explicit !== '') {
            return $explicit;
        }

        // 3：classifier 回调
        if ($this->classifier !== null) {
            try {
                $result = call_user_func($this->classifier, $route);
                if (is_string($result) && $result !== '') {
                    return $result;
                }
            } catch (\Throwable $e) {
                throw new ClassifierException(
                    'Classifier callback threw: ' . $e->getMessage(),
                    previous: $e
                );
            }
        }

        // 4：配置 match 规则
        foreach ($this->levelsConfig as $level => $config) {
            if ($this->matchConfig($route, $config['match'] ?? [])) {
                return $level;
            }
        }

        // 5：兜底
        if (!$this->strictMode && $this->fallbackLevel !== null) {
            return $this->fallbackLevel;
        }

        if ($this->strictMode) {
            throw new RouteTierNotAssignedException(
                'Route ' . $route->getName() . ' (' . $route->uri() . ') has no tier assigned'
            );
        }

        return null;
    }

    /**
     * 配置 match 规则匹配：
     *   - prefix: 路由 URI 命中任一前缀即归入此层级
     *   - middleware: 路由中间件集合包含数组中任意一项即命中
     */
    private function matchConfig(Route $route, array $match): bool
    {
        $prefixes = $match['prefix'] ?? [];
        $middlewares = $match['middleware'] ?? [];

        foreach ((array) $prefixes as $prefix) {
            if (str_starts_with($route->uri(), $prefix . '/') || $route->uri() === $prefix) {
                return true;
            }
        }

        if (count($middlewares) > 0) {
            $routeMiddlewares = $route->gatherMiddleware();
            foreach ((array) $middlewares as $mw) {
                if (in_array($mw, $routeMiddlewares, true)) {
                    return true;
                }
            }
        }

        return false;
    }
}
