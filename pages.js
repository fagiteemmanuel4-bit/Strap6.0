/* Strap – every sidebar page except Products: Orders, Collections, Inventory, Purchase orders, Transfers,
   Gift cards, Customers, Growth, Online store, MCP, Settings, plus today's sales, sales history and the new-sale page.
   Lists are kept in memory for now – swap `store` for real API calls later. */
window.StrapPages = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const U = StrapUI, ic = U.ic, esc = U.esc;
  const store = {};

  const CFG = {
    orders: { t: 'Orders', i: 'inbox', ill: 'orders', h: 'No orders yet', p: 'New orders show up here as soon as you make a sale.' },
    collections: { t: 'Collections', i: 'collections', ill: 'collections', h: 'Group your products', p: 'Collections organise your products into groups like “New in” or “Best sellers”. Create one, then pick it when you add a product.', cta: 'Create collection',
      fields: [['Collection name', 'text', 'e.g. New arrivals'], ['Description', 'text', 'Optional']] },
    purchase: { t: 'Purchase orders', i: 'clipboard', ill: 'purchase', h: 'Restock with confidence', p: 'Create purchase orders to order stock from your suppliers and track what’s on the way.', cta: 'Create purchase order',
      fields: [['Supplier', 'text', 'e.g. Lagos Textiles'], ['Expected date', 'date', ''], ['Notes', 'text', 'Optional']] },
    transfers: { t: 'Transfers', i: 'transfer', ill: 'transfers', h: 'Move stock between places', p: 'Transfer inventory between your shop, warehouse and other locations.', cta: 'Create transfer',
      fields: [['From', 'text', 'e.g. Warehouse'], ['To', 'text', 'e.g. Shop location'], ['Notes', 'text', 'Optional']] },
    gift: { t: 'Gift cards', i: 'gift', ill: 'gift', h: 'Give customers a QR gift card or discount pass', p: 'Create a receipt-style slip customers can show at checkout. Scan its QR code to apply the saved value or discount.', cta: 'Create gift card',
      fields: [['Card type', 'select', '', [{ value: 'value', label: 'Gift card — Naira balance' }, { value: 'discount', label: 'Discount pass — percentage' }]], ['Amount', 'number', 'Enter amount'], ['Customer email', 'email', 'Optional']] },
    customers: { t: 'Customers', i: 'users', ill: 'customers', h: 'No customers yet', p: 'Add customers to keep track of who buys from you.', cta: 'Add customer',
      fields: [['Full name', 'text', 'e.g. Ada Okafor'], ['Email', 'email', 'Optional'], ['Phone', 'tel', 'Optional']] }
  };
  let ctxRef = null, codeN = 0;
  const genCode = () => 'GC-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase());

  const head = (i, t, right = '', back) => `<header class="pm-head">${back ? `<button type="button" class="pm-round" data-go="${back}" aria-label="Back">${ic('back', 22, 2.2)}</button>` : ''}<h1 class="pm-title">${back ? '' : `<span class="pm-tico">${ic(i, 24, 1.8)}</span>`}${t}</h1>${right}</header>`;
  const empty = (kind, h, p, cta) => `<div class="pg-empty">${U.illus(kind)}<h2>${h}</h2><p>${p}</p>${cta || ''}</div>`;

  // bottom-sheet form
  function formSheet({ title, fields, cta = 'Save', values = [] }, onSave) {
    const wrap = document.createElement('div'); wrap.className = 'pm-layer';
    wrap.innerHTML = `<div class="pm-scrim"></div><section class="pm-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="pm-grab"><i></i></div>
      <div class="pm-sh"><h2>${esc(title)}</h2><button type="button" class="pm-x" data-c aria-label="Close">${ic('close', 20, 2.2)}</button></div>
      <div class="pg-form">${fields.map((f, i) => `<label class="pm-fl"><span>${f[0]}</span>${f[1] === 'select' ? `<select>${(f[3] || []).map(o => `<option value="${esc(o.value)}" ${String(values[i] || f[3][0]?.value) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>` : `<input type="${f[1]}" placeholder="${esc(f[2])}" value="${esc(values[i] || '')}" ${f[1] === 'number' ? 'inputmode="decimal" min="0" step="0.01"' : ''} autocomplete="off">`}</label>`).join('')}
      <button type="button" class="pm-add wide" data-s>${cta}</button></div></section>`;
    document.body.appendChild(wrap); document.body.classList.add('pm-open'); void wrap.offsetWidth; wrap.classList.add('on');
    const close = () => { wrap.classList.remove('on'); document.body.classList.remove('pm-open'); setTimeout(() => wrap.remove(), 380); };
    const first = $('input,select', wrap)[0]; setTimeout(() => first && first.focus(), 350);
    wrap.addEventListener('click', e => {
      if (e.target.closest('.pm-scrim') || e.target.closest('[data-c]')) return close();
      if (e.target.closest('[data-s]')) {
        const v = $('input,select', wrap).map(i => i.value.trim());
        if (!v[0] || (fields.some(f => f[1] === 'number') && !(+v[1] > 0))) { const target = !v[0] ? first : $('input[type=number]', wrap); const fl = target.closest('.pm-fl'); fl.classList.add('bad'); setTimeout(() => fl.classList.remove('bad'), 900); return; }
        close(); onSave(v);
      }
    });
    const typeSelect = $('select', wrap), amountInput = $('input[type="number"]', wrap); if (typeSelect && amountInput && title === 'Create gift card') { const amountLabel = amountInput.closest('.pm-fl').querySelector('span'); const updateAmountMode = () => { const discount = typeSelect.value === 'discount'; amountLabel.textContent = discount ? 'Discount percentage (1–100%)' : 'Gift-card value (₦)'; amountInput.placeholder = discount ? 'e.g. 50' : 'e.g. 5000'; amountInput.max = discount ? '100' : ''; amountInput.step = discount ? '1' : '0.01'; amountInput.setAttribute('aria-label', discount ? 'Discount percentage' : 'Gift-card value in Naira'); }; typeSelect.addEventListener('change', updateAmountMode); updateAmountMode(); } wrap.addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-s]', wrap).click(); });
  }

  function list(id, root, ctx) {
    const c = CFG[id], key = ({ purchase: 'purchase', transfers: 'transfers', gift: 'gift', customers: 'customers' })[id];
    const rows = StrapStore.records(key);
    const add = () => formSheet({ title: c.cta, fields: c.fields, cta: c.cta }, v => {
      if (id === 'customers') {
        const name = v[0].trim(), email = v[1].trim(), phone = v[2].trim();
        if (!name) return ctx.toast('Enter the customer name');
        const duplicate = rows.find(x => (phone && String(x.phone || '').replace(/\\D/g, '') === phone.replace(/\\D/g, '')) || (email && String(x.email || '').toLowerCase() === email.toLowerCase()));
        if (duplicate) return ctx.toast('A customer with that phone or email already exists');
        StrapStore.addRecord(key, { name, email, phone });
      } else if (id === 'purchase') StrapStore.addRecord(key, { supplier: v[0], expectedDate: v[1], notes: v[2] });
      else if (id === 'transfers') StrapStore.addRecord(key, { from: v[0], to: v[1], notes: v[2], status: 'draft' });
      else if (id === 'gift') { const type = String(v[0] || '').trim().toLowerCase(); const amount = Number(v[1]); if (!['value', 'discount'].includes(type)) return ctx.toast('Choose a gift card or discount pass'); if (!Number.isFinite(amount) || !(amount > 0) || (type === 'discount' && amount > 100)) return ctx.toast(type === 'discount' ? 'Discount must be between 1% and 100%' : 'Enter a gift-card value above ₦0'); StrapStore.addRecord(key, { type, value: amount, balance: type === 'value' ? amount : 0, email: v[2], code: genCode(), status: 'active' }); }
      draw(); ctx.toast('Saved to your store');
    });
    function draw() {
      const cta = c.cta ? `<button type="button" class="pm-add" data-add>${ic('plus', 20, 2.2)} ${c.cta}</button>` : '';
      root.innerHTML = head(c.i, c.t, rows.length && c.cta ? `<button type="button" class="pm-add sm" data-add>Add</button>` : '') +
        (rows.length ? `<ul class="pg-list">${rows.map((v, i) => {
          const f = id === 'customers' ? { t: v.name, s: [v.phone, v.email].filter(Boolean).join(' · ') }
            : id === 'purchase' ? { t: v.supplier, s: [v.expectedDate, v.notes, v.status].filter(Boolean).join(' · ') }
            : id === 'transfers' ? { t: `${v.from} → ${v.to}`, s: [v.status, v.notes].filter(Boolean).join(' · ') }
            : { t: v.type === 'discount' ? `${v.value}% discount pass` : `${ctxRef.money(v.balance ?? v.value ?? 0)} gift card`, s: [v.code, v.email, v.status, v.type === 'value' ? `Issued ${ctxRef.money(v.value || 0)}` : 'QR receipt'].filter(Boolean).join(' · ') };
          return `<li class="pg-row"><span class="pg-ico">${ic(c.i, 22, 1.8)}</span><div><b>${esc(f.t || '')}</b>${f.s ? `<small>${esc(f.s)}</small>` : ''}</div>${id === 'gift' ? `<button type="button" class="gc-view" data-view="${esc(v.id)}">View slip</button>` : ''}<button type="button" class="pg-x" data-del="${esc(v.id || i)}" aria-label="Remove">${ic('trash', 20, 1.8)}</button></li>`;
        }).join('')}</ul>`
          : empty(c.ill, c.h, c.p, cta));
    }
    root.addEventListener('click', e => {
      if (e.target.closest('[data-add]')) add();
      const view = e.target.closest('[data-view]'); if (view) { const card = rows.find(x => x.id === view.dataset.view); if (card) giftSlip(card, ctxRef); }
      const d = e.target.closest('[data-del]'); if (d) { StrapStore.removeRecord(key, d.dataset.del); draw(); ctx.toast('Removed'); }
    });
    draw();
  }

  function giftSlip(card, ctx) {
    const layer = document.createElement('div'); layer.className = 'gc-layer';
    const amount = card.type === 'discount' ? card.value + '% OFF' : ctx.money(card.balance ?? card.value ?? 0);
    layer.innerHTML = `<div class="gc-shade" data-gc-close></div><section class="gc-slip" role="dialog" aria-modal="true" aria-label="Gift card receipt">
      <div class="gc-slip-top"><span>STRAP · GIFT RECEIPT</span><button type="button" data-gc-close aria-label="Close">×</button></div>
      <div class="gc-slip-mark">GIFT <b>PASS</b></div><strong class="gc-amount">${esc(amount)}</strong>
      <p class="gc-kind">${card.type === 'discount' ? 'Discount on your next purchase' : 'Available gift-card balance'}</p>
      <div class="gc-qr" id="gc-slip-qr"></div><b class="gc-code">${esc(card.code)}</b>
      <p class="gc-help">Show this receipt or let the cashier scan the QR code at checkout.</p>
      <div class="gc-dash"></div><div class="gc-slip-foot"><span>STATUS</span><b>${esc(card.status || 'active').toUpperCase()}</b></div>
      <div class="gc-slip-actions"><button type="button" data-gc-print>Print receipt</button><button type="button" data-gc-done>Done</button></div>
    </section>`;
    document.body.appendChild(layer); document.body.classList.add('pm-open');
    const qr = $('#gc-slip-qr', layer);
    if (window.QRCode) new QRCode(qr, { text: 'STRAPGC|' + card.code, width: 176, height: 176, correctLevel: QRCode.CorrectLevel.M });
    const close = () => { layer.remove(); document.body.classList.remove('pm-open'); };
    layer.addEventListener('click', e => {
      if (e.target.closest('[data-gc-close],[data-gc-done]')) return close();
      if (e.target.closest('[data-gc-print]')) {
        const canvas = $('canvas', qr), img = $('img', qr), src = canvas ? canvas.toDataURL('image/png') : img ? img.src : '';
        const w = window.open('', '_blank'); if (!w) return ctx.toast('Allow pop-ups to print this receipt');
        w.document.write('<!doctype html><html><head><title>Gift receipt</title><style>body{font:14px Arial;display:grid;place-items:center;padding:24px}.slip{width:300px;text-align:center;border:1px dashed #777;padding:22px}.amount{font-size:32px;font-weight:bold;margin:20px}.qr{width:176px;height:176px;margin:20px auto}img{width:176px}</style></head><body><main class="slip"><b>STRAP · GIFT RECEIPT</b><div class="amount">'+amount+'</div><p>'+ (card.type === 'discount' ? 'Discount pass' : 'Gift-card balance') +'</p><div class="qr">'+(src ? '<img src="'+src+'">' : '')+'</div><b>'+card.code+'</b><p>Show this receipt at checkout.</p></main><script>window.onload=()=>window.print()<\/script></body></html>'); w.document.close();
      }
    });
  }

  // Collections belong to the Products section: create them here, then choose them when adding a product
  function collections(root, ctx) {
    const CS = StrapStore.collections, K = StrapKit, P = ctx.products();
    const n = c => P.countIn(c.name);
    const plural = k => `${k} product${k === 1 ? '' : 's'}`;
    const add = () => formSheet({ title: 'Create collection', fields: CFG.collections.fields, cta: 'Create collection' }, v => {
      if (CS.find(v[0])) return ctx.toast('You already have a collection with that name');
      CS.add(v[0], v[1] || ''); draw(); ctx.toast('Collection created');
    });
    function draw() {
      const rows = CS.all(), cta = `<button type="button" class="pm-add" data-add>${ic('plus', 20, 2.2)} Create collection</button>`;
      root.innerHTML = head('collections', 'Collections', rows.length ? `<button type="button" class="pm-add sm" data-add>Add</button>` : '') + (rows.length ? `
        <p class="pg-note">${ic('info', 18, 2)}<span>Tap a collection to choose which products belong to it. You can also pick collections when you add or edit a product.</span></p>
        <ul class="pg-list">${rows.map(c => { const k = n(c); return `<li class="pg-row pg-col" data-id="${c.id}" tabindex="0" role="button" aria-label="Manage ${esc(c.name)}"><span class="pg-ico">${ic('collections', 22, 1.8)}</span>
          <div><b>${esc(c.name)}</b><small>${k ? plural(k) : 'No products yet'}${c.description ? ' · ' + esc(c.description) : ''}</small></div>
          <button type="button" class="pg-x" data-del="${c.id}" aria-label="Delete ${esc(c.name)}">${ic('trash', 20, 1.8)}</button></li>`; }).join('')}</ul>`
        : empty('collections', CFG.collections.h, CFG.collections.p, cta));
    }
    async function manage(c) {
      const items = P.items();
      if (!items.length) { ctx.toast('Add a product first, then place it in a collection'); return; }
      const res = await StrapPicker.pick({
        title: c.name, multi: true, value: P.inCollection(c.name), done: 'Save', search: items.length > 8,
        options: items.map(p => ({ v: p.id, l: p.title, s: p.category || (p.status === 'draft' ? 'Draft' : 'Active'), img: p.image || '', ic: p.image ? '' : 'inventory', tone: 'n' }))
      });
      if (!res) return; P.setCollection(c.name, res); draw(); ctx.toast('Collection updated');
    }
    root.addEventListener('click', async e => {
      if (e.target.closest('[data-add]')) return add();
      const d = e.target.closest('[data-del]');
      if (d) {
        const c = CS.all().find(x => x.id === d.dataset.del); if (!c) return;
        const ok = await K.confirm({ title: 'Delete this collection?', body: `<b>${esc(c.name)}</b> will be removed. Your products stay in your catalogue.`, ok: 'Delete', cancel: 'Keep it', icon: 'trash', danger: true });
        if (ok) { CS.remove(c.id); P.dropCollection(c.name); draw(); ctx.toast('Collection deleted'); }
        return;
      }
      const r = e.target.closest('.pg-col'); if (r) { const c = CS.all().find(x => x.id === r.dataset.id); if (c) manage(c); }
    });
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.pg-col')) e.target.click(); });
    P.onChange(draw); draw(); return { onShow: draw };
  }

  function inventory(root, ctx) {
    const P = ctx.products();
    function draw() {
      const items = P.items(), tracked = items.filter(p => p.tracked), units = tracked.reduce((a, p) => a + p.qty, 0), out = tracked.filter(p => !p.qty).length;
      root.innerHTML = head('inventory', 'Inventory') + (items.length ? `
        <div class="pg-sum"><div><b>${units}</b><small>Units in stock</small></div><div><b>${out}</b><small>Out of stock</small></div><div><b>${items.length - tracked.length}</b><small>Not tracked</small></div></div>
        <ul class="pg-list">${items.map(p => `<li class="pg-row" data-id="${p.id}"><span class="pg-ico">${p.image ? `<img src="${esc(p.image)}" alt="">` : ic('image', 22, 1.6)}</span><div><b>${esc(p.title)}</b><small>${p.tracked ? (p.qty ? `${p.qty} in stock` : 'Out of stock') : 'Inventory not tracked'}</small></div>
          ${p.tracked ? `<div class="pm-step"><button type="button" data-q="-1" aria-label="Decrease">−</button><span class="pg-q">${p.qty}</span><button type="button" data-q="1" aria-label="Increase">+</button></div>` : ''}</li>`).join('')}</ul>`
        : empty('inventory', 'No inventory yet', 'Products you add will show up here so you can keep an eye on your stock.', `<button type="button" class="pm-add" data-addp>${ic('plus', 20, 2.2)} Add product</button>`));
    }
    root.addEventListener('click', e => {
      if (e.target.closest('[data-addp]')) { ctx.go('products'); setTimeout(() => P.openAdd(), 300); return; }
      const b = e.target.closest('[data-q]'); if (!b) return;
      const id = b.closest('.pg-row').dataset.id, p = P.items().find(x => x.id === id); if (!p) return;
      P.setQty(id, p.qty + +b.dataset.q); draw();
    });
    draw(); return { onShow: draw };
  }

  function growth(root) {
    root.innerHTML = head('growth', 'Growth') + empty('growth', 'Your growth starts here', 'Visitors, conversion and best sellers will show up once you start selling.') +
      `<div class="pg-locks">${[['users', 'Visitors'], ['receipt', 'Conversion rate'], ['tag', 'Top products']].map(([i, t]) => `<div class="pg-lock"><span>${ic(i, 22, 1.8)}</span><b>${t}</b><small>${ic('lock', 14, 2)} After your first sales</small></div>`).join('')}</div>`;
  }
  function online(root, ctx) {
    root.innerHTML = head('store', 'Online store') + empty('online', 'Your online store is coming soon', 'Soon you’ll be able to launch a storefront straight from Strap.', `<button type="button" class="pm-add" data-n>Notify me</button>`);
    $('[data-n]', root).addEventListener('click', e => { e.currentTarget.textContent = 'You’re on the list'; e.currentTarget.disabled = true; ctx.toast('We’ll let you know when it’s ready'); });
  }
  const soon = (ic, t, ill, h, p) => (root, ctx) => {
    root.innerHTML = head(ic, t) + empty(ill, h, p, `<button type="button" class="pm-add" data-n>Notify me</button>`);
    $('[data-n]', root).addEventListener('click', e => { e.currentTarget.textContent = 'You’re on the list'; e.currentTarget.disabled = true; ctx.toast('We’ll let you know when it’s ready'); });
  };
  const activity = soon('clock', 'Activity log', 'activity', 'Activity log is coming soon', 'Soon you’ll see who did what in your store, from sales to stock changes.');
  const devices = soon('phone', 'Devices & printers', 'devices', 'Devices and printers are coming soon', 'Soon you’ll connect receipt printers and scanners and manage signed-in devices.');
  const orders = soon('receipt', 'Orders', 'online', 'Orders are coming soon', 'Online orders will show up here once online stores launch.');
  function mcp(root, ctx) {
    root.innerHTML = head('plug', 'MCP') + empty('mcp', 'Connect Strap to your AI tools', 'MCP lets assistants like Claude read your products and sales securely. Set-up is coming soon.', `<button type="button" class="pm-imp" data-n>${ic('copy', 20, 2)} Copy server address</button>`) +
      `<div class="pg-rows"><div class="pg-r static"><span>Status</span><b class="pg-pill">Not connected</b></div></div>`;
    $('[data-n]', root).addEventListener('click', () => ctx.toast('Your MCP address will be available at launch'));
  }
  const MAP = { 'sales-today': (r, c) => StrapSales.today(r, c), 'sales-history': (r, c) => StrapSales.history(r, c), 'new-sale': (r, c) => StrapSales.mount(r, c), growth, online, mcp, activity, devices, settings: (r, c) => StrapSettings.mount(r, c), inventory };
  function build(id, root, ctx) {
    ctxRef = ctx;
    if (id === 'collections') return collections(root, ctx);
    if (CFG[id] && id !== 'orders') return list(id, root, ctx) || {};
    if (id === 'orders') return orders(root, ctx);
    return (MAP[id] && MAP[id](root, ctx)) || {};
  }
  return { build };
})();
