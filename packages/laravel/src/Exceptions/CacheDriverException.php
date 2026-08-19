<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Exceptions;

use RuntimeException;

/**
 * RF_BE_003：指定的 cache_driver 不可用。
 *
 * @see .docs/SPEC.md §6.1
 */
class CacheDriverException extends RuntimeException implements ForgeExceptionContract
{
    public function code(): string
    {
        return 'RF_BE_003';
    }

    public function httpStatus(): int
    {
        return 500;
    }
}
