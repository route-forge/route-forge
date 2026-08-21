<?php

declare(strict_types=1);

namespace RouteForge\Laravel;

use Closure;
use Illuminate\Contracts\Cache\Repository as CacheRepository;
use Illuminate\Contracts\Container\Container;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Routing\Contracts\Router as RouterContract;
use Illuminate\Routing\Router as BaseRouter;
use Illuminate\Support\ServiceProvider;
use RouteForge\Laravel\Cache\RouteCache;

/**
 * Route Forge ServiceProvider。
 *
 * 负责（对应 .docs/SPEC.md §3）：
 *   1. 注册 `->tier()` 宏到 Illuminate\Routing\Route（§3.1.1）
 *   2. 把 'router' 单例重绑为 ForgeRouter，让 Route::group(['tier'=>...]) 自动透传
 *      tier 到组内每条路由的 action（§3.1.3, §3.1.4）
 *   3. 绑定 RouteCache / TierResolver / RouteRepository 依赖（§3.1.5）
 *   4. 注册元信息查询端点 `GET /_forge/routes/{level}`（§3.1.5）
 *   5. 发布 config/forge.php
 *
 * 重绑时机说明：
 *   - register() 在所有 ServiceProvider 的 boot() 之前执行；
 *   - RoutingServiceProvider 的 'router' 是 lazy singleton（首次解析才实例化）；
 *   - RouteServiceProvider 通常在 boot() 阶段才解析 router 注册路由，
 *     因此我们在 register() 阶段重新绑定 'router'，可让首解析时拿到 ForgeRouter。
 *
 * ⚠ HTTP 流程下的关键坑（Laravel 11+ 骨架）：
 *   public/index.php → Application::handleRequest() → make(HttpKernel)，
 *   而 Http\Kernel::__construct(Application $app, Router $router) 在 bootstrap
 *   （RegisterProviders）之前就会解析并持有原生 Router 实例。等我们的
 *   register() 重绑 'router' 时，容器绑定虽已替换，Kernel 手里攥着的仍是旧
 *   实例：路由经 Route:: 门面注册进 ForgeRouter，分发却走旧 Router（空集合）
 *   → 所有 URL 404。因此 rebindRouter() 必须检测此情形，让 ForgeRouter 与
 *   已被捕获的旧 Router 共享同一个 RouteCollection（见 rebindRouter 实现）。
 *   Console Kernel 构造函数不注入 Router，Artisan 流程无此问题。
 */
class ForgeServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->registerTierMacro();
        $this->registerMetadataEndpoint();
        $this->publishConfig();

        // 注册 Artisan 命令（SPEC §3.2）
        $this->commands([
            \RouteForge\Laravel\Console\RouteForgeListCommand::class,
            \RouteForge\Laravel\Console\RouteForgeTypesCommand::class,
        ]);
    }

    public function register(): void
    {
        $this->rebindRouter();
        $this->registerBindings();
        $this->mergeConfigFrom(__DIR__ . '/../config/forge.php', 'forge');
    }

    /**
     * 重绑 'router' 单例为 ForgeRouter，覆盖 Illuminate\Routing\Router。
     *
     * 若重绑前 'router' 已被解析（HTTP 流程下 Http\Kernel 构造函数先于
     * RegisterProviders 解析并捕获了原生 Router），则额外让新 ForgeRouter
     * 与旧实例共享同一个 RouteCollection：
     *   - 后续经 Route:: 门面注册的路由（走 ForgeRouter）进入共享集合；
     *   - Kernel 分发时用其持有的旧 Router，命中的仍是同一个集合；
     *   - group(['tier']) 透传由 ForgeRouter 的 updateGroupStack /
     *     mergeGroupAttributesIntoRoute 覆盖完成，行为不受影响。
     */
    protected function rebindRouter(): void
    {
        // 重绑前先捕获可能已解析的原生 Router 实例（Kernel 可能已持有它）
        $previous = $this->app->resolved('router') ? $this->app->make('router') : null;

        $this->app->singleton('router', function ($app) {
            /** @var Container $app */
            $events = $app->make(Dispatcher::class);
            $router = new ForgeRouter($events, $app);

            // 同步 Router 与 routes collection 的事件订阅
            // （与原生 RoutingServiceProvider 行为一致）
            if (method_exists($router, 'setEventsDispatcher')) {
                $router->setEventsDispatcher($events);
            }

            return $router;
        });

        // 同时绑定 Router 契约别名，避免某些包通过 alias 解析时绕过 ForgeRouter
        $this->app->alias('router', RouterContract::class);

        if ($previous instanceof BaseRouter && ! $previous instanceof ForgeRouter) {
            // Kernel（或其他早于本 provider 的代码）已持有原生 Router 引用：
            // 替换引用不可能，只能让 ForgeRouter 共享其 routes collection，
            // 保证「门面注册」与「Kernel 分发」操作同一个路由集合，避免全量 404。
            $this->app->make('router')->setRoutes($previous->getRoutes());
        }
    }

    /**
     * 绑定 RouteForge 后端服务的核心依赖（§3.1.5）。
     *
     * RouteMetadataController 通过构造函数注入 RouteRepository；
     * 容器自动解析时，需要预先绑定 RouteCache / TierResolver / RouteRepository
     * 这三个非自动可解析的构造参数（特别是 array 类型）。
     */
    protected function registerBindings(): void
    {
        // RouteCache：按 forge.cache_driver 选择 store；null 表示用默认 cache.store
        $this->app->singleton(RouteCache::class, function ($app) {
            /** @var Container $app */
            $driver = $app->make('config')->get('forge.cache_driver');
            $store = $driver === null
                ? $app->make(CacheRepository::class)
                : $app->make('cache')->store($driver);
            return new RouteCache($store);
        });

        // TierResolver：从 forge 配置组装
        $this->app->singleton(TierResolver::class, function ($app) {
            /** @var Container $app */
            $classifier = $app->make('config')->get('forge.classifier');
            return new TierResolver(
                levelsConfig: $app->make('config')->get('forge.levels', []),
                classifier: $classifier instanceof Closure ? $classifier : null,
                strictMode: (bool) $app->make('config')->get('forge.strict_mode', false),
                fallbackLevel: $app->make('config')->get('forge.fallback_level'),
            );
        });

        // RouteRepository：组合 router + tierResolver + cache + levelsConfig
        $this->app->singleton(RouteRepository::class, function ($app) {
            /** @var Container $app */
            return new RouteRepository(
                router: $app->make('router'),
                tierResolver: $app->make(TierResolver::class),
                cache: $app->make(RouteCache::class),
                levelsConfig: $app->make('config')->get('forge.levels', []),
            );
        });
    }

    /**
     * 注册 `->tier()` 宏到 Illuminate\Routing\Route。
     * 仅向 action 数组写入一个 `tier` 字段，零侵入。
     */
    protected function registerTierMacro(): void
    {
        /** @var \Illuminate\Routing\Route $route */
        \Illuminate\Routing\Route::macro('tier', function (string $tier): \Illuminate\Routing\Route {
            $action = $this->getAction();
            $action['tier'] = $tier;
            $this->setAction($action);
            return $this;
        });
    }

    /**
     * 注册元信息查询端点 GET /{endpoint_prefix}/{level} 与摘要端点 GET /{endpoint_prefix}。
     *
     * prefix 规范化：确保前导 /、去除尾部 /，避免双斜杠（默认配置为 '/_forge/routes'
     * 已带前导 /，不可再额外拼接）。
     */
    protected function registerMetadataEndpoint(): void
    {
        $prefix = (string) config('forge.endpoint_prefix', '/_forge/routes');
        // 规范化：确保前导 /，去除尾部 /，避免双斜杠
        $prefix = '/' . ltrim(rtrim($prefix, '/'), '/');

        $this->app['router']->get(
            "{$prefix}/{level}",
            [\RouteForge\Laravel\Http\RouteMetadataController::class, 'show']
        )->name('forge.routes.show');

        // 摘要端点（SPEC §3.1.6）：GET /{prefix}
        $this->app['router']->get(
            $prefix,
            [\RouteForge\Laravel\Http\RouteMetadataController::class, 'index']
        )->name('forge.routes.index');
    }

    /**
     * 发布 config/forge.php 到宿主项目
     */
    protected function publishConfig(): void
    {
        if ($this->app->runningInConsole()) {
            $this->publishes([
                __DIR__ . '/../config/forge.php' => $this->app->configPath('forge.php'),
            ], 'forge-config');
        }
    }
}
