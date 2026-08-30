import { openLibraryExtension } from '@tomeio/extension-open-library';
import { projectGutenbergExtension } from '@tomeio/extension-project-gutenberg';

export const officialExtensions = [
  openLibraryExtension,
  projectGutenbergExtension,
] as const;

export const officialExtensionManifests = officialExtensions.map(
  (extension) => extension.manifest
);

export {
  openLibraryExtension,
  projectGutenbergExtension,
};
