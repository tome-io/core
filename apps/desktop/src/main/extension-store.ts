import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  ExtensionRegistryStore,
  InstalledExtension,
} from '@readoi/extension-runtime';

export class JsonExtensionStore implements ExtensionRegistryStore {
  constructor(private readonly path: string) {}

  async read(): Promise<InstalledExtension[]> {
    let contents: string;
    try {
      contents = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error(`Could not read extension registry at ${this.path}.`, {
        cause: error,
      });
    }
    let value: unknown;
    try {
      value = JSON.parse(contents);
    } catch (error) {
      throw new Error(`Extension registry at ${this.path} contains invalid JSON.`, {
        cause: error,
      });
    }
    if (!Array.isArray(value)) {
      throw new Error(`Extension registry at ${this.path} must contain an array.`);
    }
    return value as InstalledExtension[];
  }

  async write(extensions: InstalledExtension[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.next`;
    await writeFile(temporaryPath, `${JSON.stringify(extensions, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.path);
  }
}
