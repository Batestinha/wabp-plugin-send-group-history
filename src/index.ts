import type { HookPlugin } from '../../../../packages/plugin-sdk/src/hook-plugin';
import type { ArchiveHookPluginContext } from '../../../../packages/plugin-sdk/src/archive-hook-plugin';
import { createSendGroupHistoryHooks } from './hooks';
import { sendGroupHistoryManifest } from './manifest';

export const sendGroupHistoryPlugin: HookPlugin<ArchiveHookPluginContext> = {
  manifest: sendGroupHistoryManifest,
  registerHooks: createSendGroupHistoryHooks
};

export default sendGroupHistoryPlugin;
