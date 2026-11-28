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

const RECORD_PAGE_CONFIG = {
  customers: { title: 'Customers', icon: 'users', illustration: 'customers', emptyTitle: 'No customers yet', emptyText: 'Add customers to keep track of who buys from you.', action: 'Add customer', formTitle: 'Add customer', fields: [{ label: 'Full name', type: 'text', placeholder: 'e.g. Ada Okafor', required: true }, { label: 'Email', type: 'email', placeholder: 'Optional' }, { label: 'Phone', type: 'tel', placeholder: 'Optional' }] },
  purchase: { title: 'Purchase orders', icon: 'clipboard', illustration: 'purchase', emptyTitle: 'Restock with confidence', emptyText: 'Create purchase orders to order stock from your suppliers and track what’s on the way.', action: 'Create purchase order', formTitle: 'Create purchase order', fields: [{ label: 'Supplier', type: 'text', placeholder: 'e.g. Lagos Textiles', required: true }, { label: 'Expected date', type: 'date', placeholder: '' }, { label: 'Notes', type: 'text', placeholder: 'Optional' }] }
};

function RecordForm({ config, onClose, onSave }) {
  const [values, setValues] = useState(config.fields.map(() => ''));
  const [invalid, setInvalid] = useState(false);
  const update = (index, value) => setValues(current => current.map((item, i) => i === index ? value : item));
  const submit = event => { event.preventDefault(); if (!values[0].trim()) { setInvalid(true); return; } onSave(values); onClose(); };
  return <div className="pm-layer on" onClick={event => { if (event.target.closest('.pm-scrim') || event.target.closest('[data-c]')) onClose(); }}>
    <div className="pm-scrim" />
    <section className="pm-sheet" role="dialog" aria-modal="true" aria-label={config.formTitle}>
      <div className="pm-grab"><i /></div>
      <div className="pm-sh"><h2>{config.formTitle}</h2><button type="button" className="pm-x" data-c aria-label="Close" dangerouslySetInnerHTML={{ __html: window.StrapUI?.ic('close', 20, 2.2) || '×' }} /></div>
      <form className="pg-form" onSubmit={submit} noValidate>
        {config.fields.map((field, index) => <label className={'pm-fl' + (invalid && field.required && !values[index].trim() ? ' bad' : '')} key={field.label}>
          <span>{field.label}</span><input type={field.type} placeholder={field.placeholder} value={values[index]} onChange={event => update(index, event.target.value)} autoComplete="off" required={!!field.required} />
        </label>)}
        <button type="submit" className="pm-add wide">{config.action}</button>
      </form>
    </section>
  </div>;
}

function RecordPage({ id, ctx, version }) {
  const config = RECORD_PAGE_CONFIG[id], key = id === 'customers' ? 'customers' : 'purchase';
  const [rows, setRows] = useState(() => window.StrapStore.records(key));
  const [formOpen, setFormOpen] = useState(false);
  useEffect(() => { setRows(window.StrapStore.records(key)); }, [key, version]);
  const refresh = () => setRows(window.StrapStore.records(key));
  const save = values => {
    if (id === 'customers') {
      const name = values[0].trim(), email = values[1].trim(), phone = values[2].trim();
      const duplicate = rows.find(row => (phone && String(row.phone || '').replace(/\\D/g, '') === phone.replace(/\\D/g, '')) || (email && String(row.email || '').toLowerCase() === email.toLowerCase()));
      if (duplicate) { ctx.toast('A customer with that phone or email already exists'); return; }
      window.StrapStore.addRecord(key, { name, email, phone });
    } else window.StrapStore.addRecord(key, { supplier: values[0].trim(), expectedDate: values[1], notes: values[2] });
    refresh(); ctx.toast('Saved to your store');
  };
  const remove = row => { window.StrapStore.removeRecord(key, row.id); refresh(); ctx.toast('Removed'); };
  const icon = window.StrapUI?.ic(config.icon, 24, 1.8) || '', emptyArt = window.StrapUI?.illus(config.illustration) || '';
  return <React.Fragment>
    <header className="pm-head"><h1 className="pm-title"><span className="pm-tico" dangerouslySetInnerHTML={{ __html: icon }} />{config.title}</h1>{rows.length > 0 && <button type="button" className="pm-add sm" onClick={() => setFormOpen(true)}>Add</button>}</header>
    {rows.length ? <ul className="pg-list">{rows.map((row, index) => {
      const title = id === 'customers' ? row.name : row.supplier;
      const detail = id === 'customers' ? [row.phone, row.email].filter(Boolean).join(' · ') : [row.expectedDate, row.notes, row.status].filter(Boolean).join(' · ');
      return <li className="pg-row" key={row.id || index}><span className="pg-ico" dangerouslySetInnerHTML={{ __html: icon }} /><div><b>{title || ''}</b>{detail && <small>{detail}</small>}</div><button type="button" className="pg-x" aria-label="Remove" onClick={() => remove(row)}><span dangerouslySetInnerHTML={{ __html: window.StrapUI?.ic('trash', 20, 1.8) || '×' }} /></button></li>;
    })}</ul> : <div className="pg-empty"><span dangerouslySetInnerHTML={{ __html: emptyArt }} /><h2>{config.emptyTitle}</h2><p>{config.emptyText}</p><button type="button" className="pm-add" onClick={() => setFormOpen(true)}><span dangerouslySetInnerHTML={{ __html: window.StrapUI?.ic('plus', 20, 2.2) || '+' }} />{config.action}</button></div>}
    {formOpen && <RecordForm config={config} onClose={() => setFormOpen(false)} onSave={save} />}
  </React.Fragment>;
}

export function installReactUI() {
  const toastHost = document.getElementById('toast');
  let toastRoot = null;
  let toastTimer = null;
  const toast = message => {
    if (!toastHost) return;
    if (!toastRoot) toastRoot = createRoot(toastHost);
    window.clearTimeout(toastTimer);
    toastHost.classList.add('on');
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

  const mountedPages = new WeakMap();
  const mountListPage = (id, host, ctx) => {
    const existing = mountedPages.get(host); if (existing) return existing;
    const root = createRoot(host); let refresh = () => {};
    function Mounted() { const [version, setVersion] = useState(0); refresh = () => setVersion(value => value + 1); return <RecordPage id={id} ctx={ctx} version={version} />; }
    flushSync(() => root.render(<Mounted />));
    const api = { onShow: () => refresh() }; mountedPages.set(host, api); return api;
  };
  window.StrapReactUI = Object.freeze({ toast, layer, mountListPage });
}
