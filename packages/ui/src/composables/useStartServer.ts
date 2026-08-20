import { useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import { useServerStore } from '@/stores/server';
import { useParamsStore } from '@/stores/params';
import { useI18nStore } from '@/stores/i18n';

export interface StartCheckResult {
  ok: boolean;
  message?: string;
  needExe?: boolean;
  needModelsDir?: boolean;
  needModel?: boolean;
}

/**
 * 统一的启动/重启前置校验与流程。
 * 原先 TopBar 与 LaunchPage 各自维护一套 canStart/canStartAsync 逻辑，容易漂移；
 * 这里收敛为一处：同步校验（引擎/模型目录/模型/端口范围）→ 失败输出错误并跨页引导 →
 * 异步校验（exe 存在性 + 端口占用）→ 启动。
 * 引擎目录配置现位于模型管理页，所有前置缺失均引导到 /models。
 */
export function useStartServer() {
  const settings = useSettingsStore();
  const server = useServerStore();
  const params = useParamsStore();
  const i18n = useI18nStore();
  const router = useRouter();

  function pushError(message: string) {
    server.pushOutput({ kind: 'error', data: `[Launcher] ${message}\n`, ts: Date.now() });
  }

  /** 同步校验项：立即返回错误信息 */
  function checkSync(): StartCheckResult {
    if (!settings.settings) return { ok: false, message: i18n.t('msg_no_exe') };
    if (!settings.settings.server_exe.trim()) {
      return { ok: false, message: i18n.t('msg_no_exe_hint'), needExe: true };
    }
    if (!settings.settings.models_dir.trim()) {
      return { ok: false, message: i18n.t('msg_no_models_dir_hint'), needModelsDir: true };
    }
    const modelPath = String(params.values.model ?? '');
    if (!modelPath.trim()) return { ok: false, message: i18n.t('msg_no_model'), needModel: true };
    // 端口范围校验
    const port = Number(params.values.port ?? 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, message: `Invalid port: ${port} (1-65535)` };
    }
    return { ok: true };
  }

  /** 异步校验项：server_exe 存在性 + 端口占用（重启时跳过端口检查） */
  async function checkAsync(opts?: { skipPortCheck?: boolean }): Promise<StartCheckResult> {
    if (!settings.settings) return { ok: false, message: i18n.t('msg_no_exe') };
    const exeExists = await window.api.system.fileExists(settings.settings.server_exe);
    if (!exeExists) {
      return { ok: false, message: `${i18n.t('msg_exe_not_found')}: ${settings.settings.server_exe}` };
    }
    // 端口占用检查：仅首次启动时执行。
    // 重启时服务正在运行，端口必然被当前 llama-server 进程占用，
    // 此时检查会误报 "Port is already in use" 导致重启永远失败；
    // 重启语义是先杀旧进程再启动，端口被自身占用属于预期情况，须跳过。
    if (!opts?.skipPortCheck) {
      const port = Number(params.values.port ?? 8080);
      const portCheck = await window.api.system.checkPort(port);
      // 防御性检查：浏览器预览/mock 环境下 checkPort 可能返回 null
      if (portCheck && portCheck.inUse) {
        return { ok: false, message: `Port ${port} is already in use` };
      }
    }
    return { ok: true };
  }

  /** 完整启动流程，返回是否成功进入启动 */
  async function start(): Promise<boolean> {
    const sync = checkSync();
    if (!sync.ok) {
      pushError(sync.message!);
      // 引擎/模型目录/模型任一缺失 → 跳转模型管理页引导配置
      if (sync.needExe || sync.needModelsDir || sync.needModel) void router.push('/models');
      return false;
    }
    const asyncCheck = await checkAsync();
    if (!asyncCheck.ok) {
      pushError(asyncCheck.message!);
      return false;
    }
    await server.start(params.snapshot(), settings.settings!);
    return true;
  }

  /** 完整重启流程，返回是否成功进入重启 */
  async function restart(): Promise<boolean> {
    const sync = checkSync();
    if (!sync.ok) {
      pushError(sync.message!);
      if (sync.needExe || sync.needModelsDir || sync.needModel) void router.push('/models');
      return false;
    }
    // 重启跳过端口占用检查：当前进程正占用目标端口，检查会误报并阻断重启
    const asyncCheck = await checkAsync({ skipPortCheck: true });
    if (!asyncCheck.ok) {
      pushError(asyncCheck.message!);
      return false;
    }
    await server.restart(params.snapshot(), settings.settings!);
    return true;
  }

  return { checkSync, checkAsync, start, restart };
}
