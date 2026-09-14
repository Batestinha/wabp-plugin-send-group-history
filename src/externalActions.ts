import { z } from 'zod';
import type { PluginOperatorActionContext } from '@wabs/plugin-sdk/operator-actions';
import type { PluginExternalActionRegistration } from '@wabs/plugin-sdk/external-actions';
import { sendGroupHistoryManualInputSchema } from './operatorActions';
import { parseSendGroupHistoryConfig } from './config';
import { deliverConfiguredGroupHistoryManually } from './manualDelivery';

export function registerSendGroupHistoryExternalActions(context: PluginOperatorActionContext): PluginExternalActionRegistration[] {
  return [{ actionId: 'official.send-group-history.manualSend', inputSchema: sendGroupHistoryManualInputSchema,
    outputSchema: z.record(z.unknown()), handler: async (body, call) => {
      call.signal.throwIfAborted();
      const request = sendGroupHistoryManualInputSchema.parse(body);
      if (!context.operator || !context.resolveIdentityAddress) throw new Error('Host operator archive capabilities are unavailable.');
      // Manual delivery is an explicit account administrator action, including disabled scope defaults.
      const config = parseSendGroupHistoryConfig(await context.configFor(request.scopeId));
      return deliverConfiguredGroupHistoryManually({ ...request, config, i18n: context.i18n, templateMentions: context,
        transport: context.operator.transport, chatArchiveExporter: context.operator.archive,
        identityAddresses: { resolveStableIdentity: context.resolveIdentityAddress }, audit: context.audit });
    }
  }];
}
