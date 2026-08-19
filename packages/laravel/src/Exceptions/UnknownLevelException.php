<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Exceptions;

use RuntimeException;

/**
 * RF_BE_002：请求的层级名不在 levels 配置中。
 *
 * @see .docs/SPEC.md §6.1
 */
class UnknownLevelException extends RuntimeException implements ForgeExceptionContract
{
    public function code(): string
    {
        return 'RF_BE_002';
    }

    public function httpStatus(): int
    {
        return 404;
    }
}
