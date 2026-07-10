import type { BotPlugin } from '../../../platform/pluginRuntime/types';
import { createSendGroupHistoryHooks } from './hooks';
import { sendGroupHistoryManifest } from './manifest';

export const sendGroupHistoryPlugin: BotPlugin = {
  manifest: sendGroupHistoryManifest,
  registerHooks: createSendGroupHistoryHooks
};

export default sendGroupHistoryPlugin;
