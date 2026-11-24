/* Strap – the sales page. Lists every product with its stock, tap or scan to add to the cart, hold sales,
   sell on credit (customer details + due date + reminders), complete with a beep and vibration, and close
   sales for the day behind the 4-digit activity PIN. Also exports today's sales and sales history views. */
window.StrapSales = (() => {
  const { $, $$, el, sleep, reduced, sheet, confirm, fx } = StrapKit;
  const U = StrapUI, ic = U.ic, esc = U.esc;
  const S = StrapStore, R = StrapReceipt, Sec = StrapSec;

  const PAY = [['cash', 'Cash', 'cash'], ['card', 'Card', 'card'], ['transfer', 'Transfer', 'transfer'], ['credit', 'On credit', 'book']];
  const tm = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dmy = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const ymd = d => S.dayKey(d.getTime());
  const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const initials = n => (n.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function mount(root, ctx) {
    const money = n => ctx.money(n);
    const P = () => ctx.products();
    const items = () => ((P() && P().items()) || []).filter(p => !p.status || p.status === 'active');
    let q = '', cart = [], draft = { method: 'cash', name: '', phone: '', email: '', due: '', paid: '' }, cartSheet = null, scn = null;

    const cartTotal = () => cart.reduce((a, l) => a + l.price * l.qty, 0);
    const cartCount = () => cart.reduce((a, l) => a + l.qty, 0);
    const lineOf = id => cart.find(l => l.id === id);
    const prod = id => items().find(p => p.id === id);
    const maxOf = p => p && p.tracked ? p.qty : Infinity;
    const findByCode = code => { const c = String(code || '').trim().toLowerCase(); if (!c) return null; return items().find(p => [p.barcode, p.sku, p.id].some(v => v && String(v).toLowerCase() === c)); };

    /* =============== cart operations =============== */
    function add(p, n = 1, quiet) {
      const have = (lineOf(p.id) || { qty: 0 }).qty;
      if (have + n > maxOf(p)) { fx('err'); ctx.toast(p.qty > 0 ? `Only ${p.qty} in stock` : `${p.title} is out of stock`); return false; }
      const l = lineOf(p.id);
      if (l) l.qty += n; else cart.push({ id: p.id, title: p.title, price: +p.price || 0, qty: n, sku: p.sku || '' });
      if (!quiet) fx('add');
      sync(p.id); return true;
    }
    function setQty(id, qty) {
      const p = prod(id), l = lineOf(id); if (!l) return;
      if (qty <= 0) cart = cart.filter(x => x !== l);
      else if (qty > maxOf(p)) { fx('err'); ctx.toast(`Only ${p.qty} in stock`); return; }
      else l.qty = qty;
      sync(id);
    }
    // refresh everything that shows the cart
    function sync(id) {
      const row = id && $(`.sx-p[data-id="${CSS.escape(id)}"]`, root);
      if (row) { drawRow(row, prod(id)); if (!reduced()) { row.classList.remove('hit'); void row.offsetWidth; row.classList.add('hit'); } }
      drawBar(); if (cartSheet) { if (!cart.length) cartSheet.close(); else drawCart(); } updateScn();
    }

    /* =============== page =============== */
    function render() {
      if (ctx.staff && ctx.staff.role==='Cashier' && !S.state.staffSalesOpen) return drawStaffWaiting();
      if (S.isClosed()) return drawClosed();
      root.innerHTML = `<div class="sx">
        <header class="sx-head">
          <button type="button" class="pm-round" ${ctx.staff && ctx.staff.role==='Cashier'?'data-staff-menu aria-label="Open menu"':'data-x aria-label="Close sale"'}>${ic(ctx.staff && ctx.staff.role==='Cashier'?'menu':'close', 22, 2.2)}</button>
          <h1 class="sx-title">Sales</h1>
          <div class="sx-tools"><button type="button" class="sx-chip" data-held>${ic('pause', 18, 2.2)}<span>Held</span><em hidden></em></button><button type="button" class="sx-chip" data-credit>${ic('book', 18, 2)}<span>Credit</span><em hidden></em></button></div>
        </header>
        <button type="button" class="sx-due" data-credit hidden></button>
        <div class="sx-find"><label class="pm-si">${ic('search', 18, 2)}<input type="search" id="sx-q" placeholder="Search products" autocomplete="off" value="${esc(q)}"></label>
          <button type="button" class="sx-scan" data-scan aria-label="Scan a product">${ic('scan', 26, 2)}</button></div>
        <ul class="sx-list" id="sx-list"></ul>
        <div class="sx-bar" id="sx-bar" hidden></div>
      </div>`;
      drawList(); drawBar(); drawCounts();
    }
    function drawCounts() {
      const h = $('[data-held] em', root), c = $('.sx-tools [data-credit] em', root), due = $('.sx-due', root); if (!h) return;
      const nh = S.state.held.length, nc = S.credits.open().length;
      h.hidden = !nh; h.textContent = nh; c.hidden = !nc; c.textContent = nc;
      const dues = S.credits.due(1);
      if (S.prefs.creditReminders && dues.length) {
        due.hidden = false;
        const over = dues.filter(x => S.credits.daysLeft(x) < 0).length;
        due.innerHTML = `<span class="sx-due-ic">${ic('clock', 20, 2)}</span><span><b>${plural(dues.length, 'credit')} ${over ? `overdue or due soon` : 'due soon'}</b><small>${money(dues.reduce((a, x) => a + S.credits.balance(x), 0))} to collect. Tap to remind customers.</small></span>${ic('chevR', 18, 2)}`;
      } else due.hidden = true;
    }
    function rowHtml(p) {
      const l = lineOf(p.id), tracked = !!p.tracked, out = tracked && p.qty <= 0, low = tracked && p.qty > 0 && p.qty <= 5;
      return `<span class="sx-img">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ic('image', 22, 1.6)}${l ? `<em class="sx-q">${l.qty}</em>` : ''}</span>
        <div class="sx-info"><b>${esc(p.title)}</b><span class="sx-price">${money(+p.price || 0)}</span></div>
        <div class="sx-stock${out ? ' out' : low ? ' low' : ''}${tracked ? '' : ' na'}" aria-label="${tracked ? p.qty + ' in stock' : 'Stock not tracked'}"><b>${tracked ? p.qty : '∞'}</b><small>${out ? 'out of stock' : tracked ? 'in stock' : 'not tracked'}</small></div>`;
    }
    function drawRow(li, p) { if (!p) return; li.className = 'sx-p' + (lineOf(p.id) ? ' in' : '') + (p.tracked && p.qty <= 0 ? ' dis' : ''); li.innerHTML = rowHtml(p); }
    function drawList() {
      const ul = $('#sx-list', root); if (!ul) return;
      const all = items(), t = q.trim().toLowerCase();
      const list = t ? all.filter(p => [p.title, p.sku, p.barcode, p.category].some(v => v && String(v).toLowerCase().includes(t))) : all;
      if (!all.length) { ul.innerHTML = `<li class="sx-empty">${U.illus('products')}<h2>No products to sell yet</h2><p>Add your products first, then they’ll show up here with their stock so you can start selling.</p><button type="button" class="pm-add" data-addp>${ic('plus', 20, 2.2)} Add product</button></li>`; return; }
      if (!list.length) { ul.innerHTML = `<li class="sx-empty sm"><h2>No match for “${esc(q)}”</h2><p>Check the spelling or scan the product instead.</p></li>`; return; }
      ul.innerHTML = list.map(p => `<li class="sx-p${lineOf(p.id) ? ' in' : ''}${p.tracked && p.qty <= 0 ? ' dis' : ''}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="Add ${esc(p.title)}">${rowHtml(p)}</li>`).join('');
    }
    function drawBar() {
      const bar = $('#sx-bar', root); if (!bar) return;
      const n = cartCount(); bar.hidden = !n; if (!n) return;
      bar.innerHTML = `<button type="button" class="sx-bar-in" data-cart><span class="sx-bag">${ic('bag', 24, 1.9)}<em>${n}</em></span><span class="sx-bt"><small>${plural(n, 'item')} in cart</small><b>${money(cartTotal())}</b></span><span class="sx-go">Review sale<i>${ic('arrowR', 20, 2.4)}</i></span></button>`;
    }

    root.addEventListener('click', e => {
      if (e.target.closest('[data-staff-menu]')) return ctx.openMenu ? ctx.openMenu() : null;
      if (e.target.closest('[data-staff-refresh]')) { location.reload(); return; }
      if (e.target.closest('[data-x]')) return closeFlow();
      if (e.target.closest('[data-scan]')) return openScanner();
      if (e.target.closest('[data-cart]')) return openCart();
      if (e.target.closest('[data-held]')) return openHeld();
      if (e.target.closest('[data-credit]')) return openCredit();
      if (e.target.closest('[data-addp]')) { ctx.go('products'); setTimeout(() => P() && P().openAdd(), 320); return; }
      if (e.target.closest('[data-reopen]')) return reopen();
      if (e.target.closest('[data-home]')) return ctx.go('home');
      const li = e.target.closest('.sx-p'); if (li) { const p = prod(li.dataset.id); if (p) add(p); }
    });
    root.addEventListener('keydown', e => {
      const li = e.target.closest && e.target.closest('.sx-p');
      if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const p = prod(li.dataset.id); if (p) add(p); }
      if (e.target.id === 'sx-q' && e.key === 'Enter') { const p = findByCode(e.target.value); if (p) { add(p); e.target.value = ''; q = ''; drawList(); } }
    });
    root.addEventListener('input', e => { if (e.target.id === 'sx-q') { q = e.target.value; drawList(); } });

    /* =============== cart sheet =============== */
    function openCart() {
      if (!cart.length || cartSheet) return;
      cartSheet = sheet({ title: 'Review sale', cls: 'sx-csheet', onClose: () => { cartSheet = null; } });
      cartSheet.body.addEventListener('click', onCart); cartSheet.body.addEventListener('input', onCartInput);
      drawCart();
    }
    function creditBalance() { return Math.max(0, cartTotal() - (+draft.paid || 0)); }
    function drawCart() {
      const b = cartSheet.body, total = cartTotal(), credit = draft.method === 'credit';
      b.innerHTML = `
        <ul class="sx-lines">${cart.map(l => `<li class="sx-line" data-id="${esc(l.id)}"><div><b>${esc(l.title)}</b><small>${money(l.price)} each</small></div>
          <div class="pm-step"><button type="button" data-q="-1" aria-label="Less">−</button><span class="pg-q">${l.qty}</span><button type="button" data-q="1" aria-label="More">+</button></div>
          <em>${money(l.price * l.qty)}</em><button type="button" class="pg-x" data-rm aria-label="Remove ${esc(l.title)}">${ic('trash', 19, 1.8)}</button></li>`).join('')}</ul>
        <div class="sx-total"><span>Total</span><b>${money(total)}</b></div>
        <p class="sx-lbl">How is the customer paying?</p>
        <div class="sx-pay" role="radiogroup">${PAY.map(([k, l, i]) => `<button type="button" role="radio" aria-checked="${draft.method === k}" class="sx-pm${draft.method === k ? ' on' : ''}" data-m="${k}">${ic(i, 22, 1.8)}<span>${l}</span></button>`).join('')}</div>
        ${credit ? `<div class="sx-credit"><p class="sx-note">${ic('info', 18, 2)}<span>We’ll remind you when this is due so you can contact the customer, and we’ll track what they still owe.</span></p>
          <label class="pm-fl"><span>Customer name *</span><input data-f="name" type="text" autocomplete="off" placeholder="e.g. Ada Okafor" value="${esc(draft.name)}"></label>
          <label class="pm-fl"><span>Phone number *</span><input data-f="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="e.g. 0803 000 0000" value="${esc(draft.phone)}"></label>
          <label class="pm-fl"><span>Email (optional)</span><input data-f="email" type="email" inputmode="email" autocomplete="off" placeholder="name@example.com" value="${esc(draft.email)}"></label>
          <label class="pm-fl"><span>Due date *</span><input data-f="due" data-dd="due" type="date" min="${S.dayKey()}" value="${esc(draft.due)}"></label>
          <div class="sx-chips">${[[3, 'In 3 days'], [7, 'In 1 week'], [14, 'In 2 weeks'], [30, 'In 1 month']].map(([n, l]) => `<button type="button" class="sx-qc${draft.due === plus(n) ? ' on' : ''}" data-due="${n}">${l}</button>`).join('')}</div>
          <label class="pm-fl"><span>Paid now (optional)</span><input data-f="paid" type="number" inputmode="decimal" min="0" placeholder="0" value="${esc(draft.paid)}"></label>
          <div class="sx-owe"><span>Balance owed</span><b id="sx-owe">${money(creditBalance())}</b></div><p class="sx-err" id="sx-err" role="alert"></p></div>` : ''}
        <div class="sx-acts"><button type="button" class="sx-hold" data-hold>${ic('pause', 20, 2.2)} Hold sale</button><button type="button" class="pm-add sx-done" data-done>${credit ? 'Record credit sale' : 'Complete sale'}<em>${money(total)}</em></button></div>`;
    }
    function onCart(e) {
      const li = e.target.closest('.sx-line'), id = li && li.dataset.id;
      const qb = e.target.closest('[data-q]'); if (qb && id) { fx('tap'); return setQty(id, lineOf(id).qty + +qb.dataset.q); }
      if (e.target.closest('[data-rm]') && id) { setQty(id, 0); return; }
      const m = e.target.closest('[data-m]'); if (m) { draft.method = m.dataset.m; fx('tap'); return drawCart(); }
      const dq = e.target.closest('[data-due]'); if (dq) { draft.due = plus(+dq.dataset.due); return drawCart(); }
      if (e.target.closest('[data-hold]')) return holdSale();
      if (e.target.closest('[data-done]')) return complete();
    }
    function onCartInput(e) {
      const f = e.target.dataset.f; if (!f) return; draft[f] = e.target.value;
      if (f === 'paid') { const o = $('#sx-owe', cartSheet.body); if (o) o.textContent = money(creditBalance()); }
      if (f === 'due') $$('.sx-qc', cartSheet.body).forEach(b => b.classList.toggle('on', draft.due === plus(+b.dataset.due)));
      const er = $('#sx-err', cartSheet.body); if (er) er.textContent = '';
    }

    function holdSale() {
      if (!cart.length) return;
      S.addHeld({ lines: cart.map(l => ({ ...l })), total: cartTotal(), label: 'Held at ' + tm(Date.now()) });
      cart = []; fx('tap'); if (cartSheet) cartSheet.close(); redrawAll(); ctx.toast('Sale held. Resume it from Held');
    }
    function redrawAll() { drawList(); drawBar(); drawCounts(); updateScn(); }

    async function complete() {
      if (!cart.length) return;
      const total = cartTotal(), credit = draft.method === 'credit', er = $('#sx-err', cartSheet.body);
      let deposit = 0;
      if (credit) {
        const bad = m => { fx('err'); if (er) er.textContent = m; };
        if (!draft.name.trim()) return bad('Enter the customer’s name.');
        if (draft.phone.replace(/\D/g, '').length < 7) return bad('Enter a phone number so you can contact them.');
        if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.email.trim())) return bad('That email doesn’t look right.');
        if (!draft.due) return bad('Choose when the customer will pay.');
        if (draft.due < S.dayKey()) return bad('The due date can’t be in the past.');
        deposit = Math.max(0, +draft.paid || 0);
        if (deposit >= total) return bad('If they’ve paid in full, choose Cash, Card or Transfer instead.');
      }
      const btn = $('[data-done]', cartSheet.body); btn.disabled = true;
      const sale = {
        id: 'sale' + Date.now(), no: S.nextNo(), ts: Date.now(), lines: cart.map(l => ({ ...l })), total, method: draft.method,
        cashier: ctx.store.name || '', customer: credit ? { name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim() } : null,
        paidNow: credit ? deposit : total, due: credit ? draft.due : ''
      };
      // stock comes off as soon as the sale is recorded
      sale.lines.forEach(l => { const p = prod(l.id); if (p && p.tracked) P().setQty(p.id, p.qty - l.qty); });
      S.addSale(sale);
      if (sale.customer && typeof S.upsertCustomer === 'function') S.upsertCustomer(sale.customer);
      if (credit) { const c = S.addCredit({ saleId: sale.id, no: sale.no, customer: sale.customer, total, due: draft.due }); if (deposit > 0) S.payCredit(c.id, deposit); }
      else S.addPayment({ amount: total, saleId: sale.id, method: draft.method, type: 'sale' });
      const synced = await StrapAPI.flush();
      if (!synced || !synced.ok) ctx.toast('Sale recorded on this device. Cloud sync will retry when your connection is available.');
      cart = []; draft = { method: 'cash', name: '', phone: '', email: '', due: '', paid: '' };
      cartSheet.close(); redrawAll(); fx('ok'); showDone(sale);
    }

    function showDone(sale) {
      const credit = sale.method === 'credit';
      const sh = sheet({ title: '', cls: 'sx-ok', body: `<div class="sx-okb"><div class="fl-ok"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="rg" cx="60" cy="60" r="52" pathLength="200"/><path class="ck" d="M38 62l16 16 30-34" pathLength="200"/></svg></div>
        <h2>${credit ? 'Credit sale recorded' : 'Sale completed'}</h2><b class="sx-big">${money(sale.total)}</b>
        <p class="sx-meta">${esc(sale.no)} · ${esc(R.METHOD[sale.method])} · ${plural(StrapStore.lineCount(sale), 'item')}</p>
        ${credit ? `<p class="sx-pill">${ic('clock', 16, 2)} ${esc(sale.customer.name)} owes ${money(sale.total - sale.paidNow)}. Reminder set for ${dmy(new Date(sale.due + 'T00:00:00'))}</p>` : ''}
        <div class="sx-acts col"><button type="button" class="pm-add wide" data-rc>${ic('receipt', 20, 2)} View receipt</button><button type="button" class="pm-imp wide" data-nx>Next sale</button></div></div>` });
      sh.body.addEventListener('click', e => { if (e.target.closest('[data-rc]')) { sh.close(); setTimeout(() => receiptSheet(sale), 260); } if (e.target.closest('[data-nx]')) sh.close(); });
    }
    function receiptSheet(sale) { openReceipt(sale, ctx); }

    /* =============== held sales =============== */
    function openHeld() {
      const sh = sheet({ title: 'Held sales', cls: 'sx-csheet' });
      const draw = () => {
        const H = S.state.held;
        sh.body.innerHTML = H.length ? `<ul class="sx-hl">${H.map(h => `<li class="sx-hrow" data-id="${esc(h.id)}"><span class="pg-ico">${ic('pause', 22, 2)}</span><div><b>${esc(h.label || 'Held sale')}</b><small>${plural(h.lines.reduce((a, l) => a + l.qty, 0), 'item')} · ${money(h.total)}</small></div><button type="button" class="pm-add sm" data-res>Resume</button><button type="button" class="pg-x" data-del aria-label="Delete">${ic('trash', 19, 1.8)}</button></li>`).join('')}</ul>`
          : `<div class="pg-empty">${U.illus('orders')}<h2>Nothing on hold</h2><p>Hold a sale to serve another customer, then pick it back up here.</p></div>`;
      };
      draw();
      sh.body.addEventListener('click', async e => {
        const row = e.target.closest('.sx-hrow'); if (!row) return; const h = S.state.held.find(x => x.id === row.dataset.id); if (!h) return;
        if (e.target.closest('[data-del]')) { if (await confirm({ title: 'Delete this held sale?', body: 'The items on it won’t be sold.', ok: 'Delete', cancel: 'Keep', icon: 'trash', danger: true })) { S.removeHeld(h.id); draw(); drawCounts(); } return; }
        if (e.target.closest('[data-res]')) {
          if (cart.length) S.addHeld({ lines: cart.map(l => ({ ...l })), total: cartTotal(), label: 'Held at ' + tm(Date.now()) });
          cart = []; let dropped = 0;
          h.lines.forEach(l => { const p = prod(l.id); if (!p) { dropped++; return; } const n = Math.min(l.qty, maxOf(p)); if (n < l.qty) dropped++; if (n > 0) add(p, n, true); });
          S.removeHeld(h.id); sh.close(); redrawAll(); fx('tap');
          ctx.toast(dropped ? 'Resumed. Some items changed with stock' : 'Sale resumed');
        }
      });
    }

    /* =============== credit book =============== */
    function openCredit() {
      let tab = 'open';
      const sh = sheet({ title: 'Credit book', cls: 'sx-csheet', onClose: drawCounts });
      const stat = (v, l, cls = '') => `<div class="${cls}"><b>${v}</b><small>${l}</small></div>`;
      const dueBadge = c => { const d = S.credits.daysLeft(c); return d < 0 ? `<span class="sx-due-b bad">${Math.abs(d)}d overdue</span>` : d === 0 ? '<span class="sx-due-b warn">Due today</span>' : d === 1 ? '<span class="sx-due-b warn">Due tomorrow</span>' : `<span class="sx-due-b">Due ${dmy(new Date(c.due + 'T00:00:00'))}</span>`; };
      const draw = () => {
        const open = S.credits.open(), done = S.credits.settled(), list = tab === 'open' ? open : done;
        const collected = S.state.credits.reduce((a, c) => a + S.credits.paid(c), 0), overdue = open.filter(c => S.credits.daysLeft(c) < 0).length;
        sh.body.innerHTML = `<div class="sx-cst">${stat(money(S.credits.owed()), 'Owed to you', 'big')}${stat(money(collected), 'Collected')}${stat(overdue, 'Overdue', overdue ? 'bad' : '')}</div>
          <div class="pm-tabs sx-ctabs"><button type="button" class="pm-tab${tab === 'open' ? ' on' : ''}" data-t="open">Open (${open.length})</button><button type="button" class="pm-tab${tab === 'done' ? ' on' : ''}" data-t="done">Settled (${done.length})</button></div>
          ${list.length ? `<ul class="sx-cl">${list.map(c => `<li class="sx-cr" data-id="${esc(c.id)}"><div class="sx-ct"><span class="sx-av">${esc(initials(c.customer.name))}</span><div><b>${esc(c.customer.name)}</b><small>${esc(c.no)} · ${money(c.total)} total${S.credits.paid(c) ? ` · ${money(S.credits.paid(c))} paid` : ''}</small></div><div class="sx-cb"><b>${tab === 'open' ? money(S.credits.balance(c)) : 'Paid'}</b>${tab === 'open' ? dueBadge(c) : ''}</div></div>
            ${tab === 'open' ? `<div class="sx-ca"><button type="button" data-a="call" aria-label="Call">${ic('phone', 20, 1.9)}<span>Call</span></button><button type="button" data-a="wa" aria-label="WhatsApp">${ic('chat', 20, 1.9)}<span>WhatsApp</span></button><button type="button" data-a="sms" aria-label="Text message">${ic('chat', 20, 1.9)}<span>SMS</span></button>${c.customer.email ? `<button type="button" data-a="mail" aria-label="Email">${ic('mail', 20, 1.9)}<span>Email</span></button>` : ''}<button type="button" class="pay" data-a="pay">${ic('cash', 20, 1.9)}<span>Got paid</span></button></div>` : ''}</li>`).join('')}</ul>`
          : `<div class="pg-empty">${U.illus('customers')}<h2>${tab === 'open' ? 'No one owes you' : 'Nothing settled yet'}</h2><p>${tab === 'open' ? 'Sales you record on credit show up here with a due date and a one-tap way to contact the customer.' : 'Credit sales that are fully paid land here.'}</p></div>`}`;
      };
      draw();
      const msg = c => `Hello ${c.customer.name.split(' ')[0]}, this is a friendly reminder from ${ctx.store.bizname || 'us'}: ${money(S.credits.balance(c))} is outstanding for purchase ${c.no}, due ${dmy(new Date(c.due + 'T00:00:00'))}. Thank you!`;
      const dial = p => { let d = p.replace(/\D/g, ''); if (d.startsWith('0') && (ctx.cur || 'NGN') === 'NGN') d = '234' + d.slice(1); return d; };
      sh.body.addEventListener('click', e => {
        const t = e.target.closest('[data-t]'); if (t) { tab = t.dataset.t; return draw(); }
        const a = e.target.closest('[data-a]'); if (!a) return;
        const c = S.state.credits.find(x => x.id === a.closest('.sx-cr').dataset.id); if (!c) return;
        const k = a.dataset.a, ph = c.customer.phone;
        if (k === 'call') location.href = 'tel:' + ph;
        else if (k === 'wa') window.open('https://wa.me/' + dial(ph) + '?text=' + encodeURIComponent(msg(c)), '_blank', 'noopener');
        else if (k === 'sms') location.href = 'sms:' + ph + '?body=' + encodeURIComponent(msg(c));
        else if (k === 'mail') location.href = 'mailto:' + c.customer.email + '?subject=' + encodeURIComponent('Payment reminder ' + c.no) + '&body=' + encodeURIComponent(msg(c));
        else if (k === 'pay') payCredit(c, draw);
      });
    }
    function payCredit(c, after) {
      const bal = S.credits.balance(c);
      const sh = sheet({ title: 'Record payment', cls: 'sx-paysheet', body: `<p class="sx-sub"><b>${esc(c.customer.name)}</b> owes <b>${money(bal)}</b> on ${esc(c.no)}.</p>
        <label class="pm-fl money"><span class="cur">${esc(ctx.cur)}</span><input id="sx-amt" type="number" inputmode="decimal" min="0" max="${bal}" value="${bal}" aria-label="Amount received"></label>
        <div class="sx-chips"><button type="button" class="sx-qc" data-f="1">Full balance</button><button type="button" class="sx-qc" data-f=".5">Half</button></div>
        <p class="sx-err" id="sx-perr" role="alert"></p><button type="button" class="pm-add wide" data-ok>Save payment</button>` });
      const inp = $('#sx-amt', sh.body); setTimeout(() => inp.select(), 350);
      sh.body.addEventListener('click', e => {
        const f = e.target.closest('[data-f]'); if (f) { inp.value = Math.round(bal * +f.dataset.f * 100) / 100; return; }
        if (!e.target.closest('[data-ok]')) return;
        const v = +inp.value; if (!(v > 0)) { fx('err'); $('#sx-perr', sh.body).textContent = 'Enter the amount received.'; return; }
        if (v > bal) { fx('err'); $('#sx-perr', sh.body).textContent = `That’s more than the ${money(bal)} owed.`; return; }
        S.payCredit(c.id, v); sh.close(); StrapAPI.flush().then(r => { if (!r || !r.ok) ctx.toast('Payment saved on this device; cloud sync will retry.'); }); fx('ok'); ctx.toast(`${money(v)} received from ${c.customer.name.split(' ')[0]}`); after(); drawCounts();
      });
    }

    /* =============== scan-to-sell =============== */
    function openScanner() {
      if (scn) return;
      const L = el('div', 'sx-scn');
      L.innerHTML = `<video playsinline muted autoplay></video><div class="sx-scn-shade"></div>
        <div class="sx-scn-top"><button type="button" class="sx-scn-x" data-sx aria-label="Close scanner">${ic('close', 22, 2.2)}</button><span class="sx-scn-t">Scan to sell</span><span class="sx-scn-n"><b>0</b> added</span></div>
        <div class="sx-scn-frame"><i></i><i></i><i></i><i></i><span class="sx-scn-line"></span></div>
        <p class="sx-scn-msg" role="status">Point the camera at a product’s QR code or barcode</p>
        <div class="sx-scn-bot"><form class="sx-scn-man"><input placeholder="Or type or paste a code" autocomplete="off" aria-label="Product code"><button type="submit">Add</button></form>
          <button type="button" class="sx-scn-cart" data-sc hidden></button></div>`;
      document.body.appendChild(L); StrapKit.lock(true); void L.offsetWidth; L.classList.add('on');
      const video = $('video', L), msg = $('.sx-scn-msg', L), cnt = $('.sx-scn-n b', L);
      let stream = null, det = null, tmr = null, busy = false, last = '', lastT = 0, added = 0, mt = null;
      scn = { L, cnt, update() { const n = cartCount(), b = $('[data-sc]', L); b.hidden = !n; if (n) b.innerHTML = `<span><b>${plural(n, 'item')}</b><small>${money(cartTotal())}</small></span><i>${ic('arrowR', 20, 2.4)}</i>`; } };
      const say = (t, cls) => { msg.textContent = t; msg.className = 'sx-scn-msg' + (cls ? ' ' + cls : ''); clearTimeout(mt); if (cls) mt = setTimeout(() => { msg.className = 'sx-scn-msg'; msg.textContent = 'Keep scanning, or tap Review to finish'; }, 1800); };
      function handle(code) {
        const now = Date.now(); if (code === last && now - lastT < 1800) return; last = code; lastT = now;
        const p = findByCode(code);
        if (!p) { fx('err'); return say(`No product matches “${String(code).slice(0, 24)}”`, 'bad'); }
        if (add(p)) { added++; cnt.textContent = added; L.classList.remove('flash'); void L.offsetWidth; L.classList.add('flash'); say(`Added ${p.title}`, 'ok'); }
        else say(p.qty > 0 ? `Only ${p.qty} of ${p.title} in stock` : `${p.title} is out of stock`, 'bad');
      }
      async function scan() { if (busy || video.readyState < 2) return; busy = true; try { const r = await det.detect(video); if (r.length) handle(r[0].rawValue); } catch (e) {} busy = false; }
      (async () => {
        try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); video.srcObject = stream; await video.play(); }
        catch (e) { return say('Camera isn’t available. Allow camera access, or type the code below.', 'bad'); }
        if (!('BarcodeDetector' in window)) return say('Live scanning isn’t supported in this browser yet. Type or paste the code below.', 'bad');
        let fm; try { fm = await BarcodeDetector.getSupportedFormats(); } catch (e) {}
        det = new BarcodeDetector(fm && fm.length ? { formats: fm } : undefined); tmr = setInterval(scan, 200);
      })();
      const close = () => { clearInterval(tmr); clearTimeout(mt); if (stream) stream.getTracks().forEach(t => t.stop()); L.classList.remove('on'); StrapKit.lock(false); setTimeout(() => L.remove(), reduced() ? 0 : 300); scn = null; };
      L.addEventListener('click', e => { if (e.target.closest('[data-sx]')) close(); if (e.target.closest('[data-sc]')) { close(); setTimeout(openCart, 320); } });
      $('form', L).addEventListener('submit', e => { e.preventDefault(); const i = $('input', e.target); if (i.value.trim()) handle(i.value.trim()); i.value = ''; last = ''; });
      scn.update();
    }
    function updateScn() { if (scn) scn.update(); }

    /* =============== close sales for the day =============== */
    async function askPin(title, sub) {
      for (;;) {
        const r = await Sec.pinPad({ title, sub });
        if (r === 'forgot') { const done = await Sec.setupFlow({ email: ctx.store.email, mode: 'reset' }); if (!done) return false; continue; }
        return r === true;
      }
    }
    async function closeFlow() {
      const st = S.dayStats();
      const ok = await confirm({
        title: 'Close sales for today?', icon: 'receipt', ok: 'Yes, close sales', cancel: 'Keep selling',
        body: `So far today you’ve earned <b>${money(st.earned)}</b> from ${plural(st.count, 'sale')}. ${cart.length ? 'The items in your cart will be put on hold.' : 'Nobody can be sold to until you reopen sales.'}`
      });
      if (!ok) return;
      if (!S.hasPin()) {
        const go = await confirm({ title: 'Set your activity PIN', icon: 'lock', ok: 'Set PIN now', cancel: 'Cancel', body: 'You haven’t set a 4-digit activity PIN yet. You’ll need one to close sales and confirm other important actions. It only takes a minute.' });
        if (!go) return;
        const done = await Sec.setupFlow({ email: ctx.store.email, mode: 'set' }); if (!done) return;
        await sleep(250);
      }
      if (!(await askPin('Confirm to close sales', 'Enter your 4-digit PIN to close today’s sales.'))) return;
      if (cart.length) { S.addHeld({ lines: cart.map(l => ({ ...l })), total: cartTotal(), label: 'Held at ' + tm(Date.now()) }); cart = []; }
      const f = S.dayStats();
      S.closeDay({ earned: f.earned, count: f.count, items: f.items, owed: f.owedTotal, creditGiven: f.creditGiven });
      fx('ok'); splash(S.state.closed);
    }
    function splash(info) {
      const w = el('div', 'sx-splash');
      w.innerHTML = `<div class="sx-spin"><svg class="sx-slogo" viewBox="0 0 136 136" aria-hidden="true"><circle cx="68" cy="68" r="65" fill="none" stroke="#0a0a0a" stroke-width="3"/><circle cx="68" cy="68" r="49" fill="#0a0a0a"/><path d="M50 69l12 12 25-27" fill="none" stroke="#e6f53a" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" pathLength="100"/></svg>
        <h1>Sales closed<br>for today</h1><p class="sx-sd">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p class="sx-sl">Total earned</p><b class="sx-sa" data-v="${info.earned}">${money(0)}</b>
        <div class="sx-ss"><div><b>${info.count}</b><small>${info.count === 1 ? 'sale' : 'sales'}</small></div><div><b>${info.items}</b><small>${info.items === 1 ? 'item sold' : 'items sold'}</small></div><div><b>${money(info.owed)}</b><small>owed on credit</small></div></div></div>
        <button type="button" class="sx-sdone">Done</button>`;
      document.body.appendChild(w); StrapKit.lock(true); void w.offsetWidth; w.classList.add('on');
      const a = $('.sx-sa', w), to = info.earned, t0 = performance.now() + 500, dur = 1500;
      const step = t => { const p = Math.min(1, Math.max(0, (t - t0) / dur)); a.textContent = money(to * (1 - Math.pow(1 - p, 4))); if (p < 1) requestAnimationFrame(step); else a.textContent = money(to); };
      reduced() ? a.textContent = money(to) : requestAnimationFrame(step);
      $('.sx-sdone', w).onclick = () => { w.classList.remove('on'); StrapKit.lock(false); setTimeout(() => w.remove(), 400); ctx.go('home'); render(); };
    }
    function drawStaffWaiting() {
      root.innerHTML = `<div class="sx"><header class="sx-head"><button type="button" class="pm-round" data-staff-menu aria-label="Open menu">${ic('menu',22,2.2)}</button><h1 class="sx-title">Sales</h1></header>
        <div class="sx-closed"><span class="sx-cl-ic">${U.illus('sales')}</span><h2>Sales are not open yet</h2><p>Your business owner must open the sales session before you can add products or complete a sale.</p><button type="button" class="pm-add" data-staff-refresh>Check again</button></div></div>`;
    }
    function drawClosed() {
      const c = S.state.closed;
      const cashier = ctx.staff && ctx.staff.role==='Cashier';
      root.innerHTML = `<div class="sx"><header class="sx-head"><button type="button" class="pm-round" ${cashier?'data-staff-menu aria-label="Open menu"':'data-home aria-label="Back to home"'}>${ic(cashier?'menu':'back', 22, 2.2)}</button><h1 class="sx-title">Sales</h1></header>
        <div class="sx-closed"><span class="sx-cl-ic">${cashier?U.illus('sales'):ic('lock',30,1.8)}</span><h2>${cashier?'Sales are paused by the owner':'Sales are closed for today'}</h2><p>${cashier?'Ask the business owner to open the sales session before continuing.':`You earned <b>${money(c.earned)}</b> from ${plural(c.count, 'sale')}. Reopen sales if you need to keep selling.`}</p>
        ${cashier?'<button type="button" class="pm-add" data-staff-refresh>Check again</button>':'<button type="button" class="pm-add" data-reopen>Reopen sales</button><button type="button" class="pm-imp" data-home>Back to home</button>'}</div></div>`;
    }
    async function reopen() {
      if (!S.hasPin()) { S.reopenDay(); return render(); }
      if (await askPin('Reopen sales', 'Enter your 4-digit PIN to start selling again.')) { S.reopenDay(); fx('ok'); render(); ctx.toast('Sales reopened'); }
    }

    render();
    if (P() && P().onChange) P().onChange(() => { drawList(); drawBar(); });
    return { onShow() { render(); } };
  }

  /* ---------- receipt sheet (also used by today / history) ---------- */
  function openReceipt(sale, ctx) {
    const tpl = R.load(ctx.store.bizname), fmt = n => ctx.money(n);
    const sh = sheet({ title: 'Receipt', cls: 'sx-rsheet', body: `<div class="sx-rcw">${R.render(tpl, sale, fmt)}</div>
      <div class="sx-acts"><button type="button" class="sx-hold" data-p>${ic('download', 20, 2)} Print</button><button type="button" class="pm-add sx-done" data-s>${ic('upload', 20, 2)} Share</button></div>` });
    sh.body.addEventListener('click', async e => {
      if (e.target.closest('[data-p]')) R.print(tpl, sale, fmt);
      if (e.target.closest('[data-s]')) {
        const t = R.text(tpl, sale, fmt);
        try { if (navigator.share) await navigator.share({ title: sale.no, text: t }); else { await navigator.clipboard.writeText(t); ctx.toast('Receipt copied'); } } catch (err) {}
      }
    });
  }

  /* ---------- today's sales + history (real data from the store) ---------- */
  const head = (t, i) => `<header class="pm-head"><button type="button" class="pm-round" data-go="home" aria-label="Back">${ic('back', 22, 2.2)}</button><h1 class="pm-title">${t}</h1></header>`;
  const saleRows = (list, money) => list.length ? `<ul class="pg-list sx-sl">${list.map(s => `<li class="pg-row sx-sr" data-sid="${esc(s.id)}" tabindex="0" role="button"><span class="pg-ico">${ic(s.method === 'credit' ? 'book' : s.method === 'card' ? 'card' : s.method === 'transfer' ? 'transfer' : 'cash', 22, 1.8)}</span><div><b>${esc(s.no)} · ${money(s.total)}</b><small>${tm(s.ts)} · ${dmy(s.ts)} · ${plural(StrapStore.lineCount(s), 'item')}${s.customer ? ' · ' + esc(s.customer.name) : ''}</small></div><span class="pg-pill${s.method === 'credit' ? ' credit' : ''}">${esc(R.METHOD[s.method])}</span></li>`).join('')}</ul>` : '';
  function wireRows(root, ctx) {
    const open = e => { const r = e.target.closest('.sx-sr'); if (!r) return; const s = S.state.sales.find(x => x.id === r.dataset.sid); if (s) openReceipt(s, ctx); };
    root.addEventListener('click', open); root.addEventListener('keydown', e => { if (e.key === 'Enter') open(e); });
  }
  function today(root, ctx) {
    const draw = () => {
      const st = S.dayStats(), max = Math.max(1, ...Array.from({ length: 12 }, (_, i) => st.sales.filter(s => new Date(s.ts).getHours() === 8 + i).reduce((a, s) => a + s.total, 0)));
      const bars = Array.from({ length: 12 }, (_, i) => st.sales.filter(s => new Date(s.ts).getHours() === 8 + i).reduce((a, s) => a + s.total, 0));
      root.innerHTML = head('Today’s sales') + `<section class="pg-big"><span>Earned today</span><b>${ctx.money(st.earned)}</b><small>${plural(st.count, 'sale')} · ${plural(st.items, 'item')} sold${st.owedTotal ? ` · ${ctx.money(st.owedTotal)} owed on credit` : ''}</small>
        <div class="pg-bars">${bars.map((v, i) => `<i style="--h:${Math.max(8, v / max * 100)}%;--d:${i * 50}ms"></i>`).join('')}</div></section>` +
        (st.count ? saleRows(st.sales, ctx.money) : `<div class="pg-empty">${U.illus('sales')}<h2>Sales will list here</h2><p>Each sale you record today appears in this list, newest first.</p><button type="button" class="pm-add" data-go="new-sale">Start selling</button></div>`);
    };
    draw(); wireRows(root, ctx); return { onShow: draw };
  }
  function history(root, ctx) {
    let range = 30;
    const draw = () => {
      const list = S.sales(range), earned = range ? S.earned(range) : S.earnedAll();
      root.innerHTML = head('Sales history') + `<div class="pm-tabs pg-range">${[['Today', 1], ['7 days', 7], ['30 days', 30], ['All time', 0]].map(([l, v]) => `<button type="button" class="pm-tab${range === v ? ' on' : ''}" data-r="${v}">${l}</button>`).join('')}</div>` +
        (list.length ? `<div class="pg-sum two"><div><b>${ctx.money(earned)}</b><small>Money received</small></div><div><b>${list.length}</b><small>${list.length === 1 ? 'Sale' : 'Sales'}</small></div></div>${saleRows(list, ctx.money)}` : `<div class="pg-empty">${U.illus('sales')}<h2>No sales in this period</h2><p>Completed sales will be listed here so you can look back at any day.</p></div>`);
    };
    root.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { range = +b.dataset.r; draw(); } });
    draw(); wireRows(root, ctx); return { onShow: draw };
  }

  return { mount, today, history, openReceipt };
})();
