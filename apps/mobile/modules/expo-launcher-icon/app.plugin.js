const fs = require('node:fs/promises');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

const FULL_ALIAS = '.MainActivityTomeioFull';
const MONOCHROME_ALIAS = '.MainActivityTomeioMonochrome';
const LAUNCHER_ACTION = 'android.intent.action.MAIN';
const LAUNCHER_CATEGORY = 'android.intent.category.LAUNCHER';

function isLauncherFilter(filter) {
  const hasMain = filter.action?.some(
    (action) => action.$?.['android:name'] === LAUNCHER_ACTION
  );
  const hasLauncher = filter.category?.some(
    (category) => category.$?.['android:name'] === LAUNCHER_CATEGORY
  );
  return hasMain && hasLauncher;
}

function launcherAlias(name, icon, targetActivity, enabled) {
  return {
    $: {
      'android:name': name,
      'android:targetActivity': targetActivity,
      'android:enabled': enabled ? 'true' : 'false',
      'android:exported': 'true',
      'android:icon': icon,
      'android:label': '@string/app_name',
    },
    'intent-filter': [
      {
        action: [{ $: { 'android:name': LAUNCHER_ACTION } }],
        category: [{ $: { 'android:name': LAUNCHER_CATEGORY } }],
      },
    ],
  };
}

function withLauncherAliases(config) {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults
    );
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      config.modResults
    );
    const targetActivity = mainActivity.$['android:name'];

    mainActivity['intent-filter'] = (mainActivity['intent-filter'] ?? []).filter(
      (filter) => !isLauncherFilter(filter)
    );

    const aliases = (application['activity-alias'] ?? []).filter(
      (alias) =>
        alias.$?.['android:name'] !== FULL_ALIAS &&
        alias.$?.['android:name'] !== MONOCHROME_ALIAS
    );
    application['activity-alias'] = [
      ...aliases,
      launcherAlias(FULL_ALIAS, '@mipmap/ic_launcher', targetActivity, true),
      launcherAlias(
        MONOCHROME_ALIAS,
        '@mipmap/ic_launcher_tomeio_monochrome',
        targetActivity,
        false
      ),
    ];
    return config;
  });
}

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function vectorDrawable(svg) {
  const paths = [...svg.matchAll(/<path\s+d="([^"]+)"/g)].map(
    (match) => match[1]
  );
  if (paths.length === 0) {
    throw new Error('The Tomeio monochrome SVG contains no path data.');
  }
  const pathElements = paths
    .map(
      (pathData) =>
        `    <path android:fillColor="#1A0C04" android:pathData="${escapeAttribute(pathData)}"/>`
    )
    .join('\n');

  // The source path uses a 12540-unit, bottom-left SVG coordinate system. The
  // larger viewport centers it inside Android's adaptive-icon safe zone.
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="108dp"
  android:height="108dp"
  android:viewportWidth="18810"
  android:viewportHeight="18810">
  <group android:translateX="3135" android:translateY="15675" android:scaleY="-1">
${pathElements}
  </group>
</vector>
`;
}

async function writeResource(root, directory, filename, contents) {
  const destination = path.join(root, directory);
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, filename), contents);
}

function withLauncherResources(config, options) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const resourceRoot = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/res'
      );
      const svgPath = path.resolve(
        config.modRequest.projectRoot,
        options.monochromeSvg ?? './assets/images/android-icon-monochrome.svg'
      );
      const svg = await fs.readFile(svgPath, 'utf8');

      await writeResource(
        resourceRoot,
        'drawable',
        'tomeio_launcher_monochrome_foreground.xml',
        vectorDrawable(svg)
      );
      await writeResource(
        resourceRoot,
        'values',
        'tomeio_launcher_icon.xml',
        `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="tomeio_launcher_monochrome_background">#FFB511</color>
</resources>
`
      );
      await writeResource(
        resourceRoot,
        'mipmap-anydpi',
        'ic_launcher_tomeio_monochrome.xml',
        `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item>
    <shape android:shape="rectangle">
      <solid android:color="@color/tomeio_launcher_monochrome_background"/>
    </shape>
  </item>
  <item android:drawable="@drawable/tomeio_launcher_monochrome_foreground" android:gravity="center"/>
</layer-list>
`
      );
      await writeResource(
        resourceRoot,
        'mipmap-anydpi-v26',
        'ic_launcher_tomeio_monochrome.xml',
        `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/tomeio_launcher_monochrome_background"/>
  <foreground android:drawable="@drawable/tomeio_launcher_monochrome_foreground"/>
  <monochrome android:drawable="@drawable/tomeio_launcher_monochrome_foreground"/>
</adaptive-icon>
`
      );
      return config;
    },
  ]);
}

module.exports = function withTomeioLauncherIcon(config, options = {}) {
  config = withLauncherAliases(config);
  config = withLauncherResources(config, options);
  return config;
};
