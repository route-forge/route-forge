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
 *
 * Keys 索引：
 *   为支持 clear() 一次性清空所有层级（Laravel Cache 不支持通配符 key），
 *   维护一个独立的 route-forge:_keys 列表，set() 时追加、forget() 时移除、clear() 时遍历删除。
 */
class RouteCache
{
    private const KEY_PREFIX = 'route-forge:';

    private const KEYS_INDEX = 'route-forge:_keys';

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
            $key = $this->key($level);
            if ($ttl === 0) {
                $this->store->forever($key, $payload);
            } else {
                $this->store->put($key, $payload, (int) $ttl);
            }
            // 维护 keys 索引（用于 clear() 不依赖通配符）
            $this->registerKey($key);
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
        $key = $this->key($level);
        $this->store->forget($key);
        $this->unregisterKey($key);
    }

    public function clear(): void
    {
        if ($this->store === null) {
            return;
        }
        try {
            $keys = $this->store->get(self::KEYS_INDEX);
            if (is_array($keys)) {
                foreach ($keys as $key) {
                    $this->store->forget((string) $key);
                }
                $this->store->forget(self::KEYS_INDEX);
            }
        } catch (\Throwable $e) {
            throw new CacheDriverException(
                'Cache driver error: ' . $e->getMessage(),
                previous: $e
            );
        }
    }

    private function key(string $level): string
    {
        return self::KEY_PREFIX . $level;
    }

    private function registerKey(string $key): void
    {
        $keys = $this->store->get(self::KEYS_INDEX);
        $keys = is_array($keys) ? $keys : [];
        if (!in_array($key, $keys, true)) {
            $keys[] = $key;
            // 索引本身永久缓存（不随单个 level TTL 失效）
            $this->store->forever(self::KEYS_INDEX, $keys);
        }
    }

    private function unregisterKey(string $key): void
    {
        try {
            $keys = $this->store->get(self::KEYS_INDEX);
            if (!is_array($keys)) {
                return;
            }
            $keys = array_values(array_filter($keys, fn ($k) => $k !== $key));
            $this->store->forever(self::KEYS_INDEX, $keys);
        } catch (\Throwable $e) {
            throw new CacheDriverException(
                'Cache driver error: ' . $e->getMessage(),
                previous: $e
            );
        }
    }
}
