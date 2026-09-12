import {
  conditionalTemplateHasCondition,
  renderConditionalTemplateIfActive
} from '@wabs/plugin-sdk/templates';

export const SEND_GROUP_HISTORY_INTRO_TEXT_TOKENS = [
  'groupDisplayName',
  'hasGroupDisplayName'
] as const;

export function renderSendGroupHistoryIntroText(input: {
  source: string;
  groupDisplayName?: string | undefined;
  chatId: string;
}): string {
  const candidate = input.groupDisplayName?.trim();
  const readableGroupDisplayName = candidate && candidate !== input.chatId.trim()
    ? candidate
    : undefined;
  const values = {
    groupDisplayName: readableGroupDisplayName || input.chatId,
    hasGroupDisplayName: readableGroupDisplayName ? 'true' : undefined
  };
  if (conditionalTemplateHasCondition(input.source)) {
    return renderConditionalTemplateIfActive(input.source, SEND_GROUP_HISTORY_INTRO_TEXT_TOKENS, values);
  }
  return input.source.replace(/\{(groupDisplayName|hasGroupDisplayName)\}/g, (_, token: keyof typeof values) => (
    values[token] ?? ''
  ));
}
