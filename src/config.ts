import { z } from 'zod';

export const DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT = 'Here is the archived history for this group.';

export const sendGroupHistoryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  sendOnJoin: z.boolean().default(true),
  sendOnAdd: z.boolean().default(true),
  sendOnApproval: z.boolean().default(true),
  ensureArchivePolicy: z.boolean().default(true),
  introText: z.string().default(DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT),
  dedupeTtlSeconds: z.number().int().positive().default(86_400)
}).default({});

export type SendGroupHistoryConfig = z.infer<typeof sendGroupHistoryConfigSchema>;

export function parseSendGroupHistoryConfig(value: unknown): SendGroupHistoryConfig {
  return sendGroupHistoryConfigSchema.parse(value);
}
