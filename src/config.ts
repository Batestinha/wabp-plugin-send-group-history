import { z } from 'zod';

export const DEFAULT_ARCHIVE_HISTORY_INTRO_TEXT = 'Here is the archived history for this group.';
export const SEND_GROUP_HISTORY_EXPORT_FORMATS = ['pdf', 'html', 'txt', 'json'] as const;
const INTRO_TEXT_TOKENS = new Set(['groupDisplayName']);
const sendGroupHistoryExportFormatSchema = z.enum(SEND_GROUP_HISTORY_EXPORT_FORMATS);

export const sendGroupHistoryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  sendOnJoin: z.boolean().default(true),
  sendOnAdd: z.boolean().default(true),
  sendOnApproval: z.boolean().default(true),
  ensureArchivePolicy: z.boolean().default(true),
  formats: z.array(sendGroupHistoryExportFormatSchema)
    .min(1, 'select at least one archive export format')
    .transform((formats) => [...new Set(formats)])
    .default(['pdf']),
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
