import { z } from 'zod';
import type { PluginConsoleContext, PluginConsoleArchive, PluginConsoleOperationRegistration } from '@wabs/plugin-sdk/console-operations';
import { OUTBOUND_DOCUMENT_MAX_BYTES } from '@wabs/plugin-sdk/transport-limits';
import { isChatArchiveExportTooLargeError, type ChatArchiveExportCoverage } from '@wabs/plugin-sdk/chat-archive';
import type { ChatArchivePolicy } from '@wabs/plugin-sdk/archive-policy';
import { SEND_GROUP_HISTORY_EXPORT_FORMATS, parseSendGroupHistoryConfig } from './config';
import { normalizeSendGroupHistoryDocumentSet } from './delivery';
import { sendableGroupHistoryMessageCount } from './systemMessages';

const selectedRuntimeSchema = z.object({ runtimeBindingId: z.preprocess(firstQueryValue, z.string().trim().min(1)) });
const groupChatIdSchema = z.string().trim().regex(/^[^\s@]+@g\.us$/i).transform(value => value.toLowerCase());
const SEND_GROUP_HISTORY_PLUGIN_ID = 'official.send-group-history';
const SEND_GROUP_HISTORY_DAY_MS = 24 * 60 * 60 * 1000;
const sendGroupHistoryScopeParamsSchema = z.object({
  scopeId: z.string().trim().min(1)
});
const sendGroupHistoryScopeContextSchema = sendGroupHistoryScopeParamsSchema.merge(selectedRuntimeSchema);
const sendGroupHistoryPreflightInputSchema = sendGroupHistoryScopeContextSchema.extend({
  chatId: groupChatIdSchema,
  formats: z.array(z.enum(SEND_GROUP_HISTORY_EXPORT_FORMATS)).min(1)
    .transform((formats) => [...new Set(formats)]),
  historyDays: z.number().int().positive().max(3650).nullable()
}).strict();

export class SendGroupHistoryConsoleOperations {
  private readonly archive: PluginConsoleArchive;
  constructor(private readonly host: PluginConsoleContext) {
    if (!host.archive) throw new Error('The host does not provide console archive capabilities.');
    this.archive = host.archive;
  }

  private assertRuntime(runtimeBindingId: string): void {
    if (runtimeBindingId !== this.host.runtimeBindingId) throw httpError(403, 'Console runtime does not match its host context.');
  }

  async sendGroupHistoryPreparationState(input: unknown = {}) {
    const parsed = sendGroupHistoryScopeContextSchema.parse(input ?? {});
    this.assertRuntime(parsed.runtimeBindingId);
    const database = await this.archive.status();
    if (!database.ok) {
      return { pluginId: SEND_GROUP_HISTORY_PLUGIN_ID, scopeId: parsed.scopeId, enabled: false, ensureArchivePolicy: true,
        archivePolicy: { active: false, source: 'database-unavailable' }, maxDocumentBytes: OUTBOUND_DOCUMENT_MAX_BYTES,
        groups: [], warnings: ['Archive database is unavailable.'], database };
    }
    const config = parseSendGroupHistoryConfig(await this.host.configuration.resolve(parsed.scopeId));
    const policy = await this.archive.policy();
    const policyStatus = archivePolicyStatus(policy, await this.host.scopes.lineage(parsed.scopeId));
    const historySince = sendGroupHistorySince(config.historyDays);
    const groups = (await this.archive.groups(parsed.scopeId, historySince)).map(({ deliverySummary, ...group }) => {
      const deliveryMessageCount = sendableGroupHistoryMessageCount(deliverySummary);
      return { ...group, deliveryMessageCount, deliveryMessageTypeCounts: deliverySummary.messageTypeCounts,
        deliveryPlaceholderMessageTypeCounts: deliverySummary.placeholderMessageTypeCounts, empty: deliveryMessageCount === 0 };
    });
    return { pluginId: SEND_GROUP_HISTORY_PLUGIN_ID, scopeId: parsed.scopeId,
      enabled: await this.host.configuration.enabled(parsed.scopeId), ensureArchivePolicy: config.ensureArchivePolicy,
      formats: config.formats, historyDays: config.historyDays, historySince: historySince?.toISOString() ?? null,
      maxDocumentBytes: OUTBOUND_DOCUMENT_MAX_BYTES, archivePolicy: policyStatus, groups,
      warnings: archiveHistoryPreparationWarnings(policyStatus.active === true, groups), database };
  }

