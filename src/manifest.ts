import type { PluginManifest } from '../../../platform/pluginRuntime/manifest';
import { sendGroupHistoryConfigSchema } from './config';
import { sendGroupHistoryMessages } from './messages';

export const sendGroupHistoryManifest: PluginManifest = {
  pluginId: 'official.send-group-history',
  kind: 'managed_group',
  version: '0.4.0',
  coreApiRange: '>=0.2.0',
  messageNamespace: 'official.send-group-history',
  descriptionKey: 'official.send-group-history.description',
  defaultMessages: sendGroupHistoryMessages,
  commands: [],
  help: {
    featureId: 'group-history',
    titleKey: 'official.send-group-history.help.feature.title',
    summaryKey: 'official.send-group-history.help.feature.summary',
    order: 110,
    aliases: ['welcome history', 'archive delivery'],
    topics: [{
      topicId: 'welcome-history',
      titleKey: 'official.send-group-history.help.delivery.title',
      summaryKey: 'official.send-group-history.help.delivery.summary',
      instructionKeys: ['official.send-group-history.help.delivery.instruction'],
      keywords: ['history', 'archive', 'new member', 'welcome'],
      availability: { invocation: 'either', permission: 'plugin.configure' }
    }]
  },
  eventSubscriptions: ['participant.change'],
  requiredPermissions: ['plugin.configure'],
  requiredBotCapabilities: [],
  configSchema: sendGroupHistoryConfigSchema,
  dangerousActions: [],
  backgroundJobs: [],
  cancellation: { workflows: [] },
  assistant: {
    summary: 'Automatically attempts configured chat archive formats independently and sends each eligible, up-to-100-MiB document to new members after they join or are approved.',
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
