import type { PluginAction } from '../../../platform/pluginRuntime/runtime/pluginActionTypes';
import type { PluginRuntimeContext } from '../../../platform/pluginRuntime/runtime/pluginRuntimeContext';
import type {
  PluginParticipantChangeEvent,
  PluginParticipantIdentity,
  PluginRuntimeHooks
} from '../../../platform/pluginRuntime/types';
import {
  DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT,
  parseSendGroupHistoryConfig,
  type SendGroupHistoryConfig
} from './config';
import { sendableGroupHistoryMessageCount } from './systemMessages';

const pluginId = 'official.send-group-history';
const DAY_MS = 24 * 60 * 60 * 1000;

export function createSendGroupHistoryHooks(context: PluginRuntimeContext): PluginRuntimeHooks {
  return {
    async onParticipantChange(event) {
      const config = parseSendGroupHistoryConfig(await context.configFor(
        event.scopeId,
        event.actorIdentity?.identityId
      ));
      if (!config.enabled || !shouldSendForEvent(event, config)) {
        return;
      }

      if (exemptGroupChatIds(config).has(event.chatId)) {
        return [auditSkipped(event, undefined, 'exempt-group')];
      }

      if (!context.exportChatArchive) {
        return [auditSkipped(event, undefined, 'missing-runtime-api')];
      }

      const actions: PluginAction[] = [];
      const since = historySince(event, config);
      const botIdentityIds = new Set(event.botIdentityIds);
      for (const recipient of event.affectedIdentities) {
        if (botIdentityIds.has(recipient.identityId)) {
          actions.push(auditSkipped(event, recipient, 'self-recipient'));
          continue;
        }

        const dedupeKey = deliveryDedupeKey(event, recipient);
        const deliveryAttempt = await context.ephemeralStore.increment(dedupeKey, config.dedupeTtlSeconds);
        if (deliveryAttempt !== 1) {
          actions.push(auditSkipped(event, recipient, 'duplicate-event'));
          continue;
        }

        try {
          const firstFormat = config.formats[0] ?? 'pdf';
          const remainingFormats = config.formats.slice(1);
          const firstDocument = await context.exportChatArchive({
            scopeId: event.scopeId,
            actorWid: recipient.canonicalWid,
            chatId: event.chatId,
            format: firstFormat,
            ...(since ? { since } : {}),
            skipAuthorization: true
          });

          const sendableMessageCount = sendableGroupHistoryMessageCount(firstDocument);
          if (sendableMessageCount === 0) {
            const reason = firstDocument.messageCount === 0 ? 'empty-archive' : 'system-only-archive';
            actions.push(auditSkipped(event, recipient, reason, {
              messageCount: firstDocument.messageCount,
              sendableMessageCount,
              ...(firstDocument.messageTypeCounts ? { messageTypeCounts: firstDocument.messageTypeCounts } : {}),
              ...(firstDocument.placeholderMessageTypeCounts
                ? { placeholderMessageTypeCounts: firstDocument.placeholderMessageTypeCounts }
                : {}),
              recommendation: 'prepare-history'
            }));
            continue;
          }

          const remainingDocuments = await Promise.all(remainingFormats.map((format) => context.exportChatArchive!({
            scopeId: event.scopeId,
            actorWid: recipient.canonicalWid,
            chatId: event.chatId,
            format,
            ...(since ? { since } : {}),
            skipAuthorization: true
          })));
          const documents = [firstDocument, ...remainingDocuments];
          const introText = config.introText.trim();
          const text = introText.length > 0
            ? renderIntroText(
                introText === DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT
                  ? (await context.i18n.translatorForIdentity(recipient.identityId, event.scopeId))('official.send-group-history.introText')
                  : introText,
                event
              )
            : undefined;
          actions.push(...documents.map((document, index): PluginAction => ({
            type: 'message.sendTextAndDocument',
            chatId: recipient.deliveryChatId,
            requiredRemoteChatId: recipient.deliveryChatId,
            ...(index === 0 && text ? { text } : {}),
            file: {
              filename: document.filename,
              mimeType: document.mimeType,
              buffer: document.buffer
            },
            successAudit: {
              action: 'send-group-history.sent',
              targetJson: target(event, recipient),
              metadataJson: {
                format: document.format,
                filename: document.filename,
                sizeBytes: document.buffer.length,
                messageCount: document.messageCount,
                sendableMessageCount,
                ...(document.messageTypeCounts ? { messageTypeCounts: document.messageTypeCounts } : {}),
                ...(document.placeholderMessageTypeCounts
                  ? { placeholderMessageTypeCounts: document.placeholderMessageTypeCounts }
                  : {})
              }
            },
            failureAudit: {
              action: 'send-group-history.failed',
              targetJson: target(event, recipient),
              metadataJson: { format: document.format }
            }
          })));
        } catch (error) {
          await context.ephemeralStore.delete(dedupeKey);
          actions.push({
            type: 'audit.record',
            action: 'send-group-history.failed',
            targetJson: target(event, recipient),
            metadataJson: { reason: errorMessage(error) }
          });
        }
      }

      return actions;
    }
  };
}

function exemptGroupChatIds(config: SendGroupHistoryConfig): Set<string> {
  return new Set(config.exemptGroupChatIds.map((chatId) => chatId.trim()).filter(Boolean));
}

function historySince(event: PluginParticipantChangeEvent, config: SendGroupHistoryConfig): Date | undefined {
  if (!config.historyDays) {
    return undefined;
  }
  return new Date(event.receivedAt.getTime() - config.historyDays * DAY_MS);
}

function renderIntroText(text: string, event: PluginParticipantChangeEvent): string {
  const groupDisplayName = event.groupDisplayName?.trim() || event.chatId;
  return text.replace(/\{groupDisplayName\}/g, groupDisplayName);
}

function shouldSendForEvent(event: PluginParticipantChangeEvent, config: SendGroupHistoryConfig): boolean {
  if (event.action === 'join') {
    return config.sendOnJoin;
  }
  if (event.action === 'add') {
    return config.sendOnAdd;
  }
  if (event.action === 'membership_approved') {
    return config.sendOnApproval;
  }
  return false;
}

function deliveryDedupeKey(event: PluginParticipantChangeEvent, recipient: PluginParticipantIdentity): string {
  return `delivery:${event.chatId}:identity:${recipient.identityId}`;
}

function auditSkipped(
  event: PluginParticipantChangeEvent,
  recipient: PluginParticipantIdentity | undefined,
  reason: string,
  metadata: Record<string, unknown> = {}
): PluginAction {
  return {
    type: 'audit.record',
    action: 'send-group-history.skipped',
    targetJson: target(event, recipient),
    metadataJson: { reason, ...metadata }
  };
}

function target(event: PluginParticipantChangeEvent, recipient: PluginParticipantIdentity | undefined): Record<string, unknown> {
  return {
    pluginId,
    scopeId: event.scopeId,
    chatId: event.chatId,
    eventId: event.eventId,
    participantAction: event.action,
    ...(recipient ? {
      identityId: recipient.identityId,
      userWid: recipient.canonicalWid,
      sourceWid: recipient.sourceWid,
      deliveryChatId: recipient.deliveryChatId
    } : {})
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
