import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { installReactUI } from './react-ui.jsx';

installReactUI();

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find(script => script.src === src);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(script);
  });
}

function DashboardRuntime() {
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await import('../api.js');
        await import('../picker.js');
        await import('../ui.js');
        await import('../store.js');
        await import('../gift-card-rules.js');
        await import('../kit.js');
        await import('../receipt.js');
        await import('../security.js');
        await import('../products.js');
        await import('../sales.js');
        await import('../settings.js');
        await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
        await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await import('../features.js');
        await import('../pages.js');
        await import('../dashboard.js');
      } catch (error) {
        if (active) console.error('[Strap] Could not start the dashboard.', error);
      }
    })();
    return () => { active = false; };
  }, []);
  return null;
}

const host = document.getElementById('react-runtime');
if (host) createRoot(host).render(<DashboardRuntime />);
