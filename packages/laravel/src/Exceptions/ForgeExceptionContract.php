<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Exceptions;

/**
 * 所有 Route Forge 后端错误的统一契约：提供 code() 与 httpStatus()。
 *
 * @see .docs/SPEC.md §6
 */
interface ForgeExceptionContract
{
    /** 错误码，如 'RF_BE_001' */
    public function code(): string;

    /** 对应 HTTP 状态码 */
    public function httpStatus(): int;
}
