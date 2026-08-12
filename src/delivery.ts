import {
  isChatArchiveExportTooLargeError,
  type ChatArchiveExportDocument,
  type ChatArchiveExportDocumentPart,
  type ChatArchiveExportDocumentSet,
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
      archiveSetMessageCount?: number | undefined;
      documentCount?: number | undefined;
      part?: ChatArchiveExportDocumentPart | undefined;
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
  documentSets: ChatArchiveExportDocumentSet[];
  omissions: SendGroupHistoryDocumentOmission[];
  everyFormatFailedDuringExport: boolean;
}

interface PrepareSendGroupHistoryDocumentsBaseInput {
  formats: readonly ChatArchiveExportFormat[];
  maxBytes: number;
}

type PrepareSendGroupHistoryDocumentsInput = PrepareSendGroupHistoryDocumentsBaseInput & (
  | {
      exportFormatSet(format: ChatArchiveExportFormat): Promise<ChatArchiveExportDocumentSet>;
      exportFormat?: ((format: ChatArchiveExportFormat) => Promise<ChatArchiveExportDocument>) | undefined;
    }
  | {
      exportFormatSet?: undefined;
      exportFormat(format: ChatArchiveExportFormat): Promise<ChatArchiveExportDocument>;
    }
);

export async function prepareSendGroupHistoryDocuments(
  input: PrepareSendGroupHistoryDocumentsInput
): Promise<PreparedSendGroupHistoryDocuments> {
  const documents: ChatArchiveExportDocument[] = [];
  const documentSets: ChatArchiveExportDocumentSet[] = [];
  const omissions: SendGroupHistoryDocumentOmission[] = [];

  for (const format of input.formats) {
    try {
      const documentSet = normalizeSendGroupHistoryDocumentSet(
        format,
        input.exportFormatSet
          ? await input.exportFormatSet(format)
          : legacyDocumentSet(await input.exportFormat(format))
      );
      const oversizedDocument = documentSet.documents.find((document) => document.buffer.length > input.maxBytes);
      if (oversizedDocument) {
        omissions.push({
          status: 'too_large',
          phase: 'preflight',
          format: documentSet.format,
          filename: oversizedDocument.filename,
          sizeBytes: oversizedDocument.buffer.length,
          maxBytes: input.maxBytes,
          messageCount: oversizedDocument.messageCount,
          reason: ARCHIVE_DOCUMENT_TOO_LARGE_REASON,
          archiveSetMessageCount: documentSet.messageCount,
          documentCount: documentSet.documents.length,
          ...(oversizedDocument.part ? { part: oversizedDocument.part } : {})
        });
        continue;
      }
      documentSets.push(documentSet);
      documents.push(...documentSet.documents);
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
    documentSets,
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
    messageCount: omission.messageCount,
    ...('archiveSetMessageCount' in omission && omission.archiveSetMessageCount !== undefined
      ? { archiveSetMessageCount: omission.archiveSetMessageCount }
      : {}),
    ...('documentCount' in omission && omission.documentCount !== undefined
      ? { documentCount: omission.documentCount }
      : {}),
    ...('part' in omission && omission.part
      ? sendGroupHistoryDocumentPartAuditMetadata(omission.part)
      : {})
  };
}

export function sendGroupHistoryDocumentSetAuditMetadata(
  documentSet: ChatArchiveExportDocumentSet,
  document: ChatArchiveExportDocument
): Record<string, unknown> {
  const coverage = documentSet.coverage ?? document.coverage;
  return {
    archiveSetMessageCount: documentSet.messageCount,
    documentCount: documentSet.documents.length,
    ...(coverage ? {
      archiveCompleteness: coverage.completeness,
      archiveTotalMessageCount: coverage.totalMessageCount,
      archiveIncludedMessageCount: coverage.includedMessageCount,
      archiveOmittedMessageCount: coverage.omittedMessageCount,
      archiveIncludedFirstMessageAt: coverage.includedRange?.firstMessageAt.toISOString() ?? null,
      archiveIncludedLastMessageAt: coverage.includedRange?.lastMessageAt.toISOString() ?? null,
      archiveOmittedFirstMessageAt: coverage.omittedRange?.firstMessageAt.toISOString() ?? null,
      archiveOmittedLastMessageAt: coverage.omittedRange?.lastMessageAt.toISOString() ?? null,
      archiveOverflowStrategy: coverage.overflowStrategy
    } : {}),
    ...(document.part ? sendGroupHistoryDocumentPartAuditMetadata(document.part) : {})
  };
}

function sendGroupHistoryDocumentPartAuditMetadata(part: ChatArchiveExportDocumentPart): Record<string, unknown> {
  return {
    partNumber: part.partNumber,
    partCount: part.partCount,
    partFirstMessageAt: part.firstMessageAt?.toISOString() ?? null,
    partLastMessageAt: part.lastMessageAt?.toISOString() ?? null
  };
}

function legacyDocumentSet(document: ChatArchiveExportDocument): ChatArchiveExportDocumentSet {
  return {
    format: document.format,
    documents: [document],
    messageCount: document.messageCount,
    ...(document.messageTypeCounts ? { messageTypeCounts: document.messageTypeCounts } : {}),
    ...(document.placeholderMessageTypeCounts
      ? { placeholderMessageTypeCounts: document.placeholderMessageTypeCounts }
      : {}),
    chatTitle: document.chatTitle,
    ...(document.coverage ? { coverage: document.coverage } : {})
  };
}

export function normalizeSendGroupHistoryDocumentSet(
  requestedFormat: ChatArchiveExportFormat,
  documentSet: ChatArchiveExportDocumentSet
): ChatArchiveExportDocumentSet {
  if (documentSet.format !== requestedFormat) {
    throw new Error(`Archive exporter returned ${documentSet.format} for requested ${requestedFormat} format.`);
  }
  if (documentSet.documents.length === 0) {
    throw new Error(`Archive exporter returned no ${requestedFormat} documents.`);
  }
  if (documentSet.documents.length > 1) {
    throw new Error(
      `Archive exporter returned multiple ${requestedFormat} documents; Send History allows one document per format.`
    );
  }
  if (documentSet.documents.some((document) => document.format !== requestedFormat)) {
    throw new Error(`Archive exporter returned a mixed-format ${requestedFormat} document set.`);
  }

  const documents = [...documentSet.documents];
  assertNonNegativeSafeInteger(documentSet.messageCount, `${requestedFormat} archive-set message count`);
  for (const document of documents) {
    assertNonNegativeSafeInteger(document.messageCount, `${requestedFormat} document message count`);
    if (document.chatTitle !== documentSet.chatTitle) {
      throw new Error(`Archive exporter returned mismatched ${requestedFormat} chat titles.`);
    }
    validateCountMap(document.messageTypeCounts, `${requestedFormat} document message-type counts`);
    validateCountMap(
      document.placeholderMessageTypeCounts,
      `${requestedFormat} document placeholder-message-type counts`
    );
  }
  const summedMessageCount = documents.reduce((sum, document) => sum + document.messageCount, 0);
  if (!Number.isSafeInteger(summedMessageCount) || summedMessageCount !== documentSet.messageCount) {
    throw new Error(`Archive exporter returned an inconsistent ${requestedFormat} archive-set message count.`);
  }

  const part = documents[0]?.part;
  if (part !== undefined) {
    assertPositiveSafeInteger(part.partNumber, `${requestedFormat} document part number`);
    assertPositiveSafeInteger(part.partCount, `${requestedFormat} document part count`);
    validatePartRange(requestedFormat, part);
    if (part.partNumber !== 1 || part.partCount !== 1) {
      throw new Error(`Archive exporter returned multipart metadata for single-file ${requestedFormat} history.`);
    }
  }
  return normalizedAggregateCounts(requestedFormat, documentSet, documents);
}

function normalizedAggregateCounts(
  format: ChatArchiveExportFormat,
  documentSet: ChatArchiveExportDocumentSet,
  documents: ChatArchiveExportDocument[]
): ChatArchiveExportDocumentSet {
  const normalized = { ...documentSet, documents };
  normalized.messageTypeCounts = normalizedAggregateCountMap(
    format,
    'message-type',
    documentSet.messageTypeCounts,
    documents.map((document) => document.messageTypeCounts)
  );
  normalized.placeholderMessageTypeCounts = normalizedAggregateCountMap(
    format,
    'placeholder-message-type',
    documentSet.placeholderMessageTypeCounts,
    documents.map((document) => document.placeholderMessageTypeCounts)
  );
  return normalized;
}

function normalizedAggregateCountMap(
  format: ChatArchiveExportFormat,
  label: string,
  aggregate: Record<string, number> | undefined,
  documentMaps: Array<Record<string, number> | undefined>
): Record<string, number> | undefined {
  validateCountMap(aggregate, `${format} archive-set ${label} counts`);
  if (documentMaps.some((counts) => counts === undefined)) {
    return aggregate ? normalizedCountMap(aggregate) : undefined;
  }
  const recomputed = new Map<string, number>();
  for (const counts of documentMaps as Array<Record<string, number>>) {
    for (const [key, count] of Object.entries(normalizedCountMap(counts))) {
      const next = (recomputed.get(key) ?? 0) + count;
      if (!Number.isSafeInteger(next)) {
        throw new Error(`Archive exporter returned overflowing ${format} ${label} counts.`);
      }
      recomputed.set(key, next);
    }
  }
  const recomputedCounts = Object.fromEntries(recomputed);
  if (aggregate && !countMapsEqual(normalizedCountMap(aggregate), recomputedCounts)) {
    throw new Error(`Archive exporter returned inconsistent ${format} archive-set ${label} counts.`);
  }
  return recomputedCounts;
}

function validatePartRange(format: ChatArchiveExportFormat, part: ChatArchiveExportDocumentPart): void {
  const first = validDateOrNull(part.firstMessageAt);
  const last = validDateOrNull(part.lastMessageAt);
  if (!first || !last) {
    throw new Error(`Archive exporter returned invalid ${format} document part dates.`);
  }
  if ((part.firstMessageAt === null) !== (part.lastMessageAt === null)) {
    throw new Error(`Archive exporter returned an incomplete ${format} document part range.`);
  }
  if (
    part.firstMessageAt
    && part.lastMessageAt
    && part.firstMessageAt.getTime() > part.lastMessageAt.getTime()
  ) {
    throw new Error(`Archive exporter returned a reversed ${format} document part range.`);
  }
}

function validDateOrNull(value: unknown): boolean {
  return value === null || (value instanceof Date && Number.isFinite(value.getTime()));
}

function validateCountMap(value: Record<string, number> | undefined, label: string): void {
  if (value === undefined) {
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Archive exporter returned invalid ${label}.`);
  }
  for (const count of Object.values(value)) {
    assertNonNegativeSafeInteger(count, label);
  }
}

function normalizedCountMap(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).filter(([, count]) => count !== 0));
}

function countMapsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, count], index) => key === rightEntries[index]?.[0] && count === rightEntries[index]?.[1]);
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Archive exporter returned an invalid ${label}.`);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Archive exporter returned an invalid ${label}.`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
