Pod::Spec.new do |s|
  s.name = 'ExpoProgressFolder'
  s.version = '1.0.0'
  s.summary = 'Persistent user-selected folder access for Tomeio.'
  s.description = 'Provides Android document-tree and iOS security-scoped folder access.'
  s.license = 'MIT'
  s.author = 'Tomeio'
  s.homepage = 'https://tomeio.org'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/tome-io/core.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.resource_bundles = {
    'ExpoProgressFolder_privacy' => ['PrivacyInfo.xcprivacy']
  }
  s.source_files = '**/*.swift'
end
