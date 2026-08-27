import { useEffect, useRef, useState } from 'react';

import {
  createSandboxHtml,
  mobileScriptExtensionExecutor,
} from '@/lib/script-extension-executor';

export function ExtensionSandboxes() {
  const [, render] = useState(0);
  const frames = useRef(new Map<string, HTMLIFrameElement>());

  useEffect(
    () => mobileScriptExtensionExecutor.subscribe(() => render((value) => value + 1)),
    []
  );

  const sessions = mobileScriptExtensionExecutor.snapshot();
  useEffect(() => {
    const active = new Set(sessions.map((session) => session.manifest.id));
    for (const [id, frame] of frames.current) {
      if (active.has(id)) continue;
      frame.remove();
      frames.current.delete(id);
      mobileScriptExtensionExecutor.detach(id);
    }

    const onMessage = (event: MessageEvent) => {
      const entry = [...frames.current.entries()].find(([, frame]) => frame.contentWindow === event.source);
      if (!entry || typeof event.data !== 'string') return;
      void mobileScriptExtensionExecutor.receive(entry[0], event.data);
    };
    window.addEventListener('message', onMessage);

    for (const session of sessions) {
      if (frames.current.has(session.manifest.id)) continue;
      const frame = document.createElement('iframe');
      frame.sandbox.add('allow-scripts');
      frame.hidden = true;
      frame.addEventListener('load', () => {
        mobileScriptExtensionExecutor.attach(session.manifest.id, (message) => {
          frame.contentWindow?.postMessage(JSON.parse(message), '*');
        });
      });
      frame.srcdoc = createSandboxHtml(session.manifest, session.bundle, 'web');
      frames.current.set(session.manifest.id, frame);
      document.body.appendChild(frame);
    }

    return () => window.removeEventListener('message', onMessage);
  }, [sessions]);

  useEffect(
    () => () => {
      for (const [id, frame] of frames.current) {
        frame.remove();
        mobileScriptExtensionExecutor.detach(id);
      }
      frames.current.clear();
    },
    []
  );

  return null;
}
