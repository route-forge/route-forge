<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Exceptions;

use RuntimeException;

/**
 * RF_BE_001：strict_mode=true 且路由未命中任何层级。
 *
 * @see .docs/SPEC.md §6.1
 */
class RouteTierNotAssignedException extends RuntimeException implements ForgeExceptionContract
{
    public function code(): string
    {
        return 'RF_BE_001';
    }

    public function httpStatus(): int
    {
        return 500;
    }
}
