<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Exceptions;

use RuntimeException;

/**
 * RF_BE_004：classifier 回调抛错。
 *
 * @see .docs/SPEC.md §6.1
 */
class ClassifierException extends RuntimeException implements ForgeExceptionContract
{
    public function code(): string
    {
        return 'RF_BE_004';
    }

    public function httpStatus(): int
    {
        return 500;
    }
}
