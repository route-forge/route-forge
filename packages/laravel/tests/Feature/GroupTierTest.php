<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Tests\Feature;

use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as RouteFacade;
use Orchestra\Testbench\TestCase;
use RouteForge\Laravel\ForgeServiceProvider;

/**
 * Tier 分配端到端验证（对应 .docs/SPEC.md §3.1.1, §3.1.3, §3.1.4）。
 *
 * 覆盖：
 *   - 显式 `->tier()` 宏
 *   - Route::group(['tier' => ...]) 透传
 *   - 嵌套 group：内层 tier 覆盖外层 tier（与 middleware 合并策略一致）
 *   - 优先级：显式 `->tier()` 覆盖 group tier
 *
 * 注意：Testbench 中路由在测试方法体内注册（app 已 booted 之后），
 * RouteServiceProvider 的 `$app->booted` 回调（含 refreshNameLookups）
 * 此时已执行过，不会刷新测试内新增的路由。所以每次查找前需手动 refresh。
 */
class GroupTierTest extends TestCase
{
    protected function getPackageProviders($app): array
    {
        return [ForgeServiceProvider::class];
    }

    private function routeTier(?string $name): ?string
    {
        // 测试方法体内 `Route::post(...)->name(...)` 注册的路由不在 nameList 中
        // （addLookups 在 add() 时调用，那时 route 还没 name；chain 上的 ->name() 不刷新 nameList）。
        // RouteServiceProvider 的 $app->booted 回调已执行过，不会重刷。
        // 所以这里手动 refresh 一下。
        RouteFacade::getRoutes()->refreshNameLookups();

        $route = RouteFacade::getRoutes()->getByName($name);
        if (! $route instanceof Route) {
            return null;
        }
        $action = $route->getAction();
        return $action['tier'] ?? null;
    }

    public function test_explicit_tier_macro_sets_action(): void
    {
        RouteFacade::post('/auth/login', static function () {})
            ->name('auth.login')
            ->tier('public');

        $this->assertSame('public', $this->routeTier('auth.login'));
    }

    public function test_group_tier_is_propagated_to_routes_inside(): void
    {
        RouteFacade::group(['tier' => 'admin'], function () {
            RouteFacade::get('/admin/users', static function () {})
                ->name('admin.users.index');
            RouteFacade::post('/admin/users', static function () {})
                ->name('admin.users.store');
        });

        $this->assertSame('admin', $this->routeTier('admin.users.index'));
        $this->assertSame('admin', $this->routeTier('admin.users.store'));
    }

    public function test_nested_group_inner_tier_overrides_outer(): void
    {
        RouteFacade::group(['tier' => 'admin'], function () {
            RouteFacade::get('/a', static function () {})
                ->name('a');

            RouteFacade::group(['tier' => 'manage'], function () {
                RouteFacade::get('/b', static function () {})
                    ->name('b');
            });
        });

        $this->assertSame('admin', $this->routeTier('a'));
        $this->assertSame('manage', $this->routeTier('b'));
    }

    public function test_explicit_tier_overrides_group_tier(): void
    {
        RouteFacade::group(['tier' => 'admin'], function () {
            // 显式 ->tier() 优先级最高，覆盖 group 透传的 admin
            RouteFacade::get('/override', static function () {})
                ->name('override')
                ->tier('manage');
        });

        $this->assertSame('manage', $this->routeTier('override'));
    }

    public function test_routes_outside_any_group_have_no_tier(): void
    {
        RouteFacade::get('/standalone', static function () {})
            ->name('standalone');

        $this->assertNull($this->routeTier('standalone'));
    }
}
