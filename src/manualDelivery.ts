import { resolvePluginTemplateMentions, combineResolvedTemplate, type PluginTemplateMentionContext, type TemplateMessageMentions } from '@wabs/plugin-sdk/templates';
import type { PluginAuditLogger as AuditLogger, PluginScopedI18n as I18nService } from '@wabs/plugin-sdk/durable-plugin';
import type { PluginOperatorArchiveService } from '@wabs/plugin-sdk/operator-actions';
import type { StableIdentityAddressResolution } from '@wabs/plugin-sdk/identity';
import { isTransportFileTooLargeError } from '@wabs/plugin-sdk/transport-errors';
import { OUTBOUND_DOCUMENT_MAX_BYTES } from '@wabs/plugin-sdk/transport-limits';
import type { OutboundSendResult, TransportAdapter, TransportFile } from '@wabs/plugin-sdk/transport';
import {
  DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT,
  type SendGroupHistoryConfig
} from './config';
import {
  ARCHIVE_DOCUMENT_TOO_LARGE_REASON,
  appendSendGroupHistoryOmissionNotice,
  prepareSendGroupHistoryDocuments,
  sendGroupHistoryDocumentSetAuditMetadata,
  sendGroupHistoryOmissionAuditMetadata
} from './delivery';
import { sendableGroupHistoryMessageCount } from './systemMessages';
import { renderSendGroupHistoryIntroFragment } from './introText';

const PLUGIN_ID = 'official.send-group-history';
const DAY_MS = 24 * 60 * 60 * 1000;

