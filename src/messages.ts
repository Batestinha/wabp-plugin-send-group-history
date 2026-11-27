import type { MessageCatalog } from '@wabs/plugin-sdk/i18n';

export const sendGroupHistoryMessages: MessageCatalog = {
  "official.send-group-history.subscription.title": "Automatic group history",
  "official.send-group-history.subscription.off": "Off",
  "official.send-group-history.subscription.on": "On",
  'official.send-group-history.subscriptionHint': 'Change automatic group history with /chatarchive delivery off or /chatarchive delivery on.',
  'official.send-group-history.description': 'Privately delivers readable group archives. Newcomers can receive files automatically, and an authorized requester can send an archive to an eligible recipient.',
  'official.send-group-history.help.feature.title': 'Archive Courier',
  'official.send-group-history.help.feature.summary': 'Use /chatarchive delivery to turn automatic history files on or off for a community. Administrators can also send a group archive to an eligible recipient.',
  'official.send-group-history.help.delivery.title': 'Deliver group history',
  'official.send-group-history.help.delivery.summary': 'Automatically export retained messages after a member joins, is added, or is approved.',
  'official.send-group-history.help.delivery.instruction': 'This feature attempts configured formats independently in order. If one file would exceed the fixed 100 MiB delivery limit, the oldest messages are omitted until the newest history fits. A format is omitted only if even its newest content cannot fit or preparation fails.',
  'official.send-group-history.introText': 'Here is the archived history for this group.',
  'official.send-group-history.omittedFormatsNotice': 'Some requested archive formats were omitted because they could not be prepared or exceeded the delivery limit: {formats}.'
};
