import { memberSubscriptionService, registerMemberSubscription, type MemberSubscription } from '@wabs/plugin-sdk/member-subscriptions';
import type { ServicePluginContext } from '@wabs/plugin-sdk/service-plugin';
import type { PluginServiceCallContext } from '@wabs/plugin-sdk/services';
const ns = 'official.send-group-history';
export const historyOffer: MemberSubscription = { id: 'history', kind: 'internal', scope: 'community',
  serviceId: ns + '.subscriptions.v1', labelKey: ns + '.subscription.title', booleanSetting: 'automaticHistory',
  choices: ['off', 'on'].map(id => ({ id, labelKey: ns + '.subscription.' + id })) };
export const historyService = memberSubscriptionService(historyOffer);
export function historyRegistration(ctx: ServicePluginContext) {
  async function read(call: PluginServiceCallContext) {
    const config = await ctx.configFor(call.scopeId, call.actorIdentityId);
    return config.enabled === true ? { choice: config.automaticHistory === false ? 'off' : 'on' } : null;
  }
  return registerMemberSubscription(historyOffer, read, async (call, choice) => {
    const current = await read(call);
    if (!current || current.choice === choice) return current;
    if (!call.setMemberBoolean) throw new Error('The member preference writer is unavailable.');
    await call.setMemberBoolean(choice === 'on');
    return read(call);
  });
}
