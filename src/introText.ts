import { renderOptionalNameTemplate } from '@wabs/plugin-sdk/templates';

export const SEND_GROUP_HISTORY_INTRO_TEXT_TOKENS = ['groupDisplayName', 'hasGroupDisplayName'] as const;

export function renderSendGroupHistoryIntroText(input: {
  source: string;
  groupDisplayName?: string | undefined;
  chatId: string;
}): string {
  return renderOptionalNameTemplate({ source: input.source, name: input.groupDisplayName,
    referenceId: input.chatId, nameToken: 'groupDisplayName', presenceToken: 'hasGroupDisplayName' });
}
