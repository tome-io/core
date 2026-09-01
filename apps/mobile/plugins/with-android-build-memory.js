const { withGradleProperties } = require('expo/config-plugins');

const ANDROID_BUILD_PROPERTIES = {
  'org.gradle.jvmargs':
    '-Xmx4096m -XX:MaxMetaspaceSize=1536m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
  'org.gradle.workers.max': '4',
};

function setGradleProperty(properties, key, value) {
  const existing = properties.find(
    (property) => property.type === 'property' && property.key === key,
  );

  if (existing) {
    existing.value = value;
    return;
  }

  properties.push({ type: 'property', key, value });
}

module.exports = function withAndroidBuildMemory(config) {
  return withGradleProperties(config, (gradleConfig) => {
    for (const [key, value] of Object.entries(ANDROID_BUILD_PROPERTIES)) {
      setGradleProperty(gradleConfig.modResults, key, value);
    }

    return gradleConfig;
  });
};
