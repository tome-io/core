import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('react-native-readium/package.json'));
const source = readFileSync(join(root, 'ios/Reader/Common/ReaderViewController.swift'), 'utf8');
if (!source.includes('positionLabel.isHidden = true')) {
  throw new Error('Installed Readium is missing the Tomeio footer patch. Run bun install --force from the core workspace before rebuilding iOS.');
}
