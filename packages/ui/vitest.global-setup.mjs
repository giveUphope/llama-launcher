// UI 包 vitest 全局兜底：测试运行结束后强制退出进程。
//
// 背景（2026-08-31 排查结论）：vitest 2.1.x 在 Windows 上存在退出竞态——
// tinypool worker 销毁后其 IPC 管道句柄残留在主进程（诊断实测 17 个 PipeWrap），
// ui 全量运行（恰为 4 个测试文件）时恰有被引用的句柄卡住事件循环：
// 全部 48 个测试通过后进程静默不退出，turbo/pnpm 管道随之挂死（`pnpm test` 永不返回）。
// 复现矩阵：4 文件全量 7/7 挂；1~3 个文件 13/13 正常；threads/forks、顺序执行、
// 单 worker、isolate=false 均无法绕开；core 包同版本、同规模句柄残留但正常退出。
//
// 修复：globalSetup 返回的 teardown 在整个测试运行结束、process.exitCode 已确定后执行，
// setTimeout(0) 留一拍让 vitest 完成同步收尾，随后 process.exit 按既定退出码结束——
// 测试结果与退出码不变，只是不再等待已卡死的事件循环排空。
//
// 注意：仅 run 模式适用（本包 test 脚本即 `vitest run`）。若将来引入 watch 模式，
// 必须移除此兜底（否则第一轮跑完进程即退出）。若升级 vitest 大版本后挂起消失，
// 可整体删除本文件并从 vitest.config.ts 移除 globalSetup 引用。
export default function globalSetup() {
  return () => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 0);
  };
}
