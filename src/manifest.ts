import type { PluginManifest } from '../../../platform/pluginRuntime/manifest';
import { sendGroupHistoryConfigSchema } from './config';
import { sendGroupHistoryMessages } from './messages';

export const sendGroupHistoryManifest: PluginManifest = {
  pluginId: 'official.send-group-history',
  kind: 'managed_group',
  version: '0.3.0',
  coreApiRange: '>=0.2.0',
  messageNamespace: 'official.send-group-history',
  descriptionKey: 'official.send-group-history.description',
  defaultMessages: sendGroupHistoryMessages,
  commands: [],
  eventSubscriptions: ['participant.change'],
  requiredPermissions: ['plugin.configure'],
  requiredBotCapabilities: [],
  configSchema: sendGroupHistoryConfigSchema,
  dangerousActions: [],
  backgroundJobs: [],
  cancellation: { workflows: [] },
  assistant: {
    summary: 'Automatically sends existing non-empty chat archive exports in the configured formats to new members after they join or are approved.',
    useCases: [
      'Explain whether new members will receive archived group history.',
      'Describe which participant arrival events trigger archive delivery.',
      'Summarize archive delivery readiness and duplicate suppression.'
    ],
    prerequisites: [
      'The plugin must be enabled in the target managed scope.',
      'Archive policy should include the target managed scope before members arrive.',
      'Chat archiving must already have captured retained messages for the group.',
      'The runtime must provide the scoped chat archive export helper.'
    ],
    limitations: [
      'The plugin does not replay or backfill archive data on join events.',
      'Membership requests are ignored until WhatsApp reports that the user joined or was approved.'
    ]
  }
};
