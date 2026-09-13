import { z } from 'zod';
const runtimeGroupChatIdSchema = z.string().trim().regex(/^[^\s@]+@g\.us$/i).transform(value => value.toLowerCase());
export const sendGroupHistoryManualInputSchema = z.object({
    scopeId: z.string().trim().min(1),
    chatId: runtimeGroupChatIdSchema,
    recipientWids: z.array(z.string().trim().min(1)).min(1).max(10)
  }).strict();
export const sendGroupHistoryExternalActions = [{
  actionId: 'official.send-group-history.manualSend', access: 'mutation' as const, scope: 'account' as const, timeoutMs: 120_000
}];
