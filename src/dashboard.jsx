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
        // QR/PDF are optional enhancements. A blocked CDN must not prevent the
        // core dashboard and its pages from starting.
        await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js')
          .catch(error => console.warn('[Strap] QR code helper unavailable; continuing without it.', error));
        await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
          .catch(error => console.warn('[Strap] PDF helper unavailable; continuing without it.', error));
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