  async sendGroupHistoryExportPreflight(input: unknown = {}) {
    const parsed = sendGroupHistoryPreflightInputSchema.parse(input ?? {});
    this.assertRuntime(parsed.runtimeBindingId);
    const database = await this.archive.status();
    if (!database.ok) {
      throw httpError(503, 'Archive database is unavailable.');
    }

    const group = await this.archive.group(parsed.scopeId, parsed.chatId);
    if (!group) {
      throw httpError(404, `Managed group ${parsed.chatId} is not covered by scope ${parsed.scopeId}.`);
    }

    const historySince = sendGroupHistorySince(parsed.historyDays);
    const results = [];
    for (const format of parsed.formats) {
      try {
        const documentSet = normalizeSendGroupHistoryDocumentSet(
          format,
          await this.archive.exportChatSet({
            scopeId: parsed.scopeId,
            chatId: parsed.chatId,
            format,
            ...(historySince ? { since: historySince } : {}),
            maxBytes: OUTBOUND_DOCUMENT_MAX_BYTES,
            overflowStrategy: 'truncate_oldest',
          })
        );
        const aggregateBytes = documentSet.documents.reduce((sum, document) => sum + document.buffer.length, 0);
        const largestDocumentBytes = documentSet.documents.reduce(
          (largest, document) => Math.max(largest, document.buffer.length),
          0
        );
        const oversizedDocument = documentSet.documents.find(
          (document) => document.buffer.length > OUTBOUND_DOCUMENT_MAX_BYTES
        );
        if (oversizedDocument) {
          results.push({
            status: 'too_large',
            reason: 'archive-document-too-large',
            phase: 'preflight',
            format: documentSet.format,
            filename: oversizedDocument.filename,
            sizeBytes: largestDocumentBytes,
            aggregateBytes,
            largestDocumentBytes,
            documentCount: documentSet.documents.length,
            maxBytes: OUTBOUND_DOCUMENT_MAX_BYTES,
            messageCount: documentSet.messageCount
          });
          continue;
        }
        const firstDocument = documentSet.documents[0];
        const coverage = documentSet.coverage ?? firstDocument?.coverage;
        results.push({
          status: 'ready',
          format: documentSet.format,
          filename: documentSet.documents.length === 1 ? firstDocument?.filename ?? null : null,
          sizeBytes: largestDocumentBytes,
          aggregateBytes,
          largestDocumentBytes,
          documentCount: documentSet.documents.length,
          maxBytes: OUTBOUND_DOCUMENT_MAX_BYTES,
          messageCount: documentSet.messageCount,
          ...(coverage ? { coverage: sendGroupHistoryCoverageResult(coverage) } : {})
        });
      } catch (error) {
        if (isChatArchiveExportTooLargeError(error)) {
          results.push({
            status: 'too_large',
            reason: 'archive-document-too-large',
            phase: 'preflight',
            format: error.format,
            filename: error.filename,
            sizeBytes: error.sizeBytes,
            aggregateBytes: null,
            largestDocumentBytes: error.sizeBytes,
            documentCount: null,
            maxBytes: error.maxBytes,
            messageCount: error.messageCount
          });
          continue;
        }
        results.push({
          status: 'failed',
          phase: 'export',
          format,
          filename: null,
          sizeBytes: null,
          aggregateBytes: null,
          largestDocumentBytes: null,
          documentCount: null,
          maxBytes: OUTBOUND_DOCUMENT_MAX_BYTES,
          messageCount: null,
          reason: errorMessageText(error)
        });
      }
    }

    return {
      pluginId: SEND_GROUP_HISTORY_PLUGIN_ID,
      scopeId: parsed.scopeId,
      chatId: parsed.chatId,
      displayName: group.displayName,
      historyDays: parsed.historyDays,
      historySince: historySince?.toISOString() ?? null,
      maxDocumentBytes: OUTBOUND_DOCUMENT_MAX_BYTES,
      results
    };
  }

  async ensureSendGroupHistoryPolicy(input: unknown = {}) {
    const parsed = sendGroupHistoryScopeContextSchema.parse(input ?? {});
    this.assertRuntime(parsed.runtimeBindingId);
    const { changed, previous, policy } = await this.archive.ensureScopeCapture(parsed.scopeId);
    const archivePolicy = archivePolicyStatus(policy, await this.host.scopes.lineage(parsed.scopeId));
    if (changed) await this.host.audit('official.send-group-history.policy-ensured', {
      scopeId: parsed.scopeId, runtimeBindingId: parsed.runtimeBindingId
    }, { pluginId: SEND_GROUP_HISTORY_PLUGIN_ID, scopeId: parsed.scopeId, runtimeBindingId: parsed.runtimeBindingId,
      previousScopeIds: previous.scopeIds ?? [], nextScopeIds: policy.scopeIds ?? [] });
    return { changed, restartRequirement: 'no restart', archivePolicy, policy };
  }

