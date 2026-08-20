<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Tests\Feature;

use Illuminate\Support\Facades\Route as RouteFacade;
use Orchestra\Testbench\TestCase;
use RouteForge\Laravel\ForgeServiceProvider;

/**
 * 元信息查询端点测试（对应 .docs/SPEC.md §3.1.5, §6.1, §7.1）。
 *
 * 覆盖：
 *   1. 200 + 响应结构（level / routes / cache / uri / methods / parameters）
 *   2. 层级隔离：不同 level 互不污染
 *   3. 未命名路由不出现在元信息里
 *   4. 未知层级 → 404 + RF_BE_002
 *   5. strict_mode + 未声明 tier 的命名路由 → 500 + RF_BE_001
 *   6. 缓存命中：二次请求直接返回缓存，不重扫
 *
 * 说明：
 *   - ForgeServiceProvider::boot() 已注册元信息端点 GET /{endpoint_prefix}/{level}
 *     （默认 endpoint_prefix = '_forge/routes'），命名 forge.routes.show。
 *   - 默认配置下 strict_mode=false、fallback_level='public'，
 *     故 forge.routes.show 自身会被归类到 public，不会污染 admin 等层级。
 */
class EndpointTest extends TestCase
{
    protected function getPackageProviders($app): array
    {
        return [ForgeServiceProvider::class];
    }

    private function endpoint(string $level): string
    {
        return $this->summaryEndpoint() . '/' . $level;
    }

    private function summaryEndpoint(): string
    {
        $prefix = (string) config('forge.endpoint_prefix', '/_forge/routes');
        // 与 ForgeServiceProvider::registerMetadataEndpoint() 保持一致的规范化
        return '/' . ltrim(rtrim($prefix, '/'), '/');
    }

    public function test_endpoint_returns_200_with_expected_structure(): void
    {
        RouteFacade::get('/admin/users', static function () {})
            ->name('admin.users.index')
            ->tier('admin');

        $response = $this->get($this->endpoint('admin'));

        $response->assertStatus(200);
        $payload = $response->json();
        $this->assertSame('admin', $payload['level']);
        $this->assertSame(3600, $payload['cache']);

        // 路由名带点（'admin.users.index'），不能用 Laravel json() 的 dot-path 访问
        // 直接从 routes 关联数组取条目
        $route = $payload['routes']['admin.users.index'] ?? null;
        $this->assertNotNull($route, 'admin.users.index should be present in routes');
        $this->assertSame('admin/users', $route['uri']);
        $this->assertSame(['GET', 'HEAD'], $route['methods']);
        $this->assertSame([], $route['parameters']);
    }

    public function test_endpoint_filters_routes_by_level(): void
    {
        RouteFacade::get('/admin/users', static function () {})
            ->name('admin.users.index')
            ->tier('admin');
        RouteFacade::get('/client/dashboard', static function () {})
            ->name('client.dashboard')
            ->tier('client');

        $adminRoutes = $this->get($this->endpoint('admin'))->json('routes');
        $this->assertArrayHasKey('admin.users.index', $adminRoutes);
        $this->assertArrayNotHasKey('client.dashboard', $adminRoutes);

        $clientRoutes = $this->get($this->endpoint('client'))->json('routes');
        $this->assertArrayHasKey('client.dashboard', $clientRoutes);
        $this->assertArrayNotHasKey('admin.users.index', $clientRoutes);
    }

    public function test_unnamed_routes_excluded_from_metadata(): void
    {
        // 命名路由
        RouteFacade::get('/admin/users', static function () {})
            ->name('admin.users.index')
            ->tier('admin');
        // 未命名路由（同层级，但不应出现在元信息里）
        RouteFacade::get('/admin/unnamed', static function () {})
            ->tier('admin');

        $routes = $this->get($this->endpoint('admin'))->json('routes');

        $this->assertArrayHasKey('admin.users.index', $routes);
        $this->assertCount(1, $routes);
    }

