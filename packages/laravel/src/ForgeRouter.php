<?php

declare(strict_types=1);

namespace RouteForge\Laravel;

use Illuminate\Routing\Router as BaseRouter;

/**
 * Forge 扩展的 Router：覆盖 updateGroupStack 与 mergeGroupAttributesIntoRoute，
 * 让 group stack 中的 `tier` 属性透传到组内每条路由的 action 数组，
 * 等价于自动给组内每条路由调用 ->tier()。
 *
 * 设计要点（对应 .docs/SPEC.md §3.1.3, §3.1.4）：
 *   - 嵌套 group：内层 tier 覆盖外层 tier（与 Laravel middleware 合并策略一致）
 *   - 显式 ->tier() 仍优先级最高：因为它在路由返回链式调用时设置 action['tier']，
 *     发生在 mergeGroupAttributesIntoRoute 之后，自然覆盖 group 透传值
 *   - 不破坏 Laravel 原生 group 行为（prefix/middleware/namespace/where/domain 不变）
 *
 * 关键坑点（Laravel 11）：
 *   RouteGroup::merge() 内部用 array_merge_recursive 处理未知 key，
 *   对嵌套 group 的 string tier 会合并成 array `['admin', 'manage']`。
 *   ForgeRouter 必须在 updateGroupStack 中纠正 tier 为 string（取最后一个 = 内层），
 *   否则 groupStack 里 tier 是 array，会写入 route action 也是 array。
 *
 * 绑定方式：ForgeServiceProvider::register() 中通过 app->singleton('router', ...)
 * 覆盖 Illuminate\Routing\RoutingServiceProvider 的默认绑定。
 */
class ForgeRouter extends BaseRouter
{
    /**
     * 在 group attributes 入 groupStack 之前，纠正 tier 字段。
     *
     * RouteGroup::merge 用 array_merge_recursive 处理嵌套 string tier，会把它合并成 array。
     * 我们需要确保 tier 始终是 string（取内层 = 最后一个元素），符合「内层覆盖外层」约定。
     */
    protected function updateGroupStack(array $attributes) // phpcs:ignore
    {
        if ($this->hasGroupStack()) {
            $attributes = $this->mergeWithLastGroup($attributes);

            if (isset($attributes['tier'])) {
                $tier = $attributes['tier'];
                if (is_array($tier)) {
                    // array_merge_recursive 把多个 string 合并成 array
                    // 取最后一个元素 = 内层 group 的 tier（符合 SPEC §3.1.4 内层覆盖外层）
                    $tier = !empty($tier) ? end($tier) : null;
                    if (is_string($tier)) {
                        $attributes['tier'] = $tier;
                    } else {
                        unset($attributes['tier']);
                    }
                }
            }
        }

        $this->groupStack[] = $attributes;
    }

    /**
     * 在父类原生合并（namespace/controller/middleware/prefix/where 等）完成之后，
     * 把当前 group stack 顶层（最近一层 group，已通过 mergeGroup 合并嵌套属性）
     * 的 tier 字段写入路由 action。
     *
     * 签名说明：父类 Laravel Router::mergeGroupAttributesIntoRoute($route) 无参数类型提示
     * 也无返回类型；PHP 重写规则下子类必须保持一致（不能加返回类型，不能加参数类型）。
     */
    protected function mergeGroupAttributesIntoRoute($route) // phpcs:ignore
    {
        parent::mergeGroupAttributesIntoRoute($route);

        if (! $this->hasGroupStack()) {
            return;
        }

        $attributes = end($this->groupStack);
        if (is_array($attributes) && isset($attributes['tier']) && is_string($attributes['tier'])) {
            $action = $route->getAction();
            $action['tier'] = $attributes['tier'];
            $route->setAction($action);
        }
    }
}
