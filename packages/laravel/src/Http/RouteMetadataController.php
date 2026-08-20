<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Http;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use RouteForge\Laravel\Exceptions\ForgeExceptionContract;
use RouteForge\Laravel\RouteRepository;

/**
 * 元信息查询端点控制器：GET /{endpoint_prefix}/{level} 与 GET /{endpoint_prefix}
 *
 * @see .docs/SPEC.md §3.1.5, §3.1.6, §6.1
 */
class RouteMetadataController extends Controller
{
    public function __construct(private readonly RouteRepository $repository)
    {
    }

    /**
     * 返回指定层级下所有命名路由的元信息。
     *
     * 异常映射（§6.1）：
     *   - UnknownLevelException (RF_BE_002)         → 404
     *   - RouteTierNotAssignedException (RF_BE_001) → 500
     *   - CacheDriverException (RF_BE_003)          → 500
     *   - ClassifierException (RF_BE_004)            → 500
     */
    public function show(Request $request, string $level): JsonResponse
    {
        try {
            $payload = $this->repository->getRoutesByLevel($level);
        } catch (ForgeExceptionContract $e) {
            return new JsonResponse(
                [
                    'error' => [
                        'code' => $e->code(),
                        'message' => $e->getMessage(),
                        'level' => $level,
                    ],
                ],
                $e->httpStatus(),
            );
        }

        return new JsonResponse($payload);
    }

    /**
     * 摘要端点：GET /{endpoint_prefix}
     *
     * 返回所有层级概览、全局配置、未分配路由列表（SPEC §3.1.6）。
     *
     * 异常映射（§6.1）：
     *   - CacheDriverException (RF_BE_003) → 500
     *   - ClassifierException (RF_BE_004) → 500
     */
    public function index(Request $request): JsonResponse
    {
        try {
            $payload = $this->repository->getSummary();
        } catch (ForgeExceptionContract $e) {
            return new JsonResponse(
                [
                    'error' => [
                        'code' => $e->code(),
                        'message' => $e->getMessage(),
                    ],
                ],
                $e->httpStatus(),
            );
        }

        return new JsonResponse($payload);
    }
}
