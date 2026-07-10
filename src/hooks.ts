import type { PluginAction } from '../../../platform/pluginRuntime/runtime/pluginActionTypes';
import type { PluginRuntimeContext } from '../../../platform/pluginRuntime/runtime/pluginRuntimeContext';
import type { PluginParticipantChangeEvent, PluginRuntimeHooks } from '../../../platform/pluginRuntime/types';
import {
  DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT,
  parseSendGroupHistoryConfig,
  type SendGroupHistoryConfig
} from './config';

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
      for (const userWid of event.affectedWids) {
        if (botRecipients.has(userWid)) {
          actions.push(auditSkipped(event, userWid, 'self-recipient'));
          continue;
        }

        const dedupeKey = deliveryDedupeKey(event, userWid);
        const deliveryAttempt = await context.ephemeralStore.increment(dedupeKey, config.dedupeTtlSeconds);
        if (deliveryAttempt !== 1) {
          actions.push(auditSkipped(event, userWid, 'duplicate-event'));
          continue;
        }

        try {
          const document = await context.exportChatArchive({
            scopeId: event.scopeId,
            actorWid: userWid,
            chatId: event.chatId,
            format: 'pdf',
            ...(since ? { since } : {}),
            skipAuthorization: true
          });

          if (document.messageCount === 0) {
            actions.push(auditSkipped(event, userWid, 'empty-archive', {
              messageCount: document.messageCount,
              recommendation: 'prepare-history'
            }));
            continue;
          }

          const introText = config.introText.trim();
          if (introText.length > 0) {
            const t = await context.i18n.translatorForIdentity(userWid, event.scopeId);
            const text = introText === DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT
              ? t('official.send-group-history.introText')
              : introText;
            actions.push({
              type: 'message.sendText',
              chatId: userWid,
              text: renderIntroText(text, event)
            });
          }
          actions.push({
            type: 'message.sendDocument',
            chatId: userWid,
            file: {
              filename: document.filename,
              mimeType: document.mimeType,
              buffer: document.buffer
            }
          });
          actions.push({
            type: 'audit.record',
            action: 'send-group-history.sent',
            targetJson: target(event, userWid),
            metadataJson: {
              filename: document.filename,
              sizeBytes: document.buffer.length,
              messageCount: document.messageCount
            }
          });
        } catch (error) {
          await context.ephemeralStore.delete(dedupeKey);
          actions.push({
            type: 'audit.record',
            action: 'send-group-history.failed',
            targetJson: target(event, userWid),
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

function deliveryDedupeKey(event: PluginParticipantChangeEvent, userWid: string): string {
  return `delivery:${event.chatId}:${userWid}`;
}

function botRecipientWids(event: PluginParticipantChangeEvent): Set<string> {
  return new Set([
    ...(event.botWid ? [event.botWid] : []),
    ...(event.botWids ?? [])
  ].map((wid) => wid.trim()).filter(Boolean));
}

function auditSkipped(
  event: PluginParticipantChangeEvent,
  userWid: string | undefined,
  reason: string,
  metadata: Record<string, unknown> = {}
): PluginAction {
  return {
    type: 'audit.record',
    action: 'send-group-history.skipped',
    targetJson: target(event, userWid),
    metadataJson: { reason, ...metadata }
  };
}

function target(event: PluginParticipantChangeEvent, userWid: string | undefined): Record<string, unknown> {
  return {
    pluginId,
    scopeId: event.scopeId,
    chatId: event.chatId,
    eventId: event.eventId,
    participantAction: event.action,
    ...(userWid ? { userWid } : {})
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
