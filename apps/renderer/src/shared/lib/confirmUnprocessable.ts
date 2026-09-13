import { requestConfirm } from '@/shared/store/confirmStore';
import type { ChosenDocuments } from './localFiles';

/** Beyond this many names, the dialog just says how many more rather than listing every one. */
const MAX_LISTED = 8;

/**
 * Asks the engineer to confirm before ingesting a pick/drop that included files the pipeline
 * can't read — a folder that turned out to hold spreadsheets or archives alongside its
 * manuals, say. Returns the documents to ingest (the accepted ones, unchanged) if they choose
 * to proceed, or `null` if they cancel or there was nothing accepted to proceed with.
 *
 * A no-op — resolves immediately with `chosen` — when nothing was skipped, so callers can
 * await this unconditionally on every pick/drop.
 */
export async function withUnprocessableConfirm(
  chosen: ChosenDocuments,
): Promise<ChosenDocuments | null> {
  if (chosen.skipped.length === 0) return chosen;

  const acceptedCount = chosen.paths.length + chosen.files.length;
  const skippedCount = chosen.skipped.length;
  const detail = chosen.skipped.slice(0, MAX_LISTED);
  if (skippedCount > detail.length) detail.push(`…and ${skippedCount - detail.length} more`);

  const proceed = await requestConfirm({
    title:
      acceptedCount > 0
        ? `${skippedCount} of the dropped ${skippedCount === 1 ? 'file' : 'files'} can't be processed`
        : `None of the ${skippedCount === 1 ? 'dropped file can' : 'dropped files can'} be processed`,
    body:
      acceptedCount > 0
        ? `LocalChat only reads PDF, DOCX, Markdown, TXT, PNG and JPG. Continue with the ${acceptedCount} supported ${acceptedCount === 1 ? 'document' : 'documents'}?`
        : 'LocalChat only reads PDF, DOCX, Markdown, TXT, PNG and JPG, and none of what was dropped matches.',
    detail,
    confirmLabel: acceptedCount > 0 ? 'Proceed' : 'OK',
    cancelLabel: acceptedCount > 0 ? 'Cancel' : null,
  });

  if (acceptedCount === 0) return null;
  return proceed ? chosen : null;
}
