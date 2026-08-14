/**
 * Dashboard entry point — renders the React app into the new tab page.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './dashboard.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);