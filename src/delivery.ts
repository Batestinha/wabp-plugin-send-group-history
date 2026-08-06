import {
  isChatArchiveExportTooLargeError,
  type ChatArchiveExportDocument,
  type ChatArchiveExportFormat
} from '../../../platform/chatArchive/chatArchiveExportService';
import type { TranslateFn } from '../../../platform/i18n';

export const ARCHIVE_DOCUMENT_TOO_LARGE_REASON = 'archive-document-too-large';

export type SendGroupHistoryDocumentOmission =
  | {
      status: 'too_large';
      phase: 'preflight';
      format: ChatArchiveExportFormat;
      filename: string;
      sizeBytes: number;
      maxBytes: number;
      messageCount: number;
      reason: typeof ARCHIVE_DOCUMENT_TOO_LARGE_REASON;
    }
  | {
      status: 'failed';
      phase: 'export';
      format: ChatArchiveExportFormat;
      filename: null;
      sizeBytes: null;
      maxBytes: number;
      messageCount: null;
      reason: string;
    };

export interface PreparedSendGroupHistoryDocuments {
  documents: ChatArchiveExportDocument[];
  omissions: SendGroupHistoryDocumentOmission[];
  everyFormatFailedDuringExport: boolean;
}

export async function prepareSendGroupHistoryDocuments(input: {
  formats: readonly ChatArchiveExportFormat[];
  maxBytes: number;
  exportFormat(format: ChatArchiveExportFormat): Promise<ChatArchiveExportDocument>;
}): Promise<PreparedSendGroupHistoryDocuments> {
  const documents: ChatArchiveExportDocument[] = [];
  const omissions: SendGroupHistoryDocumentOmission[] = [];

  for (const format of input.formats) {
    try {
      const document = await input.exportFormat(format);
      if (document.buffer.length > input.maxBytes) {
        omissions.push({
          status: 'too_large',
          phase: 'preflight',
          format: document.format,
          filename: document.filename,
          sizeBytes: document.buffer.length,
          maxBytes: input.maxBytes,
          messageCount: document.messageCount,
          reason: ARCHIVE_DOCUMENT_TOO_LARGE_REASON
        });
        continue;
      }
      documents.push(document);
    } catch (error) {
      if (isChatArchiveExportTooLargeError(error)) {
        omissions.push({
          status: 'too_large',
          phase: 'preflight',
          format: error.format,
          filename: error.filename,
          sizeBytes: error.sizeBytes,
          maxBytes: error.maxBytes,
          messageCount: error.messageCount,
          reason: ARCHIVE_DOCUMENT_TOO_LARGE_REASON
        });
        continue;
      }
      omissions.push({
        status: 'failed',
        phase: 'export',
        format,
        filename: null,
        sizeBytes: null,
        maxBytes: input.maxBytes,
        messageCount: null,
        reason: errorMessage(error)
      });
    }
  }

  return {
    documents,
    omissions,
    everyFormatFailedDuringExport: documents.length === 0
      && omissions.length === input.formats.length
      && omissions.every((omission) => omission.status === 'failed')
  };
}

export function appendSendGroupHistoryOmissionNotice(
  text: string | undefined,
  omissions: readonly SendGroupHistoryDocumentOmission[],
  t: TranslateFn
): string | undefined {
  if (omissions.length === 0) {
    return text;
  }
  const notice = t('official.send-group-history.omittedFormatsNotice', {
    formats: omissions.map((omission) => omission.format.toUpperCase()).join(', ')
  });
  return text?.trim() ? `${text.trim()}\n\n${notice}` : notice;
}

export function sendGroupHistoryOmissionAuditMetadata(
  omission: SendGroupHistoryDocumentOmission
): Record<string, unknown> {
  return {
    reason: omission.reason,
    phase: omission.phase,
    format: omission.format,
    filename: omission.filename,
    sizeBytes: omission.sizeBytes,
    maxBytes: omission.maxBytes,
    messageCount: omission.messageCount
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
