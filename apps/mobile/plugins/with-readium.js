const fs = require('node:fs/promises');
const path = require('node:path');
const {
  withAppBuildGradle,
  withDangerousMod,
  withPodfile,
  withProjectBuildGradle,
} = require('expo/config-plugins');

function insertOnce(contents, anchor, addition, description) {
  if (contents.includes(addition.trim())) return contents;
  if (!anchor.test(contents)) {
    throw new Error(`Could not configure Readium: ${description} anchor was not found.`);
  }
  return contents.replace(anchor, (match) => `${match}${addition}`);
}

function withReadiumPodfile(config) {
  return withPodfile(config, (podfileConfig) => {
    let contents = podfileConfig.modResults.contents;

    if (!contents.includes("source 'https://github.com/readium/podspecs'")) {
      contents = [
        "source 'https://github.com/readium/podspecs'",
        "source 'https://cdn.cocoapods.org/'",
        '',
        contents,
      ].join('\n');
    }

    contents = insertOnce(
      contents,
      /^  config = use_native_modules!\([^\n]*\)\n/m,
      '\n  readium_pods\n',
      'iOS target',
    );
    contents = insertOnce(
      contents,
      /^(    \)\n)(?=  end\nend)/m,
      '\n    readium_post_install(installer)\n',
      'iOS post-install',
    );

    podfileConfig.modResults.contents = contents;
    return podfileConfig;
  });
}

function withReadiumAndroidDesugaring(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('Readium Android configuration requires a Groovy app build.gradle.');
    }

    let contents = gradleConfig.modResults.contents;
    contents = insertOnce(
      contents,
      /^android \{\n/m,
      `    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
        coreLibraryDesugaringEnabled true
    }

`,
      'Android compile options',
    );
    contents = insertOnce(
      contents,
      /^dependencies \{\n/m,
      '    coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.1.5"\n',
      'Android dependencies',
    );

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
}

function withReadiumKotlinPlugin(config) {
  return withProjectBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('Readium Android configuration requires a Groovy project build.gradle.');
    }

    const unversionedPlugin = "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')";
    const versionedPlugin =
      'classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${providers.gradleProperty(\'android.kotlinVersion\').get()}")';
    const contents = gradleConfig.modResults.contents;

    if (!contents.includes(versionedPlugin)) {
      if (!contents.includes(unversionedPlugin)) {
        throw new Error('Could not configure Readium: Kotlin Gradle plugin anchor was not found.');
      }
      gradleConfig.modResults.contents = contents.replace(
        unversionedPlugin,
        versionedPlugin,
      );
    }

    return gradleConfig;
  });
}

function withReadiumDebugNetworkSecurity(config) {
  return withDangerousMod(config, [
    'android',
    async (androidConfig) => {
      const resourceDirectory = path.join(
        androidConfig.modRequest.platformProjectRoot,
        'app/src/debug/res/xml',
      );

      await fs.mkdir(resourceDirectory, { recursive: true });
      await fs.writeFile(
        path.join(resourceDirectory, 'network_security_config.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`,
      );

      return androidConfig;
    },
  ]);
}

module.exports = function withReadium(config) {
  config = withReadiumPodfile(config);
  config = withReadiumKotlinPlugin(config);
  config = withReadiumAndroidDesugaring(config);
  config = withReadiumDebugNetworkSecurity(config);
  return config;
};
