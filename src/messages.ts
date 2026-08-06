import type { MessageCatalog } from '../../../platform/i18n';

export const sendGroupHistoryMessages: MessageCatalog = {
  'official.send-group-history.description': 'Send existing archived group history to new members as private archive documents.',
  'official.send-group-history.help.feature.title': 'Welcome history',
  'official.send-group-history.help.feature.summary': 'Send retained group history privately to eligible new members.',
  'official.send-group-history.help.delivery.title': 'Deliver group history',
  'official.send-group-history.help.delivery.summary': 'Automatically export retained messages after a member joins, is added, or is approved.',
  'official.send-group-history.help.delivery.instruction': 'This feature attempts configured formats independently in order. Formats that fail or exceed the fixed 100 MiB delivery limit are omitted while later eligible formats continue.',
  'official.send-group-history.introText': 'Here is the archived history for this group.',
  'official.send-group-history.omittedFormatsNotice': 'Some requested archive formats were omitted because they could not be prepared or exceeded the delivery limit: {formats}.'
};
