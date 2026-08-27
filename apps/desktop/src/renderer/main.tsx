import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { colors } from '@tomeio/design';
import { App } from './app';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root element is missing.');

document.documentElement.style.setProperty('--background', colors.background);
document.documentElement.style.setProperty('--surface', colors.surface);
document.documentElement.style.setProperty('--border', colors.border);
document.documentElement.style.setProperty('--text', colors.text);
document.documentElement.style.setProperty('--text-muted', colors.textMuted);
document.documentElement.style.setProperty('--accent', colors.accent);
document.documentElement.style.setProperty('--accent-muted', colors.accentMuted);
document.documentElement.style.setProperty('--on-accent', colors.onAccent);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
