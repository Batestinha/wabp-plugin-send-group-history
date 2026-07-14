import { defineControl } from '../../../platform/operatorConsole/controlCatalog/define';
import type { ControlDescriptor, ControlSchemaMetadata, ControlUiHint } from '../../../platform/operatorConsole/controlCatalog/types';

function control(
  path: string,
  label: string,
  description: string,
  order: number,
  schema: ControlSchemaMetadata,
  ui: ControlUiHint,
  defaultValue?: unknown
): ControlDescriptor {
  return defineControl({
    id: `plugin.official.send-group-history.${path}`,
    label,
    description,
    plane: 'plugin-scope-config',
    domain: 'official-plugin-settings',
    section: 'Send Group History',
    order,
    visibility: 'bot_admin',
    configurable: true,
    storage: { kind: 'plugin-scope-config', pluginId: 'official.send-group-history', path },
    schema,
    ui: { helpText: description, ...ui },
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    restartRequirement: 'NO_RESTART',
    dangerous: false,
    sensitivity: { sensitive: false, redact: 'none' },
    auditAction: 'operator_console.plugin_config.update',
    relatedCommandIds: [],
    relatedActionIds: []
  });
}

export const sendGroupHistoryControls: ControlDescriptor[] = [
  control('enabled', 'Enabled', 'Send existing archived group history to new members.', 10, { type: 'boolean' }, {
    widget: 'builder',
    builderId: 'official.send-group-history.prepare-history.v1',
    builderEndpoints: {
      state: '/api/v1/plugins/official.send-group-history/:scopeId/preparation',
      ensurePolicy: '/api/v1/operator-console/actions/official.send-group-history.ensureArchivePolicy',
      replay: '/api/v1/operator-console/actions/chatArchive.replayNow'
    }
  }, false),
  control('sendOnJoin', 'Direct joins', 'Send history when WhatsApp reports a direct join.', 20, { type: 'boolean' }, { widget: 'toggle' }, true),
  control('sendOnAdd', 'Admin-added members', 'Send history when a member is added by an admin.', 30, { type: 'boolean' }, { widget: 'toggle' }, true),
  control('sendOnApproval', 'Approved requests', 'Send history after an admin approves a membership request.', 40, { type: 'boolean' }, { widget: 'toggle' }, true),
  control('ensureArchivePolicy', 'Ensure archive policy', 'When preparing or enabling this plugin, include this scope in future chat archive capture when needed.', 50, { type: 'boolean' }, { widget: 'toggle' }, true),
  control('exemptGroupChatIds', 'Exempt groups', 'Managed groups in this affected scope that should not receive automatic history delivery.', 56, { type: 'array', items: { type: 'string' } }, {
    widget: 'builder',
    builderId: 'official.send-group-history.prepare-history.v1'
  }, []),
  control('historyDays', 'History days', 'Number of days of archived history to send. Blank sends all available history.', 57, { type: 'number', unit: 'days', min: 1, max: 3650 }, {
    widget: 'builder',
    builderId: 'official.send-group-history.prepare-history.v1'
  }, null),
  control('introText', 'PDF caption', 'Caption sent with the archive document. Leave blank to send only the document file.', 60, { type: 'string' }, {
    widget: 'builder',
    builderId: 'official.send-group-history.prepare-history.v1'
  }),
  control(
    'dedupeTtlSeconds',
    'Dedupe TTL',
    'Seconds to suppress duplicate delivery for the same scope, group, and user.',
    70,
    { type: 'number', unit: 'seconds', min: 1, max: 2_592_000 },
    { widget: 'duration' },
    86_400
  )
];
