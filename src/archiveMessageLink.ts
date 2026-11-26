import type { PluginServiceCaller } from '@wabs/plugin-sdk/services';
import { valueTemplateReferences } from '@wabs/plugin-sdk/templates';

export async function archiveLinkForCaption(
  services: PluginServiceCaller | undefined, template: string, scopeId: string, exportedUrl?: string
): Promise<string | undefined> {
  if (!exportedUrl || !services || !valueTemplateReferences(template).tokens.includes('archiveUrl')) return undefined;
  try {
    const link = new URL(exportedUrl);
    if (link.protocol !== 'https:' || link.username || link.password || link.hash || link.pathname !== '/' ||
      !link.searchParams.get('chatId') || link.searchParams.get('workspace') !== `scope:${scopeId}`) return undefined;
    const result = await services.call<{ url: string | null }>({
      serviceId: 'official.integration-manager.message-links.v1', method: 'resolve', scopeId, input: { target: 'archiveOrigin' }
    });
    return result?.url === link.origin || result?.url === link.origin + '/' ? exportedUrl : undefined;
  } catch {
    return undefined;
  }
}
