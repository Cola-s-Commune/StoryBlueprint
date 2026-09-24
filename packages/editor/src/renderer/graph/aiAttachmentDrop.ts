import type { AIFileAttachment } from '../../shared/electronApi';

export const MAX_AI_ATTACHMENT_BYTES = 512 * 1024; // 512 KB
export const MAX_AI_ATTACHMENTS = 8;
export const MAX_AI_ATTACHMENTS_BYTES = 2 * 1024 * 1024; // 2 MB

export interface ProcessDroppedFilesResult {
  attachments: AIFileAttachment[];
  warnings: string[];
}

export interface MinimalFile {
  name: string;
  size: number;
  text: () => Promise<string>;
}

/**
 * Validates and processes files dragged & dropped onto the AI assistant.
 * Filters out binary files, oversized files, and enforces attachment count/size limits.
 */
export async function processDroppedAIContextFiles(
  files: readonly MinimalFile[],
  existingAttachments: readonly AIFileAttachment[] = [],
): Promise<ProcessDroppedFilesResult> {
  const warnings: string[] = [];
  const newAttachments: AIFileAttachment[] = [];

  const existingTotalBytes = existingAttachments.reduce(
    (sum, a) => sum + (typeof a.content === 'string' ? a.content.length : 0),
    0,
  );
  let currentTotalBytes = existingTotalBytes;

  const currentCount = existingAttachments.length;
  if (currentCount >= MAX_AI_ATTACHMENTS) {
    warnings.push(`Already reached the maximum of ${MAX_AI_ATTACHMENTS} attached files.`);
    return { attachments: [], warnings };
  }

  for (const file of files) {
    if (currentCount + newAttachments.length >= MAX_AI_ATTACHMENTS) {
      warnings.push(`Maximum ${MAX_AI_ATTACHMENTS} files attached. Some files were not added.`);
      break;
    }

    if (file.size > MAX_AI_ATTACHMENT_BYTES) {
      warnings.push(`${file.name} exceeds the ${Math.floor(MAX_AI_ATTACHMENT_BYTES / 1024)} KB limit.`);
      continue;
    }

    try {
      const content = await file.text();

      // Check for binary file content (null bytes)
      if (content.includes('\0')) {
        warnings.push(`${file.name} appears to be a binary file. Only text-based files can be attached.`);
        continue;
      }

      const contentBytes = typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(content).length
        : Buffer.byteLength(content, 'utf8');

      if (currentTotalBytes + contentBytes > MAX_AI_ATTACHMENTS_BYTES) {
        warnings.push(
          `Adding ${file.name} would exceed the total attachment limit of ${Math.floor(MAX_AI_ATTACHMENTS_BYTES / (1024 * 1024))} MB.`,
        );
        break;
      }

      currentTotalBytes += contentBytes;

      const id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      newAttachments.push({
        id,
        name: file.name,
        content,
      });
    } catch (err) {
      warnings.push(`Failed to read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { attachments: newAttachments, warnings };
}