  async scopeEnabled(input: unknown = {}) {
    const parsed = sendGroupHistoryScopeContextSchema.parse(input ?? {});
    this.assertRuntime(parsed.runtimeBindingId);
    const config = parseSendGroupHistoryConfig(await this.host.configuration.resolve(parsed.scopeId));
    const archivePolicy = config.ensureArchivePolicy ? await this.ensureSendGroupHistoryPolicy(parsed) : undefined;
    return { ...(archivePolicy ? { archivePolicy } : {}),
      archiveHistoryPreparation: await this.sendGroupHistoryPreparationState(parsed) };
  }
}

export function registerSendGroupHistoryConsoleOperations(context: PluginConsoleContext): PluginConsoleOperationRegistration[] {
  const operations = new SendGroupHistoryConsoleOperations(context);
  return [
    { operationId: 'official.send-group-history.sendGroupHistoryPreparationState', handler: input => operations.sendGroupHistoryPreparationState(input) },
    { operationId: 'official.send-group-history.sendGroupHistoryExportPreflight', handler: input => operations.sendGroupHistoryExportPreflight(input) },
    { operationId: 'official.send-group-history.ensureSendGroupHistoryPolicy', handler: input => operations.ensureSendGroupHistoryPolicy(input) },
    { operationId: 'official.send-group-history.scopeEnabled', handler: input => operations.scopeEnabled(input) }
  ];
}

function firstQueryValue(value: unknown): unknown { return Array.isArray(value) ? value[0] : value; }
function httpError(statusCode: number, message: string): Error { return Object.assign(new Error(message), { statusCode }); }
function errorMessageText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function uniqueStrings(values: string[]): string[] { return [...new Set(values)].sort((left, right) => left.localeCompare(right)); }

function archivePolicyStatus(policy: ChatArchivePolicy, scopeLineageIds: string[]): Record<string, unknown> {
  if (policy.archiveAllManagedGroups !== false) {
    return {
      active: true,
      source: 'archiveAllManagedGroups',
      retentionDays: policy.retentionDays ?? null,
      configuredScopeIds: policy.scopeIds ?? [],
      matchedScopeIds: []
    };
  }
  const configuredScopeIds = uniqueStrings((policy.scopeIds ?? []).map((scopeId) => scopeId.trim()).filter(Boolean));
  const matchedScopeIds = scopeLineageIds.filter((scopeId) => configuredScopeIds.includes(scopeId));
  return {
    active: matchedScopeIds.length > 0,
    source: matchedScopeIds.length > 0 ? 'scopeIds' : 'inactive',
    retentionDays: policy.retentionDays ?? null,
    configuredScopeIds,
    matchedScopeIds
  };
}

function sendGroupHistorySince(historyDays: number | null): Date | undefined {
  return historyDays ? new Date(Date.now() - historyDays * SEND_GROUP_HISTORY_DAY_MS) : undefined;
}

function sendGroupHistoryCoverageResult(coverage: ChatArchiveExportCoverage) {
  return {
    completeness: coverage.completeness,
    totalMessageCount: coverage.totalMessageCount,
    includedMessageCount: coverage.includedMessageCount,
    omittedMessageCount: coverage.omittedMessageCount,
    includedRange: coverage.includedRange ? {
      firstMessageAt: coverage.includedRange.firstMessageAt.toISOString(),
      lastMessageAt: coverage.includedRange.lastMessageAt.toISOString()
    } : null,
    omittedRange: coverage.omittedRange ? {
      firstMessageAt: coverage.omittedRange.firstMessageAt.toISOString(),
      lastMessageAt: coverage.omittedRange.lastMessageAt.toISOString()
    } : null,
    overflowStrategy: coverage.overflowStrategy
  };
}

function archiveHistoryPreparationWarnings(
  archivePolicyActive: boolean,
  groups: Array<{
    empty: boolean;
    exportError?: string | undefined;
  }>
): string[] {
  const warnings: string[] = [];
  if (!archivePolicyActive) {
    warnings.push('Archive policy is inactive for this scope.');
  }
  if (groups.length === 0) {
    warnings.push('No enrolled managed groups resolve to this scope.');
  }
  if (groups.some((group) => group.empty)) {
    warnings.push('One or more groups have no retained archive messages.');
  }
  if (groups.some((group) => group.exportError)) {
    warnings.push('One or more PDF export estimates could not be generated.');
  }
  return warnings;
}
