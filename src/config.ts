import { z } from 'zod';

export const DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT = 'Here is the archived history for this group.';
const INTRO_TEXT_TOKENS = new Set(['groupDisplayName']);

export const sendGroupHistoryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  sendOnJoin: z.boolean().default(true),
  sendOnAdd: z.boolean().default(true),
  sendOnApproval: z.boolean().default(true),
  ensureArchivePolicy: z.boolean().default(true),
  introText: z.string().superRefine((template, ctx) => {
    for (const match of template.matchAll(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g)) {
      const token = match[1] ?? '';
      if (!INTRO_TEXT_TOKENS.has(token)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown template variable {${token}}`
        });
      }
    }
  }).default(DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT),
  exemptGroupChatIds: z.array(z.string().trim().min(1)).default([]),
  historyDays: z.number().int().positive().nullable().default(null),
  dedupeTtlSeconds: z.number().int().positive().default(86_400)
}).default({});

export type SendGroupHistoryConfig = z.infer<typeof sendGroupHistoryConfigSchema>;

export function parseSendGroupHistoryConfig(value: unknown): SendGroupHistoryConfig {
  return sendGroupHistoryConfigSchema.parse(value);
}
