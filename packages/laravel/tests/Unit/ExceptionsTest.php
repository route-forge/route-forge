<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Tests\Unit;

use PHPUnit\Framework\TestCase;
use RouteForge\Laravel\Exceptions\RouteTierNotAssignedException;
use RouteForge\Laravel\Exceptions\UnknownLevelException;
use RouteForge\Laravel\Exceptions\CacheDriverException;
use RouteForge\Laravel\Exceptions\ClassifierException;

/**
 * 异常契约冒烟测试（仅校验 code/httpStatus，未跑完整 Laravel 栈）。
 */
class ExceptionsTest extends TestCase
{
    public function test_exception_codes(): void
    {
        $this->assertSame('RF_BE_001', (new RouteTierNotAssignedException())->code());
        $this->assertSame('RF_BE_002', (new UnknownLevelException())->code());
        $this->assertSame('RF_BE_003', (new CacheDriverException())->code());
        $this->assertSame('RF_BE_004', (new ClassifierException())->code());
    }

    public function test_http_statuses(): void
    {
        $this->assertSame(500, (new RouteTierNotAssignedException())->httpStatus());
        $this->assertSame(404, (new UnknownLevelException())->httpStatus());
        $this->assertSame(500, (new CacheDriverException())->httpStatus());
        $this->assertSame(500, (new ClassifierException())->httpStatus());
    }
}
