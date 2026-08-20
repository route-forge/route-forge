<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Console;

use Illuminate\Console\Command;
use Illuminate\Routing\Router;
use RouteForge\Laravel\TierResolver;

/**
 * 列出所有命名路由的层级分配
 * @see .docs/SPEC.md §3.2
 */
class RouteForgeListCommand extends Command
{
    protected $signature = 'route:forge:list
        {--level= : 仅列出指定层级下的路由}
        {--json : 输出 JSON 数组格式}
        {--unassigned : 仅列出未分配层级的路由}';

    protected $description = '列出所有命名路由的层级分配（route:forge:list --level=admin --json --unassigned）';

    public function handle(Router $router, TierResolver $resolver): int
    {
        $levels = array_keys(config('forge.levels', []));
        $fallback = config('forge.fallback_level');

        $filterLevel = $this->option('level');
        $onlyUnassigned = (bool) $this->option('unassigned');
        $asJson = (bool) $this->option('json');

        // level 过滤校验
        if ($filterLevel !== null && $filterLevel !== '' && !in_array($filterLevel, $levels, true)) {
            $this->error("Unknown level: {$filterLevel}");
            $this->line('Available levels: ' . (empty($levels) ? '(none)' : implode(', ', $levels)));
            return 1;
        }

        // 收集所有命名路由
        $rows = [];
        foreach ($router->getRoutes() as $route) {
            $name = $route->getName();
            if ($name === null || $name === '') {
                continue;
            }
            // 跳过 forge 自身元信息端点路由
            if (str_starts_with($name, 'forge.routes.')) {
                continue;
            }

            $level = $resolver->resolve($route);
            $methods = array_values(array_filter(
                $route->methods(),
                fn ($m) => strtoupper($m) !== 'HEAD'
            ));

            // --level 过滤
            if ($filterLevel !== null && $filterLevel !== '' && $level !== $filterLevel) {
                continue;
            }

            // --unassigned 过滤
            if ($onlyUnassigned && $level !== null) {
                continue;
            }

            $rows[] = [
                'name' => $name,
                'level' => $level,
                'methods' => $methods,
                'uri' => $route->uri(),
            ];
        }

        // --unassigned + fallback 非 null 时输出为空
        if ($onlyUnassigned && $fallback !== null) {
            $rows = [];
        }

        // JSON 输出
        if ($asJson) {
            $this->line(json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            return 0;
        }

        // table 输出
        if (empty($rows)) {
            $this->info('No routes found matching the filter.');
            return 0;
        }

        $tableRows = array_map(function (array $r) {
            return [
                $r['name'],
                $r['level'] ?? '⚠ 未分配',
                implode(',', $r['methods']),
                $r['uri'],
            ];
        }, $rows);

        $this->table(['Name', 'Level', 'Methods', 'URI'], $tableRows);
        return 0;
    }
}
