import type { PdfEmbeddedMetadata } from './pdf-metadata.types';

export type { PdfEmbeddedMetadata } from './pdf-metadata.types';

export async function readPdfMetadata(_base64: string): Promise<PdfEmbeddedMetadata> {
  throw new Error('Embedded PDF metadata is unavailable on web.');
}
