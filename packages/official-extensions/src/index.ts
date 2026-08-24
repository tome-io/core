import { internetArchiveExtension } from '@readoi/extension-internet-archive';
import { openLibraryExtension } from '@readoi/extension-open-library';
import { projectGutenbergExtension } from '@readoi/extension-project-gutenberg';

export const officialExtensions = [
  openLibraryExtension,
  internetArchiveExtension,
  projectGutenbergExtension,
] as const;

export const officialExtensionManifests = officialExtensions.map(
  (extension) => extension.manifest
);

export {
  internetArchiveExtension,
  openLibraryExtension,
  projectGutenbergExtension,
};