export async function deliverConfiguredGroupHistoryManually(input: {
  scopeId: string;
  templateMentions?: PluginTemplateMentionContext | undefined;
  chatId: string;
  recipientWids: string[];
  config: SendGroupHistoryConfig;
  i18n: Pick<I18nService, 'translatorForIdentity'>;
  transport: Pick<TransportAdapter, 'sendDocument'>;
  chatArchiveExporter: Pick<PluginOperatorArchiveService, 'exportChat'>
    & Partial<Pick<PluginOperatorArchiveService, 'exportChatSet'>>;
  identityAddresses: { resolveStableIdentity(wid: string): Promise<StableIdentityAddressResolution> };
  audit: AuditLogger;
  now?: Date | undefined;
}): Promise<Record<string, unknown>> {
  const since = input.config.historyDays
    ? new Date((input.now ?? new Date()).getTime() - input.config.historyDays * DAY_MS)
    : undefined;
  const results = [];

  for (const requestedWid of input.recipientWids) {
    const recipient = await input.identityAddresses.resolveStableIdentity(requestedWid);
    const exportInput = (format: SendGroupHistoryConfig['formats'][number]) => ({
        scopeId: input.scopeId,
        actorWid: recipient.canonicalWid,
        chatId: input.chatId,
        format,
        ...(since ? { since } : {}),
        maxBytes: OUTBOUND_DOCUMENT_MAX_BYTES,
        overflowStrategy: 'truncate_oldest' as const
      });
    const preparation = input.chatArchiveExporter.exportChatSet
      ? await prepareSendGroupHistoryDocuments({
          formats: input.config.formats,
          maxBytes: OUTBOUND_DOCUMENT_MAX_BYTES,
          exportFormatSet: (format) => input.chatArchiveExporter.exportChatSet!(exportInput(format))
        })
      : await prepareSendGroupHistoryDocuments({
          formats: input.config.formats,
          maxBytes: OUTBOUND_DOCUMENT_MAX_BYTES,
          exportFormat: (format) => input.chatArchiveExporter.exportChat(exportInput(format))
        });
    for (const omission of preparation.omissions) {
      const omissionMetadata = sendGroupHistoryOmissionAuditMetadata(omission);
      await input.audit.record({
        scopeId: input.scopeId,
        action: omission.status === 'too_large'
          ? 'send-group-history.manual_skipped'
          : 'send-group-history.manual_failed',
        targetJson: manualTarget(input, recipient),
        metadataJson: omissionMetadata
      });
      results.push({
        requestedWid,
        deliveryChatId: recipient.deliveryChatId,
        canonicalWid: recipient.canonicalWid,
        omitted: true,
        status: omission.status,
        ...omissionMetadata
      });
    }

    const firstDocumentSet = preparation.documentSets[0];
    const firstDocument = firstDocumentSet?.documents[0];
    if (!firstDocumentSet || !firstDocument) {
      continue;
    }

    const sendableMessageCount = sendableGroupHistoryMessageCount(firstDocumentSet);
    if (sendableMessageCount === 0) {
      const reason = firstDocumentSet.messageCount === 0 ? 'empty-archive' : 'system-only-archive';
      await input.audit.record({
        scopeId: input.scopeId,
        action: 'send-group-history.manual_skipped',
        targetJson: manualTarget(input, recipient),
        metadataJson: {
          reason,
          messageCount: firstDocumentSet.messageCount,
          sendableMessageCount,
          ...(firstDocumentSet.messageTypeCounts ? { messageTypeCounts: firstDocumentSet.messageTypeCounts } : {}),
          ...(firstDocumentSet.placeholderMessageTypeCounts
            ? { placeholderMessageTypeCounts: firstDocumentSet.placeholderMessageTypeCounts }
            : {})
        }
      });
      results.push({
        requestedWid,
        deliveryChatId: recipient.deliveryChatId,
        canonicalWid: recipient.canonicalWid,
        skipped: true,
        reason
      });
      continue;
    }

    const t = await input.i18n.translatorForIdentity(recipient.identityId, input.scopeId);
    const introText = input.config.introText.trim();
    let renderedIntroText: string | undefined;
    let pendingMentions: TemplateMessageMentions = {};
    try {
      if (introText) {
        const { text, ...mentions } = combineResolvedTemplate(await resolvePluginTemplateMentions(renderSendGroupHistoryIntroFragment({
          source: introText === DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT ? t('official.send-group-history.introText') : introText,
          groupDisplayName: firstDocument.chatTitle, chatId: input.chatId
        }), { context: input.templateMentions ?? { resolveIdentityAddress: input.identityAddresses.resolveStableIdentity },
          chatId: recipient.deliveryChatId, scopeId: input.scopeId, currentGroupId: input.chatId,
          targets: { recipient: [{ identityId: recipient.identityId, wid: recipient.canonicalWid }] } }));
        renderedIntroText = text; pendingMentions = mentions;
      }
    } catch {
      await input.audit.record({
        scopeId: input.scopeId,
        action: 'send-group-history.manual_caption_skipped',
        targetJson: manualTarget(input, recipient),
        metadataJson: { reason: 'template-invalid' }
      });
    }
    const configuredText = renderedIntroText?.trim() || undefined;
    const firstDocumentText = appendSendGroupHistoryOmissionNotice(
      configuredText,
      preparation.omissions,
      t
    );

    let pendingCaption = firstDocumentText;
    for (const documentSet of preparation.documentSets) {
      for (const document of documentSet.documents) {
        const file = {
          filename: document.filename,
          mimeType: document.mimeType,
          buffer: document.buffer
        };

        try {
          const sent = await sendManualBundle(input.transport, recipient, file, pendingCaption, pendingMentions);
          pendingCaption = undefined;
          pendingMentions = {};
          await input.audit.record({
            scopeId: input.scopeId,
            action: 'send-group-history.manual_sent',
            targetJson: manualTarget(input, recipient),
            metadataJson: {
              format: document.format,
              filename: document.filename,
              sizeBytes: document.buffer.length,
              messageCount: document.messageCount,
              ...sendGroupHistoryDocumentSetAuditMetadata(documentSet, document),
              sendableMessageCount,
              ...(document.messageTypeCounts ? { messageTypeCounts: document.messageTypeCounts } : {}),
              ...(document.placeholderMessageTypeCounts
                ? { placeholderMessageTypeCounts: document.placeholderMessageTypeCounts }
                : {}),
              deliveryChatId: sent.deliveryChatId,
              ...(sent.documentSent.messageId ? { messageId: sent.documentSent.messageId } : {}),
              ...(sent.documentSent.remoteChatId ? { remoteChatId: sent.documentSent.remoteChatId } : {}),
              ...(sent.documentSent.ack !== undefined ? { ack: sent.documentSent.ack } : {})
            }
          });
          results.push({
            requestedWid,
            deliveryChatId: sent.deliveryChatId,
            canonicalWid: recipient.canonicalWid,
            format: document.format,
            filename: document.filename,
            sizeBytes: document.buffer.length,
            messageCount: document.messageCount,
            ...sendGroupHistoryDocumentSetAuditMetadata(documentSet, document),
            sendableMessageCount,
            ...(document.messageTypeCounts ? { messageTypeCounts: document.messageTypeCounts } : {}),
            ...(document.placeholderMessageTypeCounts
              ? { placeholderMessageTypeCounts: document.placeholderMessageTypeCounts }
              : {}),
            ...(sent.documentSent.messageId ? { messageId: sent.documentSent.messageId } : {}),
            ...(sent.documentSent.remoteChatId ? { remoteChatId: sent.documentSent.remoteChatId } : {}),
            ...(sent.documentSent.ack !== undefined ? { ack: sent.documentSent.ack } : {})
          });
        } catch (error) {
          const tooLarge = isTransportFileTooLargeError(error);
          const reason = tooLarge ? ARCHIVE_DOCUMENT_TOO_LARGE_REASON : errorMessage(error);
          const failureMetadata = {
            reason,
            phase: 'send',
            format: document.format,
            filename: tooLarge ? error.filename : document.filename,
            sizeBytes: tooLarge ? error.sizeBytes : document.buffer.length,
            maxBytes: tooLarge ? error.maxBytes : OUTBOUND_DOCUMENT_MAX_BYTES,
            messageCount: document.messageCount,
            ...sendGroupHistoryDocumentSetAuditMetadata(documentSet, document)
          };
          await input.audit.record({
            scopeId: input.scopeId,
            action: tooLarge ? 'send-group-history.manual_skipped' : 'send-group-history.manual_failed',
            targetJson: manualTarget(input, recipient),
            metadataJson: failureMetadata
          });
          results.push({
            requestedWid,
            deliveryChatId: recipient.deliveryChatId,
            canonicalWid: recipient.canonicalWid,
            ...(tooLarge ? { omitted: true, status: 'too_large' } : { failed: true }),
            ...failureMetadata
          });
          // Normalization permits only one document for this format; continue
          // with the next independently prepared format after a send failure.
          break;
        }
      }
    }
  }

  return {
    scopeId: input.scopeId,
    chatId: input.chatId,
    historySince: since?.toISOString() ?? null,
    formats: input.config.formats,
    results
  };
}

interface ManualBundleSendResult {
  deliveryChatId: string;
  documentSent: OutboundSendResult;
}

async function sendManualBundle(
  transport: Pick<TransportAdapter, 'sendDocument'>,
  recipient: StableIdentityAddressResolution,
  file: TransportFile,
  text: string | undefined,
  mentions: TemplateMessageMentions
): Promise<ManualBundleSendResult> {
  const caption = text?.trim() ? text : undefined;
  const documentSent = await transport.sendDocument(recipient.deliveryChatId, file, {
    waitForServerAck: true,
    ...(caption ? { caption, ...mentions } : {})
  });
  return {
    deliveryChatId: documentSent.deliveryChatId ?? recipient.deliveryChatId,
    documentSent
  };
}

function manualTarget(
  input: { scopeId: string; chatId: string },
  recipient: StableIdentityAddressResolution
): Record<string, unknown> {
  return {
    pluginId: PLUGIN_ID,
    scopeId: input.scopeId,
    chatId: input.chatId,
    identityId: recipient.identityId,
    userWid: recipient.canonicalWid,
    requestedWid: recipient.originalWid,
    deliveryChatId: recipient.deliveryChatId
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
