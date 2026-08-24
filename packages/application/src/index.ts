import {
  mergeBookMetadata,
  type BookMetadata,
  type BookProgress,
  type MetadataCandidate,
} from '@readoi/domain';
import type { BookExtension, ExtensionPage, ExtensionQuery } from '@readoi/extension-protocol';

export interface BookRepository {
  list(): Promise<BookMetadata[]>;
  find(id: string): Promise<BookMetadata | null>;
  save(book: BookMetadata): Promise<void>;
}

export interface ProgressRepository {
  list(): Promise<BookProgress[]>;
  save(progress: BookProgress): Promise<void>;
}

export interface ExtensionProvider {
  enabled(): Promise<BookExtension[]>;
}

export interface MetadataEnrichmentSource {
  source: MetadataCandidate['source'];
  find(title: string, author?: string): Promise<Partial<BookMetadata> | null>;
}

export interface MetadataEnrichmentFailure {
  source: MetadataCandidate['source'];
  error: unknown;
}

export interface MetadataEnrichmentResult {
  book: BookMetadata;
  failures: MetadataEnrichmentFailure[];
}

export class MetadataEnrichmentService {
  private readonly sources: readonly MetadataEnrichmentSource[];

  constructor(sources: readonly MetadataEnrichmentSource[]) {
    this.sources = sources;
  }

  async enrich(seed: MetadataCandidate): Promise<MetadataEnrichmentResult> {
    const title = seed.metadata.title;
    if (!title) throw new Error('Metadata enrichment requires a title.');
    const author = seed.metadata.authors?.[0];
    const results = await Promise.allSettled(
      this.sources.map(async (source) => ({
        source: source.source,
        metadata: await source.find(title, author),
      }))
    );
    const candidates: MetadataCandidate[] = [seed];
    const failures: MetadataEnrichmentFailure[] = [];
    for (const [index, result] of results.entries()) {
      const source = this.sources[index];
      if (!source) continue;
      if (result.status === 'rejected') {
        failures.push({ source: source.source, error: result.reason });
      } else if (result.value.metadata) {
        candidates.push({ source: result.value.source, metadata: result.value.metadata });
      }
    }
    return { book: mergeBookMetadata(candidates), failures };
  }
}

export class DiscoveryService {
  private readonly extensions: ExtensionProvider;

  constructor(extensions: ExtensionProvider) {
    this.extensions = extensions;
  }

  async catalog(
    extensionId: string,
    query: ExtensionQuery
  ): Promise<ExtensionPage<BookMetadata>> {
    const extension = (await this.extensions.enabled()).find(
      (candidate) => candidate.manifest.id === extensionId
    );
    if (!extension) throw new Error(`Extension "${extensionId}" is not enabled.`);
    if (!extension.catalog) {
      throw new Error(`Extension "${extensionId}" does not provide catalogs.`);
    }
    return extension.catalog(query);
  }

  async search(
    extensionId: string,
    query: ExtensionQuery
  ): Promise<ExtensionPage<BookMetadata>> {
    const extension = (await this.extensions.enabled()).find(
      (candidate) => candidate.manifest.id === extensionId
    );
    if (!extension) throw new Error(`Extension "${extensionId}" is not enabled.`);
    if (!extension.search) {
      throw new Error(`Extension "${extensionId}" does not provide search.`);
    }
    return extension.search(query);
  }
}
