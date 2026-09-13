import type { PluginConsoleOperationDeclaration } from '@wabs/plugin-sdk/console-operations';

export const historyConsoleOperationDeclarations: PluginConsoleOperationDeclaration[] = [
  { operationId: 'official.send-group-history.sendGroupHistoryPreparationState', access: 'read', authorization: 'operator', description: 'Inspect archive delivery readiness' },
  { operationId: 'official.send-group-history.sendGroupHistoryExportPreflight', access: 'read', authorization: 'operator', description: 'Check archive document sizes and coverage' },
  { operationId: 'official.send-group-history.ensureSendGroupHistoryPolicy', access: 'mutation', authorization: 'operator', description: 'Enable archive capture for this scope' },
  { operationId: 'official.send-group-history.scopeEnabled', access: 'mutation', authorization: 'operator', description: 'Prepare archive capture when enabling the plugin' }
];
