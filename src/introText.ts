import { renderValueTemplate, renderValueTemplateText, type ValueTemplateDefinition } from '@wabs/plugin-sdk/templates';
export const SEND_GROUP_HISTORY_INTRO_TEXT_TOKENS = ['groupDisplayName', 'hasGroupDisplayName'] as const;
export const historyTemplateDefinition: ValueTemplateDefinition = {
  variables: [{ token: 'groupDisplayName', label: 'Group display name', valueType: 'text' },
    { token: 'hasGroupDisplayName', label: 'Readable group name', valueType: 'boolean' }],
  activation: 'when-condition-used', mentions: { people: true, groups: true,
    targets: [{ id: 'recipient', label: 'Recipient' }, { id: 'currentGroup', label: 'Source group' }] }
};
type IntroInput = { source: string; groupDisplayName?: string | undefined; chatId: string };
function values(input: IntroInput) {
  const candidate = input.groupDisplayName?.trim();
  const name = candidate && candidate !== input.chatId.trim() ? candidate : undefined;
  return { displayValues: { groupDisplayName: name || input.chatId, hasGroupDisplayName: name ? 'true' : '' },
    conditionValues: { groupDisplayName: name || input.chatId, hasGroupDisplayName: Boolean(name) } };
}
export function renderSendGroupHistoryIntroFragment(input: IntroInput) {
  return renderValueTemplate(input.source, historyTemplateDefinition, values(input));
}
export function renderSendGroupHistoryIntroText(input: IntroInput): string {
  return renderValueTemplateText(input.source, historyTemplateDefinition, values(input));
}
