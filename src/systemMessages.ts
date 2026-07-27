export interface SendGroupHistoryMessageSummary {
  messageCount: number;
  messageTypeCounts?: Record<string, number> | undefined;
}

const SYSTEM_MESSAGE_TYPES = new Set([
  'call_log',
  'ciphertext',
  'debug',
  'gp2',
  'keep_in_chat',
  'keep_in_chat_message',
  'message_history_bundle',
  'multi_device_sync',
  'notification',
  'pin_in_chat',
  'pin_in_chat_message',
  'protocol',
  'protocol_message',
  'revoked',
  'sender_key_distribution',
  'sender_key_distribution_message',
  'system'
]);

export function isSendGroupHistorySystemMessageType(messageType: string): boolean {
  const normalizedType = normalizeMessageType(messageType);
  return normalizedType.endsWith('_notification') || SYSTEM_MESSAGE_TYPES.has(normalizedType);
}

export function sendableGroupHistoryMessageCount(summary: SendGroupHistoryMessageSummary): number {
  const messageCount = nonNegativeInteger(summary.messageCount);
  if (messageCount === 0) {
    return 0;
  }

  const entries = Object.entries(summary.messageTypeCounts ?? {});
  if (entries.length === 0) {
    return messageCount;
  }

  let classifiedCount = 0;
  let nonSystemCount = 0;
  for (const [messageType, rawCount] of entries) {
    const count = nonNegativeInteger(rawCount);
    classifiedCount += count;
    if (!isSendGroupHistorySystemMessageType(messageType)) {
      nonSystemCount += count;
    }
  }

  // Older or third-party exporters may provide only partial type counts. Treat
  // unclassified rows as sendable so the plugin fails open for real messages.
  return nonSystemCount + Math.max(0, messageCount - classifiedCount);
}

function normalizeMessageType(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
