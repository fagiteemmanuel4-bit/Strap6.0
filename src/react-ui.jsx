import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

function ToastView({ message }) {
  useEffect(() => {
    const host = document.getElementById('toast');
    if (!host) return undefined;
    host.classList.add('on');
    const timer = window.setTimeout(() => host.classList.remove('on'), 2600);
    return () => window.clearTimeout(timer);
  }, [message]);
  return <span>{message}</span>;
}

function PickerLayer({ cls, title, html, closeIcon, onClose, setRefs }) {
  return (
    <div
      className={`dd-layer ${cls}`}
      ref={node => setRefs(node, node?.querySelector('.dd-b') || null)}
      onClick={event => {
        if (event.target.closest('.dd-scrim') || event.target.closest('[data-x]')) onClose();
      }}
    >
      <div className="dd-scrim" />
      <section className="dd-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex="-1">
        <div className="dd-grab"><i /></div>
        <header className="dd-h">
          <h2>{title}</h2>
          <button type="button" className="dd-x" data-x aria-label="Close" dangerouslySetInnerHTML={{ __html: closeIcon }} />
        </header>
        <div className="dd-b" dangerouslySetInnerHTML={{ __html: html }} />
      </section>
    </div>
  );
}

export function installReactUI() {
  const toastHost = document.getElementById('toast');
  let toastRoot = null;
  let toastTimer = null;
  const toast = message => {
    if (!toastHost) return;
    if (!toastRoot) toastRoot = createRoot(toastHost);
    window.clearTimeout(toastTimer);
    flushSync(() => toastRoot.render(<ToastView message={String(message ?? '')} />));
    // Re-rendering the same message does not change its React effect dependency.
    toastTimer = window.setTimeout(() => toastHost.classList.remove('on'), 2600);
  };

  const layer = ({ cls = '', title = '', html = '', closeIcon = '' } = {}) => {
    const host = document.createElement('div');
    host.style.display = 'contents';
    document.body.appendChild(host);
    const root = createRoot(host);
    let wrapper = null;
    let body = null;
    let close;
    const setRefs = (nextWrapper, nextBody) => {
      wrapper = nextWrapper;
      body = nextBody;
    };
    const onClose = () => {
      if (wrapper) wrapper.classList.remove('on');
      window.setTimeout(() => {
        root.unmount();
        host.remove();
      }, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 360);
    };
    flushSync(() => root.render(
      <PickerLayer cls={cls} title={title} html={html} closeIcon={closeIcon} onClose={() => close?.()} setRefs={setRefs} />
    ));
    void wrapper?.offsetWidth;
    wrapper?.classList.add('on');
    const api = {
      el: wrapper,
      body,
      onClose: null,
      close() {
        onClose();
        if (api.onClose) api.onClose();
      }
    };
    close = api.close;
    return api;
  };

  window.StrapReactUI = Object.freeze({ toast, layer });
}
