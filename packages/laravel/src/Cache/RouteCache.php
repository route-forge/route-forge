<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Cache;

use Illuminate\Contracts\Cache\Repository as CacheRepository;
use RouteForge\Laravel\Exceptions\CacheDriverException;

/**
 * 路由元信息缓存：按层级独立存放，互不污染。
 *
 * cache key 形如：route-forge:{level}
 *
 * TTL：
 *   - null：不缓存（每次扫描）
 *   - 0：永久缓存
 *   - 正整数：TTL 秒
 */
class RouteCache
{
    private const KEY_PREFIX = 'route-forge:';

    private readonly ?CacheRepository $store;

    public function __construct(?CacheRepository $store = null)
    {
        $this->store = $store;
    }

    /**
     * 取某层级的缓存条目；未缓存或不可用返回 null。
     *
     * @return array<string,mixed>|null
     */
    public function get(string $level): ?array
    {
        if ($this->store === null) {
            return null;
        }
        try {
            $value = $this->store->get($this->key($level));
            return is_array($value) ? $value : null;
        } catch (\Throwable $e) {
            throw new CacheDriverException(
                'Cache driver error: ' . $e->getMessage(),
                previous: $e
            );
        }
    }

    /**
     * 写入某层级缓存条目；payload 中应带 cache 字段决定 TTL。
     */
    public function set(string $level, array $payload): void
    {
        if ($this->store === null) {
            return;
        }
        $ttl = $payload['cache'] ?? null;
        try {
            if ($ttl === null) {
                return; // 不缓存
            }
            if ($ttl === 0) {
                // 永久缓存
                $this->store->forever($this->key($level), $payload);
            } else {
                $this->store->put($this->key($level), $payload, (int) $ttl);
            }
        } catch (\Throwable $e) {
            throw new CacheDriverException(
                'Cache driver error: ' . $e->getMessage(),
                previous: $e
            );
        }
    }

    public function forget(string $level): void
    {
        if ($this->store === null) {
            return;
        }
        $this->store->forget($this->key($level));
    }

    public function clear(): void
    {
        if ($this->store === null) {
            return;
        }
        foreach ($this->store->getStore()->get('route-forge:*') ?? [] as $key) {
            $this->store->forget((string) $key);
        }
    }

    private function key(string $level): string
    {
        return self::KEY_PREFIX . $level;
    }
}
