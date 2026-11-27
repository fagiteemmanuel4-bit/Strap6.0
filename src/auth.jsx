import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

function AuthRuntime() {
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await import('../api.js');
        await import('../picker.js');
        await import('../script.js');
      } catch (error) {
        if (active) console.error('[Strap] Could not start the authentication flow.', error);
      }
    })();
    return () => { active = false; };
  }, []);
  return null;
}

const host = document.getElementById('react-runtime');
if (host) createRoot(host).render(<AuthRuntime />);
