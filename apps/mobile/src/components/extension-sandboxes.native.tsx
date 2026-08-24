import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebView as WebViewType } from 'react-native-webview';

import {
  createSandboxHtml,
  mobileScriptExtensionExecutor,
} from '@/lib/script-extension-executor';

export function ExtensionSandboxes() {
  const [, render] = useState(0);
  const webviews = useRef(new Map<string, WebViewType>());

  useEffect(
    () => mobileScriptExtensionExecutor.subscribe(() => render((value) => value + 1)),
    []
  );

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
    >
      {mobileScriptExtensionExecutor.snapshot().map((session) => (
        <WebView
          key={`${session.manifest.id}:${session.manifest.version}:${session.manifest.transport.kind === 'script' ? session.manifest.transport.sha256 : ''}`}
          ref={(view) => {
            if (view) webviews.current.set(session.manifest.id, view);
            else webviews.current.delete(session.manifest.id);
          }}
          source={{ html: createSandboxHtml(session.manifest, session.bundle) }}
          javaScriptEnabled
          domStorageEnabled={false}
          cacheEnabled={false}
          incognito
          originWhitelist={['about:blank']}
          onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
          onLoad={() => {
            mobileScriptExtensionExecutor.attach(session.manifest.id, (message) => {
              webviews.current
                .get(session.manifest.id)
                ?.injectJavaScript(`window.__readoReceive(${message}); true;`);
            });
          }}
          onMessage={(event) => {
            void mobileScriptExtensionExecutor.receive(
              session.manifest.id,
              event.nativeEvent.data
            );
          }}
          onError={(event) => {
            void mobileScriptExtensionExecutor.receive(
              session.manifest.id,
              JSON.stringify({
                type: 'boot-error',
                error: event.nativeEvent.description || 'Extension sandbox failed to load.',
              })
            );
          }}
          style={{ width: 1, height: 1 }}
        />
      ))}
    </View>
  );
}
