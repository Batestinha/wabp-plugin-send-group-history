import type { PluginAction } from '../../../platform/pluginRuntime/runtime/pluginActionTypes';
import type { PluginRuntimeContext } from '../../../platform/pluginRuntime/runtime/pluginRuntimeContext';
import type { PluginParticipantChangeEvent, PluginRuntimeHooks } from '../../../platform/pluginRuntime/types';
import type { PrivateRecipientResolution } from '../../../platform/identity/privateRecipientResolver';
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
      const config = parseSendGroupHistoryConfig(await context.configFor(event.scopeId, event.actorWid));
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
      const botRecipients = botRecipientWids(event);
      for (const eventUserWid of event.affectedWids) {
        const recipient = await resolveRecipient(context, eventUserWid);
        if (recipient.aliases.some((alias) => botRecipients.has(alias))) {
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
                  ? (await context.i18n.translatorForIdentity(recipient.canonicalWid, event.scopeId))('official.send-group-history.introText')
                  : introText,
                event
              )
            : undefined;
          actions.push(...documents.map((document, index): PluginAction => ({
            type: 'message.sendTextAndDocument',
            chatId: recipient.chatId,
            ...(index === 0 && text ? { text } : {}),
            file: {
              filename: document.filename,
              mimeType: document.mimeType,
              buffer: document.buffer
            },
            privateDeliveryFallback: {
              chatId: event.chatId,
              mentionedWids: [preferredMentionWid(recipient)]
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

async function resolveRecipient(
  context: PluginRuntimeContext,
  userWid: string
): Promise<PrivateRecipientResolution> {
  return context.resolvePrivateRecipient?.(userWid) ?? unresolvedRecipient(userWid);
}

function unresolvedRecipient(userWid: string): PrivateRecipientResolution {
  return {
    originalWid: userWid,
    chatId: userWid,
    deliveryChatIds: userWid ? [userWid] : [],
    canonicalWid: userWid,
    aliases: userWid ? [userWid] : [],
    dedupeKey: `wid:${userWid}`
  };
}

function deliveryDedupeKey(event: PluginParticipantChangeEvent, recipient: PrivateRecipientResolution): string {
  return `delivery:${event.chatId}:${recipient.dedupeKey}`;
}

function botRecipientWids(event: PluginParticipantChangeEvent): Set<string> {
  return new Set([
    ...(event.botWid ? [event.botWid] : []),
    ...(event.botWids ?? [])
  ].map((wid) => wid.trim()).filter(Boolean));
}

function preferredMentionWid(recipient: PrivateRecipientResolution): string {
  return recipient.deliveryChatIds.find((wid) => wid.endsWith('@c.us')) ??
    recipient.deliveryChatIds.find((wid) => wid.endsWith('@lid')) ??
    recipient.canonicalWid;
}

function auditSkipped(
  event: PluginParticipantChangeEvent,
  recipient: PrivateRecipientResolution | undefined,
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

function target(event: PluginParticipantChangeEvent, recipient: PrivateRecipientResolution | undefined): Record<string, unknown> {
  return {
    pluginId,
    scopeId: event.scopeId,
    chatId: event.chatId,
    eventId: event.eventId,
    participantAction: event.action,
    ...(recipient ? {
      userWid: recipient.canonicalWid,
      eventUserWid: recipient.originalWid,
      deliveryChatId: recipient.chatId,
      deliveryChatIds: recipient.deliveryChatIds,
      aliases: recipient.aliases
    } : {})
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