    public function test_unknown_level_returns_404(): void
    {
        $response = $this->get($this->endpoint('nonexistent'));

        $response->assertStatus(404);
        $this->assertSame('RF_BE_002', $response->json('error.code'));
        $this->assertSame('nonexistent', $response->json('error.level'));
    }

    public function test_strict_mode_unassigned_route_returns_500(): void
    {
        config()->set('forge.strict_mode', true);
        config()->set('forge.fallback_level', null);

        // 用户注册的未声明 tier 的命名路由；不匹配任何 prefix/middleware
        RouteFacade::get('/orphan', static function () {})
            ->name('orphan');

        // strict_mode=true 时，扫描任一层级都会遍历所有命名路由，
        // 命中 orphan（及元信息端点自身 forge.routes.show）时 TierResolver 抛 RF_BE_001
        $response = $this->get($this->endpoint('admin'));

        $response->assertStatus(500);
        $this->assertSame('RF_BE_001', $response->json('error.code'));
    }

    public function test_cache_hit_avoids_rescan(): void
    {
        config()->set('forge.cache_driver', 'array');

        RouteFacade::get('/admin/users', static function () {})
            ->name('admin.users.index')
            ->tier('admin');

        // 首次请求：cache miss → 扫描 → 写入 array 缓存
        $firstRoutes = $this->get($this->endpoint('admin'))->json('routes');
        $this->assertArrayHasKey('admin.users.index', $firstRoutes);

        // 在缓存写入之后，再注册一条 admin 层级路由
        RouteFacade::get('/admin/roles', static function () {})
            ->name('admin.roles.index')
            ->tier('admin');

        // 二次请求：cache hit → 直接返回缓存，不重扫
        $secondRoutes = $this->get($this->endpoint('admin'))->json('routes');

        $this->assertSame($firstRoutes, $secondRoutes);
        $this->assertArrayNotHasKey('admin.roles.index', $secondRoutes);
    }

    public function test_summary_endpoint_returns_levels_config_unassigned(): void
    {
        RouteFacade::get('/admin/users', static function () {})
            ->name('admin.users.index')
            ->tier('admin');
        // orphan 路由：不匹配任何层级 prefix/middleware，且无显式 tier
        RouteFacade::get('/orphan', static function () {})
            ->name('orphan');

        $response = $this->get($this->summaryEndpoint());

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'levels' => ['public', 'client', 'manage', 'admin'],
            'config' => ['strict_mode', 'endpoint_prefix'],
            'unassigned',
        ]);

        $payload = $response->json();
        $this->assertIsArray($payload['unassigned']);

        // 每条 unassigned 路由结构（SPEC §3.1.6 unassigned 字段）
        foreach ($payload['unassigned'] as $route) {
            $this->assertArrayHasKey('name', $route);
            $this->assertArrayHasKey('uri', $route);
            $this->assertArrayHasKey('methods', $route);
            $this->assertArrayHasKey('parameters', $route);
        }

        // levels 中每个层级应包含 description/load/cache/route_count
        foreach ($payload['levels'] as $levelInfo) {
            $this->assertArrayHasKey('description', $levelInfo);
            $this->assertArrayHasKey('load', $levelInfo);
            $this->assertArrayHasKey('cache', $levelInfo);
            $this->assertArrayHasKey('route_count', $levelInfo);
        }

        // admin 层级 route_count 应为 1（仅 admin.users.index）
        $this->assertSame(1, $payload['levels']['admin']['route_count']);

        // orphan 应出现在 unassigned 中（fallback_level=null 默认配置）
        $unassignedNames = array_column($payload['unassigned'], 'name');
        $this->assertContains('orphan', $unassignedNames);

        // config 摘要
        $this->assertFalse($payload['config']['strict_mode']);
        $this->assertSame('/_forge/routes', $payload['config']['endpoint_prefix']);
    }

    public function test_summary_endpoint_unassigned_is_empty_when_fallback_level_set(): void
    {
        config(['forge.fallback_level' => 'public']);

        $response = $this->get($this->summaryEndpoint());

        $response->assertStatus(200);
        $payload = $response->json();
        $this->assertSame([], $payload['unassigned']);
    }
}
