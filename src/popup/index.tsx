/**
 * Popup entry point — renders the React app into the extension popup.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './popup.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Debug-only: install the page relay so the log-server can inspect this
// page via the worker (see src/utils/debug-relay.ts). Dead-code-eliminated
// in production builds because DEBUG_LOG_FORWARD is false there.
if (import.meta.env.DEBUG_LOG_FORWARD) {
  void import('@/utils/debug-relay').then(({ setupDebugRelay }) => setupDebugRelay());
}