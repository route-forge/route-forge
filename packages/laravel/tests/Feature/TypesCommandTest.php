<?php

declare(strict_types=1);

namespace RouteForge\Laravel\Tests\Feature;

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Route as RouteFacade;
use Orchestra\Testbench\TestCase;
use RouteForge\Laravel\ForgeServiceProvider;
use Symfony\Component\Console\Output\BufferedOutput;

/**
 * route:forge:types 命令测试（对应 .docs/SPEC.md §3.2, §4.2）。
 *
 * 覆盖：
 *   - 默认 stdout 输出 d.ts（含 method/params/response）
 *   - POST/PUT/PATCH 路由带 body 字段
 *   - --level 过滤仅生成匹配层级路由
 *   - --json 输出对象格式
 *   - --out 写入文件并自动创建父目录
 *
 * 使用 Kernel::call + BufferedOutput 捕获完整输出，避免 expectsOutputToContain 的
 * 单次 doWrite 仅匹配首个子串限制；同时通过 PHP 数组传参避免命令行字符串解析
 * 对路径中反斜杠的误处理。
 */
class TypesCommandTest extends TestCase
{
    protected function getPackageProviders($app): array
    {
        return [ForgeServiceProvider::class];
    }

    protected function setUp(): void
    {
        parent::setUp();

        // GET 路由带路径参数 {id}
        RouteFacade::get('/admin/users/{id}', static function () {})
            ->name('admin.users.show')
            ->tier('admin');

        // POST 路由：应生成 body 字段
        RouteFacade::post('/admin/users', static function () {})
            ->name('admin.users.store')
            ->tier('admin');

        // client 层级路由（用于验证 --level 过滤排除）
        RouteFacade::get('/client/dashboard', static function () {})
            ->name('client.dashboard')
            ->tier('client');
    }

    /**
     * @return array{0:int,1:string}
     */
    private function runTypes(array $params = []): array
    {
        $buffer = new BufferedOutput();
        $exit = $this->app->make(Kernel::class)->call('route:forge:types', $params, $buffer);

        return [$exit, $buffer->fetch()];
    }

    public function test_default_stdout_generates_dts_with_method_params_response(): void
    {
        [$exit, $out] = $this->runTypes();

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('export interface ForgeRoutes', $out);
        $this->assertStringContainsString('// AUTO-GENERATED', $out);
        $this->assertStringContainsString("method: 'GET';", $out);
        $this->assertStringContainsString("method: 'POST';", $out);
        $this->assertStringContainsString('response: unknown;', $out);
        // GET 路由参数 {id} → id: string | number
        $this->assertStringContainsString('id: string | number;', $out);
    }

    public function test_post_route_has_body_field(): void
    {
        [$exit, $out] = $this->runTypes();

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('body: unknown;', $out);
    }

    public function test_level_filter_only_generates_matching_routes(): void
    {
        [$exit, $out] = $this->runTypes(['--level' => 'admin']);

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('admin.users.store', $out);
        $this->assertStringContainsString('admin.users.show', $out);
        $this->assertStringNotContainsString('client.dashboard', $out);
    }

    public function test_json_output_format(): void
    {
        [$exit, $out] = $this->runTypes(['--json' => true]);

        $this->assertSame(0, $exit);

        $decoded = json_decode($out, true);
        $this->assertIsArray($decoded, 'JSON 输出应为对象（键为路由名）');
        $this->assertArrayHasKey('admin.users.store', $decoded);
        $this->assertArrayHasKey('admin.users.show', $decoded);

        $store = $decoded['admin.users.store'];
        $this->assertSame('POST', $store['method']);
        $this->assertSame([], $store['params']);
        $this->assertSame('unknown', $store['body']);
        $this->assertSame('unknown', $store['response']);

        $show = $decoded['admin.users.show'];
        $this->assertSame('GET', $show['method']);
        $this->assertSame(['id'], $show['params']);
        $this->assertArrayNotHasKey('body', $show);
    }

    public function test_out_writes_file_and_creates_parent_dirs(): void
    {
        $outPath = sys_get_temp_dir() . '/forge-test/nested/dir/forge-routes.d.ts';
        @unlink($outPath);

        [$exit, $out] = $this->runTypes(['--out' => $outPath]);

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('Written to:', $out);

        $this->assertFileExists($outPath);
        $content = (string) file_get_contents($outPath);
        $this->assertStringContainsString('export interface ForgeRoutes', $content);
        $this->assertStringContainsString("method: 'POST';", $content);

        @unlink($outPath);
    }
}
