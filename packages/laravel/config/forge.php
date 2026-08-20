<?php

declare(strict_types=1);

/**
 * 默认配置（route-forge/laravel）
 *
 * 发布到宿主项目后通过 config/forge.php 修改。
 * @see .docs/SPEC.md §3.1.2, §5.1
 */
return [

    /**
     * 层级定义表。键为层级名（完全可自定义，包不预设固定层级）。
     * 详见 DESIGN.md §6.4。
     */
    'levels' => [
        'public' => [
            'description' => '公共接口（无需登录）',
            'match' => [
                'prefix'     => ['auth', 'public'],
                'middleware' => [],
            ],
            'load'  => 'eager',
            'cache' => 3600,
        ],
        'client' => [
            'description' => '客户端用户接口',
            'match' => [
                'prefix'     => ['client'],
                'middleware' => ['auth'],
            ],
            'load'  => 'lazy',
            'cache' => 3600,
        ],
        'manage' => [
            'description' => '运营管理接口',
            'match' => [
                'prefix'     => ['manage'],
                'middleware' => ['auth', 'manage'],
            ],
            'load'  => 'lazy',
            'cache' => 3600,
        ],
        'admin' => [
            'description' => '系统管理接口',
            'match' => [
                'prefix'     => ['admin'],
                'middleware' => ['auth', 'admin'],
            ],
            'load'  => 'lazy',
            'cache' => 3600,
        ],
    ],

    /**
     * 路由元信息对外端点前缀。
     */
    'endpoint_prefix' => '/_forge/routes',

    /**
     * 缓存驱动；null = 使用默认缓存驱动；可指定 redis/file/array 等。
     */
    'cache_driver' => null,

    /**
     * 严格模式：未命中层级即抛异常（true）或归入 fallback_level（false）。
     */
    'strict_mode' => false,

    /**
     * 兜底层级名；strict_mode=false 时未命中路由归入此层级。
     * null 表示不兜底（未命中路由归入摘要端点的 unassigned 列表，详见 SPEC §3.1.6）。
     */
    'fallback_level' => null,

    /**
     * 自定义分类回调，签名 fn(Route $r): ?string
     * 优先级介于「显式 tier」与「配置 match」之间，用于复杂自定义分类逻辑。
     */
    'classifier' => null,
];
