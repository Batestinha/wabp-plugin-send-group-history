import type { ServicePlugin } from '@wabs/plugin-sdk/service-plugin';
import { historyRegistration } from './subscriptions';
import { registerSendGroupHistoryExternalActions } from './externalActions';
import { registerSendGroupHistoryConsoleOperations } from './consoleOperations';
import type { HookPlugin } from '@wabs/plugin-sdk/hook-plugin';
import type { ArchiveHookPluginContext } from '@wabs/plugin-sdk/archive-hook-plugin';
import { createSendGroupHistoryHooks } from './hooks';
import { sendGroupHistoryManifest } from './manifest';

export const sendGroupHistoryPlugin: HookPlugin<ArchiveHookPluginContext> & ServicePlugin = {
  manifest: sendGroupHistoryManifest,
  registerServices: ctx => [historyRegistration(ctx)],
  registerConsoleOperations: registerSendGroupHistoryConsoleOperations,
  registerExternalActions: registerSendGroupHistoryExternalActions,
  registerHooks: createSendGroupHistoryHooks
};

export default sendGroupHistoryPlugin;
