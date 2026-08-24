import { PDFDocument } from 'pdf-lib/cjs/index';

import type { PdfEmbeddedMetadata } from './pdf-metadata.types';

export type { PdfEmbeddedMetadata } from './pdf-metadata.types';

export async function readPdfMetadata(base64: string): Promise<PdfEmbeddedMetadata> {
  const pdf = await PDFDocument.load(base64, {
    ignoreEncryption: true,
    throwOnInvalidObject: true,
    updateMetadata: false,
  });
  const created = pdf.getCreationDate();
  return {
    title: pdf.getTitle()?.trim(),
    author: pdf.getAuthor()?.trim(),
    description: pdf.getSubject()?.trim(),
    year: created ? String(created.getUTCFullYear()) : '',
  };
}
