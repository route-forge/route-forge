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
 *   4. 配置 match 规则匹配（prefix / middleware，middleware_match 支持 any/all/DNF；多层级命中取最后一个 = last-wins）
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

        // 4：配置 match 规则（last-wins：多个层级同时命中时取最后一个，SPEC §3.1.2）
        $matched = null;
        foreach ($this->levelsConfig as $level => $config) {
            if ($this->matchConfig($route, $config['match'] ?? [])) {
                $matched = $level;
            }
        }
        if ($matched !== null) {
            return $matched;
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
     *   - middleware: 路由中间件集合按 middleware_match 模式匹配（SPEC §3.1.2 中间件匹配模式）
     *
     * prefix 与 middleware 同时配置时，任一命中即归入此层级（OR 关系，与原有行为一致）。
     * 若两者都为空配置，则不命中（避免空 match 全量命中所有路由）。
     */
    private function matchConfig(Route $route, array $match): bool
    {
        $prefixes = $match['prefix'] ?? [];
        $middlewares = $match['middleware'] ?? [];
        $middlewareMatch = $match['middleware_match'] ?? 'any';

        // prefix: URI 命中任一前缀即命中此层级
        $prefixHit = false;
        foreach ((array) $prefixes as $prefix) {
            if ($prefix !== '' && (str_starts_with($route->uri(), $prefix . '/') || $route->uri() === $prefix)) {
                $prefixHit = true;
                break;
            }
        }

        // middleware: 按 middleware_match 模式匹配
        $middlewareHit = false;
        if (count($middlewares) > 0) {
            $routeMiddlewares = $route->gatherMiddleware();
            $middlewareHit = $this->matchMiddleware($routeMiddlewares, $middlewares, $middlewareMatch);
        }

        if (count($prefixes) === 0 && count($middlewares) === 0) {
            return false;
        }
        return $prefixHit || $middlewareHit;
    }

    /**
     * 中间件匹配模式实现（SPEC §3.1.2 中间件匹配模式）。
     *
     * @param string[]          $routeMiddlewares 路由实际中间件集合
     * @param string[]          $middlewares      配置的中间件列表（索引参与 DNF 求值）
     * @param string|array      $middlewareMatch  'any' | 'all' | DNF 嵌套数组
     */
    private function matchMiddleware(array $routeMiddlewares, array $middlewares, $middlewareMatch): bool
    {
        // 简单字符串模式
        if ($middlewareMatch === 'any') {
            foreach ($middlewares as $mw) {
                if (in_array($mw, $routeMiddlewares, true)) {
                    return true;
                }
            }
            return false;
        }

        if ($middlewareMatch === 'all') {
            foreach ($middlewares as $mw) {
                if (!in_array($mw, $routeMiddlewares, true)) {
                    return false;
                }
            }
            return count($middlewares) > 0;
        }

        // DNF 数组模式：内层 AND，外层 OR
        // 配置示例 [[0, 1], [2]] => (middlewares[0] AND middlewares[1]) OR middlewares[2]
        if (is_array($middlewareMatch)) {
            foreach ($middlewareMatch as $conjGroup) {
                if (!is_array($conjGroup) || count($conjGroup) === 0) {
                    continue;
                }
                $allPresent = true;
                foreach ($conjGroup as $idx) {
                    $idx = (int) $idx;
                    if (!isset($middlewares[$idx])) {
                        $allPresent = false;
                        break;
                    }
                    if (!in_array($middlewares[$idx], $routeMiddlewares, true)) {
                        $allPresent = false;
                        break;
                    }
                }
                if ($allPresent) {
                    return true;
                }
            }
            return false;
        }

        // 未知值降级为 any
        return $this->matchMiddleware($routeMiddlewares, $middlewares, 'any');
    }
}
