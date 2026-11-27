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
      fields: [['Card type', 'select', '', [{ value: 'value', label: 'Gift card — Naira balance' }, { value: 'discount', label: 'Discount pass — percentage' }]], ['Amount', 'number', 'Enter amount'], ['Customer email', 'email', 'Optional'], ['Expires on', 'date', 'Optional']] },
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
    const first = $$('input,select', wrap)[0]; setTimeout(() => first && first.focus(), 350);
    wrap.addEventListener('click', e => {
      if (e.target.closest('.pm-scrim') || e.target.closest('[data-c]')) return close();
      if (e.target.closest('[data-s]')) {
        const v = $$('input,select', wrap).map(i => i.value.trim());
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
      else if (id === 'gift') { const type = String(v[0] || '').trim().toLowerCase(); const amount = Number(v[1]); if (!['value', 'discount'].includes(type)) return ctx.toast('Choose a gift card or discount pass'); if (!Number.isFinite(amount) || !(amount > 0) || (type === 'discount' && amount > 100)) return ctx.toast(type === 'discount' ? 'Discount must be between 1% and 100%' : 'Enter a gift-card value above ₦0'); if (v[3] && v[3] < StrapStore.dayKey()) return ctx.toast('Expiry date must be today or later'); StrapStore.addRecord(key, { type, value: amount, balance: type === 'value' ? amount : 0, email: v[2], expiresOn: v[3] || '', code: genCode(), status: 'active', redemptions: [] }); }
      draw(); ctx.toast('Saved to your store');
    });
    function draw() {
      const cta = c.cta ? `<button type="button" class="pm-add" data-add>${ic('plus', 20, 2.2)} ${c.cta}</button>` : '';
      root.innerHTML = head(c.i, c.t, rows.length && c.cta ? `<button type="button" class="pm-add sm" data-add>Add</button>` : '') +
        (rows.length ? `<ul class="pg-list">${rows.map((v, i) => {
          const f = id === 'customers' ? { t: v.name, s: [v.phone, v.email].filter(Boolean).join(' · ') }
            : id === 'purchase' ? { t: v.supplier, s: [v.expectedDate, v.notes, v.status].filter(Boolean).join(' · ') }
            : id === 'transfers' ? { t: `${v.from} → ${v.to}`, s: [v.status, v.notes].filter(Boolean).join(' · ') }
            : { t: v.type === 'discount' ? `${v.value}% discount pass` : `${ctxRef.money(v.balance ?? v.value ?? 0)} gift card`, s: [v.code, v.email, v.expiresOn ? `Expires ${v.expiresOn}` : '', v.status, v.type === 'value' ? `Issued ${ctxRef.money(v.value || 0)}` : 'QR receipt'].filter(Boolean).join(' · ') };
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
    const discount = card.type === 'discount';
    const amount = discount ? (Number(card.value) || 0) + '% OFF' : ctx.money(card.balance ?? card.value ?? 0);
    const storeName = String(ctx.store && ctx.store.name || 'STRAP').trim().slice(0, 28) || 'STRAP';
    layer.innerHTML = '<div class="gc-shade" data-gc-close></div><section class="gc-slip" role="dialog" aria-modal="true" aria-label="Gift card">' +
      '<div class="gc-slip-top"><span>STRAP · GIFT CARD</span><button type="button" data-gc-close aria-label="Close">×</button></div>' +
      '<div class="gc-stage"><div class="gc-card" id="gc-card-preview" role="button" tabindex="0" aria-label="Gift card. Tap to view the back">' +
      '<div class="gc-face gc-front"><span class="gc-amount">' + esc(amount) + '</span><span class="gc-store">' + esc(storeName.toUpperCase()) + '</span>' +
      '<h3 class="gc-title">' + (discount ? 'Discount<br>Pass' : 'Gift<br>Card') + '</h3><span class="gc-orb"></span><span class="gc-holiday">' +
      (discount ? 'A little<br>something off' : 'A gift<br>for you') + '</span></div>' +
      '<div class="gc-face gc-back"><div class="gc-back-stripe"></div><div class="gc-back-body"><div class="gc-qr" id="gc-slip-qr"></div>' +
      '<div class="gc-back-info"><small>SCAN AT CHECKOUT</small><span class="gc-code">' + esc(card.code) + '</span>' +
      '<small>' + (discount ? (Number(card.value) || 0) + '% discount · single use' : 'Remaining value · ' + esc(ctx.money(card.balance ?? card.value ?? 0))) + '</small>' +
      '<small>' + esc(String(card.status || 'active').toUpperCase()) + '</small></div></div></div></div></div>' +
      '<p class="gc-hint">Tap the card to flip it and view the QR code side.</p><div class="gc-terms"><h4>Card information</h4><ul>' +
      '<li>Use only at the store that issued this card.</li><li>' + (discount ? 'This discount pass is single-use and applies to one purchase.' : 'Any unused balance remains available until it is spent.') + '</li>' +
      '<li>Keep the code private. Anyone with the code may redeem it.</li></ul></div>' +
      '<button type="button" class="gc-download" data-gc-download>Download</button><div class="gc-slip-actions"><button type="button" data-gc-done>Done</button></div></section>';
    document.body.appendChild(layer); document.body.classList.add('pm-open');
    const qr = $('#gc-slip-qr', layer);
    if (window.QRCode) new QRCode(qr, { text: 'STRAPGC|' + card.code, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.H });
    const cardEl = $('#gc-card-preview', layer);
    cardEl.addEventListener('click', () => cardEl.classList.toggle('is-flipped'));
    cardEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cardEl.classList.toggle('is-flipped'); } });
    const close = () => { layer.remove(); document.body.classList.remove('pm-open'); };
    layer.addEventListener('click', async e => {
      if (e.target.closest('[data-gc-close],[data-gc-done]')) return close();
      const btn = e.target.closest('[data-gc-download]'); if (!btn) return;
      if (!window.jspdf || !window.jspdf.jsPDF) return ctx.toast('PDF service did not load. Refresh Strap and try again.');
      if (!qr.querySelector('canvas') && !qr.querySelector('img')) return ctx.toast('The gift-card QR code is not ready yet. Try again.');
      btn.disabled = true; btn.textContent = 'Preparing…';
      try {
        const pdf = await buildGiftCardPdf(card, ctx, qr, storeName, amount, discount);
        pdf.save('strap-gift-card-' + String(card.code || 'card').replace(/[^a-z0-9-]/gi, '-') + '.pdf');
        ctx.toast('A4 gift-card PDF downloaded');
      } catch (err) {
        console.error('Gift card PDF generation failed:', err);
        ctx.toast('Could not create a secured PDF. Please try again.');
      } finally { btn.disabled = false; btn.textContent = 'Download'; }
    });
  }

  async function buildGiftCardPdf(card, ctx, qr, storeName, amount, discount) {
    const W = 1012, H = 638, lime = '#e6f53a', ink = '#0a0a0a';
    const make = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const rr = (c,x,y,w,h,r) => { c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); };
    const front = make(), fc = front.getContext('2d');
    rr(fc,0,0,W,H,42); fc.clip(); fc.fillStyle='#efefe9'; fc.fillRect(0,0,W,H);
    let seed=29; const rand=()=>((seed=(seed*9301+49297)%233280)/233280);
    for(let i=0;i<4500;i++){fc.fillStyle='rgba(50,50,42,'+(rand()*.075).toFixed(3)+')';fc.fillRect(rand()*W,rand()*H,2,2);}
    // Subtle dot-matrix STRAP watermark, matching the on-screen card preview.
    const mark=document.createElement('canvas');mark.width=W;mark.height=H;
    const mc=mark.getContext('2d');mc.fillStyle='rgba(230,245,58,.62)';
    for(let y=0;y<H;y+=10)for(let x=0;x<W;x+=10){mc.beginPath();mc.arc(x+2,y+2,2.1,0,Math.PI*2);mc.fill();}
    mc.globalCompositeOperation='destination-in';mc.fillStyle='#fff';
    mc.font='900 176px Sora,Arial,sans-serif';mc.textAlign='center';mc.textBaseline='middle';mc.fillText('STRAP',W*.5,H*.49);
    fc.drawImage(mark,0,0);
    fc.fillStyle=lime;fc.beginPath();fc.arc(W*.91,H*.88,W*.23,0,Math.PI*2);fc.fill();
    fc.strokeStyle=ink;fc.lineWidth=7;fc.beginPath();fc.arc(W*.91,H*.88,W*.275,0,Math.PI*2);fc.stroke();
    fc.fillStyle=ink;fc.font='800 92px Sora,Arial,sans-serif';fc.textAlign='left';fc.fillText(amount,61,140,850);
    fc.fillStyle=ink;rr(fc,W-250,62,190,54,12);fc.fill();
    fc.fillStyle=lime;fc.font='700 34px Sora,Arial,sans-serif';fc.textAlign='center';fc.fillText(storeName.toUpperCase(),W-155,100,170);
    fc.fillStyle=ink;fc.textAlign='left';fc.font='800 190px Sora,Arial,sans-serif';
    fc.fillText(discount?'Discount':'Gift',61,H-155,760);fc.fillText(discount?'Pass':'Card',61,H-35,760);
    fc.fillStyle=ink;fc.font='700 30px Sora,Arial,sans-serif';fc.textAlign='center';
    fc.save();fc.translate(W*.86,H*.77);fc.rotate(-.2);fc.fillText(discount?'A little something off':'A gift for you',0,0,260);fc.restore();

    const back=make(),bc=back.getContext('2d');
    rr(bc,0,0,W,H,42);bc.clip();bc.fillStyle='#181817';bc.fillRect(0,0,W,H);
    bc.fillStyle=lime;bc.fillRect(0,38,W,90);
    let qImg=qr.querySelector('canvas');
    if(!qImg){qImg=new Image();qImg.src=qr.querySelector('img').src;await new Promise((ok,no)=>{qImg.onload=ok;qImg.onerror=no;});}
    bc.fillStyle='#fff';rr(bc,58,190,350,350,28);bc.fill();
    bc.imageSmoothingEnabled=false;bc.drawImage(qImg,83,215,300,300);
    bc.fillStyle='#aaa99f';bc.textAlign='left';bc.font='600 30px Sora,Arial,sans-serif';bc.fillText('SCAN AT CHECKOUT',470,245);
    bc.fillStyle=lime;bc.font='700 39px "Space Mono",monospace';
    const code=String(card.code||''),lines=code.length>17?[code.slice(0,17),code.slice(17)]:[code];
    lines.forEach((line,i)=>bc.fillText(line,470,330+i*58,490));
    bc.fillStyle='#aaa99f';bc.font='600 29px Sora,Arial,sans-serif';
    bc.fillText(discount?(Number(card.value)||0)+'% DISCOUNT · SINGLE USE':'REMAINING · '+ctx.money(card.balance ?? card.value ?? 0),470,475,490);
    bc.fillText('STATUS · '+String(card.status||'active').toUpperCase(),470,530,490);

    const J=window.jspdf.jsPDF;
    const ownerPassword=(window.crypto&&crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random())+'-Strap';
    const doc=new J({orientation:'portrait',unit:'mm',format:'a4',compress:true,
      encryption:{userPassword:'',ownerPassword,userPermissions:['print']},putOnlyUsedFonts:true});
    doc.setProperties({title:'Strap gift card',subject:'Flattened gift card front and back',creator:'Strap'});
    const cardW=85.6,cardH=54,gap=12,x=(210-(cardW*2+gap))/2,y=108;
    doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(20,20,20);
    doc.text('STRAP GIFT CARD · PRINT AND CUT',105,82,{align:'center'});
    doc.setFontSize(8);doc.setTextColor(110,110,110);
    doc.text('FRONT',x+cardW/2,y-5,{align:'center'});doc.text('BACK',x+cardW+gap+cardW/2,y-5,{align:'center'});
    doc.addImage(front.toDataURL('image/jpeg',.96),'JPEG',x,y,cardW,cardH,undefined,'FAST');
    doc.addImage(back.toDataURL('image/jpeg',.96),'JPEG',x+cardW+gap,y,cardW,cardH,undefined,'FAST');
    doc.setDrawColor(150,150,150);doc.setLineDashPattern([1,1],0);doc.rect(x,y,cardW,cardH);doc.rect(x+cardW+gap,y,cardW,cardH);
    doc.setFontSize(8);doc.setTextColor(100,100,100);doc.text('Flattened artwork · print at 100% scale',105,176,{align:'center'});
    return doc;
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

  function growth(root, ctx) {
    let rangeDays = 7;
    const draw = () => {
      const sales = StrapStore.sales().filter(x => Number.isFinite(Number(x.ts)) && Number(x.ts) > 0);
      const now = new Date();
      const today = new Date(now); today.setHours(0, 0, 0, 0);
      const start = new Date(today); start.setDate(start.getDate() - (rangeDays - 1));
      const previousStart = new Date(start); previousStart.setDate(previousStart.getDate() - rangeDays);
      const previousEnd = start.getTime();
      const inRange = (rows, from, to) => rows.filter(x => Number(x.ts) >= from && Number(x.ts) < to);
      const recent = inRange(sales, start.getTime(), now.getTime() + 1);
      const previous = inRange(sales, previousStart.getTime(), previousEnd);
      const sumRevenue = rows => rows.reduce((sum, x) => sum + (Number(x.total) || 0), 0);
      const revenue = sumRevenue(sales), recentRevenue = sumRevenue(recent), previousRevenue = sumRevenue(previous);
      const unitsIn = rows => rows.reduce((sum, sale) => sum + (Array.isArray(sale.lines) ? sale.lines.reduce((n, line) => n + Math.max(0, Number(line.qty) || 0), 0) : 0), 0);
      const units = unitsIn(sales), recentUnits = unitsIn(recent);
      const average = recent.length ? recentRevenue / recent.length : 0;
      const change = previousRevenue > 0 ? ((recentRevenue - previousRevenue) / previousRevenue) * 100 : null;
      const products = new Map();
      sales.forEach(sale => (Array.isArray(sale.lines) ? sale.lines : []).forEach(line => {
        const key = String(line.id || line.title || 'product');
        const item = products.get(key) || { title: line.title || 'Product', qty: 0, revenue: 0 };
        item.qty += Math.max(0, Number(line.qty) || 0);
        item.revenue += (Number(line.price) || 0) * (Number(line.qty) || 0);
        products.set(key, item);
      }));
      const top = [...products.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(start); date.setDate(start.getDate() + Math.floor(i * rangeDays / 7));
        const next = new Date(start); next.setDate(start.getDate() + Math.floor((i + 1) * rangeDays / 7));
        if (next <= date) next.setDate(date.getDate() + 1);
        const rows = inRange(sales, date.getTime(), next.getTime());
        const label = rangeDays === 7 ? date.toLocaleDateString('en-NG', { weekday: 'short' }) : date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
        const end = new Date(next.getTime() - 1);
        const dateLabel = rangeDays === 7 ? date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : date.toLocaleDateString('en-NG', { day: 'numeric' }) + '–' + end.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
        return { label, date: dateLabel, value: sumRevenue(rows), count: rows.length };
      });
      const max = Math.max(1, ...days.map(x => x.value));
      const axisMoney = n => '₦' + new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0);
      const chartPoints = days.map((day, i) => ({ ...day, x: 20 + i * 110, y: Math.max(28, Math.min(205, 205 - (day.value / max) * 160)) }));
      const peakIndex = chartPoints.reduce((best, point, i, arr) => point.value > arr[best].value ? i : best, 0);
      const peak = chartPoints[peakIndex];
      const chartLine = chartPoints.map((point, i) => {
        if (!i) return 'M ' + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
        const prev = chartPoints[i - 1], before = chartPoints[Math.max(0, i - 2)], after = chartPoints[Math.min(chartPoints.length - 1, i + 1)];
        const dx = point.x - prev.x;
        const c1y = Math.max(Math.min(prev.y, point.y), Math.min(Math.max(prev.y, point.y), prev.y + (point.y - before.y) / 6));
        const c2y = Math.max(Math.min(prev.y, point.y), Math.min(Math.max(prev.y, point.y), point.y - (after.y - prev.y) / 6));
        const c1x = prev.x + dx / 3, c2x = point.x - dx / 3;
        return 'C ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ', ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ', ' + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
      }).join(' ');
      const chartArea = chartLine + ' L ' + chartPoints[chartPoints.length - 1].x.toFixed(1) + ' 205 L ' + chartPoints[0].x.toFixed(1) + ' 205 Z';
      const milestones = [
        { label: 'First sale recorded', detail: 'Your store has made its first sale', done: sales.length >= 1 },
        { label: '10 sales completed', detail: 'Build a steady sales rhythm', done: sales.length >= 10 },
        { label: '50 items sold', detail: 'Move more products through your store', done: units >= 50 },
        { label: '₦100,000 in sales', detail: 'Reach your first six-figure sales milestone', done: revenue >= 100000 },
        { label: '100 sales completed', detail: 'Keep building customer momentum', done: sales.length >= 100 }
      ];
      const completed = milestones.filter(x => x.done).length;
      const nextMilestone = milestones.find(x => !x.done);
      const growthLabel = change === null ? 'No previous-week baseline' : (change > 0 ? '+' : '') + change.toFixed(1) + '% vs previous 7 days';
      root.innerHTML = head('growth', 'Growth') + (sales.length ? `
        <section class="growth-hero">
          <div class="growth-hero-top"><span>Sales performance</span><label class="growth-period-wrap"><select class="growth-period" aria-label="Sales timeframe"><option value="7" ${rangeDays===7?'selected':''}>Last 7 days</option><option value="30" ${rangeDays===30?'selected':''}>Last 30 days</option><option value="90" ${rangeDays===90?'selected':''}>Last 90 days</option></select><span aria-hidden="true">⌄</span></label></div>
          <b class="growth-revenue">${ctx.money(recentRevenue)}</b>
          <div class="growth-change ${change === null ? 'neutral' : change >= 0 ? 'positive' : 'negative'}">${esc(growthLabel)}</div>
          <div class="growth-hero-foot"><span><b>${recent.length.toLocaleString('en-NG')}</b><small>sales</small></span><span><b>${recentUnits.toLocaleString('en-NG')}</b><small>items sold</small></span><span><b>${ctx.money(average)}</b><small>avg. sale</small></span></div>
        </section>
        <section class="growth-chart-panel">
          <div class="growth-panel-head"><h3>${rangeDays===7?'Daily sales trend':'Sales trend'}</h3><span class="growth-peak">Peak: ${esc(peak.label)}</span></div>
          <div class="growth-chart-visual">
            <div class="growth-chart-y"><span>${axisMoney(max)}</span><span>${axisMoney(max * .5)}</span><span>₦0</span></div>
            <div class="growth-chart-stage"><div class="growth-tooltip" aria-live="polite">${esc(peak.label)} ${esc(peak.date)} · ${ctx.money(peak.value)}</div>
            <svg class="growth-line-chart" viewBox="0 0 700 230" preserveAspectRatio="none" role="img" aria-label="Daily revenue: ${days.map(d => d.label + ' ' + ctx.money(d.value)).join(', ')}">
              
              <line x1="10" y1="45" x2="690" y2="45" class="growth-grid-line"/>
              <line x1="10" y1="120" x2="690" y2="120" class="growth-grid-line"/>
              <line x1="10" y1="205" x2="690" y2="205" class="growth-grid-line"/>
              <path d="${chartArea}" class="growth-chart-area"/><line x1="${peak.x}" y1="28" x2="${peak.x}" y2="205" class="growth-chart-guide"/>
              
              <path d="${chartLine}" class="growth-chart-line"/>
              ${chartPoints.map((point,i)=>`<g class="growth-chart-point ${i===peakIndex?'active':''}" data-growth-point="${i}" role="button" tabindex="0" aria-label="${esc(point.label)} ${esc(point.date)}: ${ctx.money(point.value)}"><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="13" class="growth-point-hit"/><circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${i===peakIndex?7:5}" class="growth-point-dot"/></g>`).join('')}
            </svg></div>
            </svg>
          </div>
          <div class="growth-chart-x">${days.map((day,i)=>`<button type="button" data-growth-point="${i}" class="${i===peakIndex?'today':''}"><b>${day.label}</b><small>${day.date}</small></button>`).join('')}</div>
        </section>
        <section class="growth-panel">
          <div class="growth-panel-head"><h3>Best-selling products</h3><button type="button" class="growth-see-all" data-growth-see-all>See all <span aria-hidden="true">→</span></button></div>
          ${top.length ? `<div class="growth-products">${top.map((item, i) => { const share = recentRevenue > 0 ? item.revenue / recentRevenue * 100 : 0; const volume = top[0].qty > 0 ? item.qty / top[0].qty * 100 : 0; return `<div class="growth-product-row"><span class="growth-rank">${String(i + 1).padStart(2, '0')}</span><div><b>${esc(item.title)}</b><small>${ctx.money(item.revenue)} revenue · ${share.toFixed(0)}% share</small><i class="growth-product-volume" style="--volume:${volume}%"></i></div><strong>${item.qty.toLocaleString('en-NG')} <small>sold</small></strong></div>`; }).join('')}</div>` : '<p class="growth-muted">Product-level sales will appear here when sale items are recorded.</p>'}
        </section>
        <section class="growth-panel growth-milestone-panel">
          <div class="growth-panel-head"><div><h3>Business milestones</h3><p>${completed} of ${milestones.length} milestones reached</p></div><b class="growth-progress-count">${Math.round(completed / milestones.length * 100)}%</b></div>
          <div class="growth-progress"><i style="width:${completed / milestones.length * 100}%"></i></div>
          <div class="growth-milestones">${milestones.map(m => `<div class="growth-milestone ${m.done ? 'done' : ''}"><span>${m.done ? ic('check', 16, 2.5) : ic('clock', 16, 1.8)}</span><div><b>${m.label}</b><small>${m.detail}</small></div><em>${m.done ? 'Reached' : 'In progress'}</em></div>`).join('')}</div>
          ${nextMilestone ? `<p class="growth-next">Next up: <b>${nextMilestone.label}</b></p>` : '<p class="growth-next">Every milestone reached. Keep going.</p>'}
        </section>
        <p class="growth-disclaimer">Growth figures use sales recorded in this Strap workspace on this device. Store visits and conversion rates are not included until online-store analytics are connected.</p>
      ` : `
        <section class="growth-empty">
          <span>${ic('growth', 30, 1.8)}</span><h2>Your growth starts with a sale</h2>
          <p>Once you record sales, this page will show revenue trends, product performance and business milestones.</p>
          <div class="growth-empty-steps"><div><b>01</b><span>Add your products</span></div><div><b>02</b><span>Record your first sale</span></div><div><b>03</b><span>Track your progress here</span></div></div>
        </section>`);
    };
    draw();
    root.addEventListener('change', e => { if (e.target.matches('.growth-period')) { rangeDays = [7,30,90].includes(Number(e.target.value)) ? Number(e.target.value) : 7; draw(); } });
    root.addEventListener('click', e => {
      const point = e.target.closest('[data-growth-point]');
      if (point) {
        const i = Number(point.dataset.growthPoint);
        const sales = StrapStore.sales().filter(x => Number.isFinite(Number(x.ts)) && Number(x.ts) > 0);
        const now = new Date(), today = new Date(now); today.setHours(0,0,0,0);
        const start = new Date(today); start.setDate(start.getDate()-(rangeDays-1));
        const date = new Date(start); date.setDate(start.getDate()+Math.floor(i*rangeDays/7));
        const next = new Date(start); next.setDate(start.getDate()+Math.floor((i+1)*rangeDays/7));
        if(next<=date) next.setDate(date.getDate()+1);
        const rows = sales.filter(x => Number(x.ts)>=date.getTime() && Number(x.ts)<next.getTime());
        const value = rows.reduce((sum,x)=>sum+(Number(x.total)||0),0);
        const label = date.toLocaleDateString('en-NG',{weekday:'short'})+' '+date.toLocaleDateString('en-NG',{day:'numeric',month:'short'})+' · '+ctx.money(value);
        const tooltip = root.querySelector('.growth-tooltip'); if (tooltip) tooltip.textContent=label;
        root.querySelectorAll('[data-growth-point]').forEach(el=>{const selected=Number(el.dataset.growthPoint)===i;el.classList.toggle('active',selected);if(el.tagName==='BUTTON')el.classList.toggle('today',selected);});
        const guide = root.querySelector('.growth-chart-guide'), dot = root.querySelector('.growth-chart-point.active .growth-point-dot');
        if(guide && dot){const x=dot.getAttribute('cx');guide.setAttribute('x1',x);guide.setAttribute('x2',x);}
      }
      if (e.target.closest('[data-growth-see-all]')) ctx.go('products');
    });
    root.addEventListener('pointermove', e => {
      const stage=e.target.closest('.growth-chart-stage'); if(!stage || (e.pointerType==='mouse' && e.buttons!==0)) return;
      const svg=stage.querySelector('.growth-line-chart'); if(!svg) return;
      const rect=svg.getBoundingClientRect(), x=(e.clientX-rect.left)/Math.max(1,rect.width)*700;
      const index=Math.max(0,Math.min(6,Math.round((x-20)/110)));
      const button=root.querySelector('.growth-chart-x [data-growth-point="'+index+'"]'); if(button) button.click();
    });
    root.addEventListener('keydown', e => {
      if ((e.key==='Enter'||e.key===' ') && e.target.matches('.growth-chart-point')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click',{bubbles:true})); }
    });
    return { onShow: draw };
  }
  function online(root, ctx) {
    let store=null, products=[], loading=false;
    const field=(label,key,value,ph,type='text')=>'<label class="sf-admin-field"><span>'+label+'</span><input name="'+key+'" type="'+type+'" value="'+esc(value||'')+'" placeholder="'+esc(ph||'')+'"></label>';
    const area=(label,key,value,ph)=>'<label class="sf-admin-field sf-admin-wide"><span>'+label+'</span><textarea name="'+key+'" rows="2" placeholder="'+esc(ph||'')+'">'+esc(value||'')+'</textarea></label>';
    const val=(key)=>{const n=root.querySelector('[name="'+key+'"]');return n?n.value.trim():'';};
    const request=(method,path,body)=>StrapAPI.call(method,path,body);
    async function load(){
      root.innerHTML=head('store','Online store')+'<section class="sf-admin-loading">Loading your storefront…</section>';
      const r=await request('GET','storefront');
      if(!r.ok){root.innerHTML=head('store','Online store')+'<section class="sf-admin-error">'+esc(r.msg||'Could not load your store.')+'</section>';return;}
      store=r.store;
      if(store){const p=await request('GET','storefront/products');products=p.ok?p.products||[]:[];}
      draw();
    }
    function draw(){
      const s=store||{name:ctx.store.bizname||'',slug:'',currency:ctx.store.currency||'NGN',status:'draft',settings:{}}, x=s.settings||{}, bank=x.bankTransfer||{};
      root.innerHTML=head('store','Online store')+
        '<section class="sf-admin-intro"><div><span class="sf-admin-kicker">YOUR STOREFRONT</span><h2>Sell online, your way.</h2><p>Publish a product catalogue and receive orders. Buyers pay by bank transfer or pay on delivery. You verify transfers yourself.</p></div><span class="sf-admin-state">'+(s.status==='published'?'Published':'Draft')+'</span></section>'+
        '<form id="sf-store-form" class="sf-admin-card"><h3>Store details</h3><div class="sf-admin-grid">'+
        field('Store name','name',s.name,'Your business name')+field('Store address (slug)','slug',s.slug,'your-store')+field('Currency','currency',s.currency,'NGN')+
        area('Store description','description',x.description,'What do you sell?')+field('Contact phone','phone',x.phone,'Phone number')+field('Contact email','email',x.email,'Email address','email')+
        area('Store announcement','announcement',x.announcement,'A short announcement')+field('Delivery fee','deliveryFee',x.deliveryFee||0,'0','number')+
        '</div><h3>Bank transfer details</h3><p class="sf-admin-help">These details are shown to buyers who choose Bank Transfer. No payment gateway is connected.</p><div class="sf-admin-grid">'+
        field('Bank name','bankName',bank.bankName,'Bank name')+field('Account number','accountNumber',bank.accountNumber,'Account number')+field('Account name','accountName',bank.accountName,'Account name')+
        area('Transfer instructions','bankInstructions',bank.instructions,'Optional instructions for buyers')+
        '</div><label class="sf-admin-publish"><input type="checkbox" name="publish" '+(s.status==='published'?'checked':'')+'><span><b>Publish storefront</b><small>Make your store and visible products available to buyers.</small></span></label>'+
        '<div class="sf-admin-actions"><button class="pm-add" type="submit" '+(loading?'disabled':'')+'>Save store settings</button>'+(s.slug?'<a class="sf-admin-link" target="_blank" rel="noopener" href="/store/'+encodeURIComponent(s.slug)+'">Open storefront ↗</a>':'')+'</div>'+
        '<p class="sf-admin-help">Custom domains: <b>Coming soon</b>. Your Strap store link works without a custom domain.</p></form>'+
        (store?'<section class="sf-admin-card"><div class="sf-admin-title-row"><div><h3>Product catalogue</h3><p class="sf-admin-help">Sync your existing Strap products, then choose which ones appear online.</p></div><button class="pm-imp" type="button" data-sync>Sync products</button></div>'+
        (products.length?'<div class="sf-admin-products">'+products.map(p=>'<article class="sf-admin-product"><div class="sf-admin-product-copy"><b>'+esc(p.title)+'</b><small>'+ctx.money(p.price)+'</small></div><label class="sf-admin-toggle"><input type="checkbox" data-product-visible="'+esc(p.id)+'" '+(p.visible?'checked':'')+'><span>Visible online</span></label></article>').join('')+'</div>':'<p class="sf-admin-empty">No products synced yet. Tap Sync products to bring in your existing catalogue.</p>')+'</section>':'<section class="sf-admin-card"><p class="sf-admin-empty">Save your store details first. Then sync products and publish your store.</p></section>');
      root.querySelector('#sf-store-form').addEventListener('submit',save);
      const sync=root.querySelector('[data-sync]'); if(sync)sync.addEventListener('click',syncProducts);
      root.querySelectorAll('[data-product-visible]').forEach(input=>input.addEventListener('change',()=>setVisible(input)));
    }
    async function save(e){
      e.preventDefault(); if(loading)return; loading=true;
      const bankTransfer={bankName:val('bankName'),accountNumber:val('accountNumber'),accountName:val('accountName'),instructions:val('bankInstructions')};
      const settings={...(store&&store.settings||{}),description:val('description'),phone:val('phone'),email:val('email'),announcement:val('announcement'),deliveryFee:Number(val('deliveryFee'))||0,bankTransfer};
      const r=await request('POST','storefront',{name:val('name'),slug:val('slug'),currency:val('currency'),settings,status:root.querySelector('[name=publish]').checked?'published':'draft'});
      loading=false;
      if(!r.ok){ctx.toast(r.msg||'Could not save store settings.');return;}
      store=r.store; ctx.toast('Store settings saved'); draw();
    }
    async function syncProducts(){
      const b=root.querySelector('[data-sync]'); if(b){b.disabled=true;b.textContent='Syncing…';}
      const r=await request('POST','storefront/products',{});
      if(!r.ok){ctx.toast(r.msg||'Could not sync products.');if(b){b.disabled=false;b.textContent='Sync products';}return;}
      products=r.products||[];ctx.toast(r.synced+' products synced');draw();
    }
    async function setVisible(input){
      input.disabled=true;
      const r=await request('PATCH','storefront/products/update',{id:input.dataset.productVisible,visible:input.checked});
      input.disabled=false;
      if(!r.ok){input.checked=!input.checked;ctx.toast(r.msg||'Could not update product visibility.');}
    }
    load();
    return {onShow:load};
  }
  const soon = (ic, t, ill, h, p) => (root, ctx) => {
    root.innerHTML = head(ic, t) + empty(ill, h, p, `<button type="button" class="pm-add" data-n>Notify me</button>`);
    $('[data-n]', root).addEventListener('click', e => { e.currentTarget.textContent = 'You’re on the list'; e.currentTarget.disabled = true; ctx.toast('We’ll let you know when it’s ready'); });
  };
  const activity = soon('clock', 'Activity log', 'activity', 'Activity log is coming soon', 'Soon you’ll see who did what in your store, from sales to stock changes.');
  const devices = soon('phone', 'Devices & printers', 'devices', 'Devices and printers are coming soon', 'Soon you’ll connect receipt printers and scanners and manage signed-in devices.');
  function orders(root,ctx) {
    let rows=[],selected=null,loading=false;
    const req=(method,path,body)=>StrapAPI.call(method,path,body);
    const statusLabel=s=>String(s||'pending').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    async function load(){
      root.innerHTML=head('receipt','Orders')+'<section class="sf-admin-loading">Loading online orders…</section>';
      const r=await req('GET','storefront/orders');
      if(!r.ok){root.innerHTML=head('receipt','Orders')+'<section class="sf-admin-error">'+esc(r.msg||'Create your online store first.')+'</section>';return;}
      rows=r.orders||[];draw();
    }
    function detail(o){
      const items=Array.isArray(o.items_snapshot)?o.items_snapshot:[];
      const proof=o.proof_url?'<div class="sf-order-proof"><b>Payment proof</b><a href="'+esc(o.proof_url)+'" target="_blank" rel="noopener">Open original file ↗</a>'+(String(o.proof_media_id||'')&&items.length>=0?'<img src="'+esc(o.proof_url)+'" alt="Uploaded bank transfer proof" loading="lazy" onerror="this.hidden=true">':'')+'</div>':'<p class="sf-admin-help">No proof file uploaded. Sender details: '+esc(o.sender_name||'Not provided')+' · Reference: '+esc(o.transfer_reference||'Not provided')+'</p>';
      return '<section class="sf-order-detail"><div class="sf-order-columns"><div><h4>Buyer</h4><p>'+esc(o.buyer_name)+'<br>'+esc(o.buyer_phone)+'<br>'+esc(o.buyer_email||'')+'</p><h4>Delivery</h4><p>'+esc(o.delivery_address)+'<br>'+esc([o.delivery_city,o.delivery_region].filter(Boolean).join(', '))+'<br>'+esc(o.delivery_note||'')+'</p></div><div><h4>Items</h4>'+items.map(i=>'<p>'+esc(i.title)+' × '+Number(i.quantity||1)+' — '+ctx.money(i.line_total)+'</p>').join('')+'<b>Total: '+ctx.money(o.total)+'</b></div></div>'+
        (o.payment_method==='bank_transfer'?proof+'<p><b>Sender:</b> '+esc(o.sender_name||'Not provided')+' · <b>Reference:</b> '+esc(o.transfer_reference||'Not provided')+'</p><p>'+esc(o.payment_note||'')+'</p>':'<p class="sf-admin-help">Pay on Delivery — no upfront payment proof required.</p>')+
        (o.rejection_reason?'<p class="sf-order-reason"><b>Payment flagged:</b> '+esc(o.rejection_reason)+'</p>':'')+
        '<label class="sf-admin-field"><span>Seller note</span><textarea data-note rows="2">'+esc(o.seller_note||'')+'</textarea></label><button type="button" class="pm-imp" data-note-save="'+esc(o.id)+'">Save note</button>'+
        (o.payment_method==='bank_transfer'&&o.payment_status!=='verified'?'<div class="sf-admin-actions"><button class="pm-add" type="button" data-order-action="verify" data-id="'+esc(o.id)+'">Payment Verified · Confirm Order</button><button class="pm-imp" type="button" data-order-action="request_reupload" data-id="'+esc(o.id)+'">Request re-upload</button><button class="pm-imp danger" type="button" data-order-action="reject" data-id="'+esc(o.id)+'">Payment Rejected</button></div>':'')+
        '<label class="sf-admin-field"><span>Fulfillment status</span><select data-fulfillment="'+esc(o.id)+'">'+['pending','confirmed','processing','shipped','delivered','cancelled'].map(s=>'<option value="'+s+'" '+(o.fulfillment_status===s?'selected':'')+'>'+statusLabel(s)+'</option>').join('')+'</select></label></section>';
    }
    function draw(){
      root.innerHTML=head('receipt','Orders')+'<section class="sf-orders-head"><div><h2>Online orders</h2><p>Bank transfers are verified manually. Pay on Delivery orders need no payment proof.</p></div><button type="button" class="pm-imp" data-refresh>Refresh</button></section>'+
        (rows.length?'<div class="sf-order-list">'+rows.map(o=>'<article class="sf-order-card '+(selected===o.id?'is-open':'')+'" data-order-card="'+esc(o.id)+'"><button type="button" class="sf-order-summary" data-order="'+esc(o.id)+'"><span><b>#'+o.order_number+' · '+esc(o.buyer_name)+'</b><small>'+new Date(o.created_at).toLocaleString()+' · '+esc(o.payment_method==='bank_transfer'?'Bank Transfer':'Pay on Delivery')+'</small></span><span class="sf-order-total">'+ctx.money(o.total)+'<small>'+statusLabel(o.payment_status)+' · '+statusLabel(o.fulfillment_status)+'</small></span></button>'+(selected===o.id?detail(o):'')+'</article>').join('')+'</div>':'<section class="sf-admin-empty"><h3>No online orders yet</h3><p>Orders placed through your published storefront will appear here.</p></section>');
    }
    async function update(id,action,extra={}){
      const r=await req('PATCH','storefront/order/update',{id,action,...extra});
      if(!r.ok){ctx.toast(r.msg||'Could not update order.');return;}
      ctx.toast(action==='verify'?'Payment verified and order confirmed':action==='reject'?'Payment rejected':'Order updated');await load();
    }
    root.addEventListener('click',async e=>{
      if(e.target.closest('[data-refresh]'))return load();
      const open=e.target.closest('[data-order]');if(open){selected=selected===open.dataset.order?null:open.dataset.order;draw();return;}
      const action=e.target.closest('[data-order-action]');if(action){let reason='';if(action.dataset.orderAction!=='verify')reason=prompt(action.dataset.orderAction==='request_reupload'?'Tell the buyer what to re-upload:':'Why are you rejecting this payment?')||'';if(action.dataset.orderAction!=='verify'&&!reason.trim())return ctx.toast('Add a reason so the buyer knows what to fix.');return update(action.dataset.id,action.dataset.orderAction,{reason});}
      const note=e.target.closest('[data-note-save]');if(note){const area=root.querySelector('[data-note]');return update(note.dataset.noteSave,'note',{seller_note:area?area.value:''});}
    });
    root.addEventListener('change',e=>{const s=e.target.closest('[data-fulfillment]');if(s)update(s.dataset.fulfillment,'status',{fulfillment_status:s.value});});
    load();return {onShow:load};
  }
  function mcp(root, ctx) {
    const endpoint = 'https://strap60.vercel.app/api/mcp';
    let snapshot = { branches: [], oauth_connections: [], connections: [], activity: [] };
    let watchTimer = null, watchVis = null;
    const request = async (method, body) => {
      const response = await fetch('/api/mcp/keys', { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Could not load MCP settings.');
      return data;
    };
    const toolsRead = ['Read store profile','List permitted branches','Search products','Check low stock','Read sales history','Search customers'];
    const toolsWrite = ['Create products','Update products','Change stock','Upload product images'];
    const PATHS = { eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', pen: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4', plus: 'M12 5v14M5 12h14', chev: 'M9 5l7 7-7 7', lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z', check: 'M5 12.5l4.5 4.5L19 7.5', close: 'M6 6l12 12M18 6L6 18' };
    const ic = (n, s = 22, w = 2) => '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + PATHS[n] + '"/></svg>';
    const cutArt = '<svg class="mcp-cut" viewBox="0 0 320 120" aria-hidden="true"><circle class="a" cx="54" cy="60" r="40" fill="none" stroke-width="3"/><circle class="b" cx="54" cy="60" r="26"/><circle class="c" cx="54" cy="60" r="11"/><path class="a" d="M102 60h44M182 60h44" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 8"/><path class="x" d="M157 49l10 22M167 49l-10 22" stroke-width="4" stroke-linecap="round"/><rect class="b" x="234" y="28" width="64" height="64" rx="22"/><path class="c" d="M266 44q2.4 14 16 16-13.6 2-16 16-2.4-14-16-16 13.6-2 16-16z"/></svg>';
    const initial = item => (String(item.client_name || '').trim()[0] || '✦').toUpperCase();
    const appIcon = item => {
      let src = item.logo_uri || '', fb = '';
      if (item.client_uri) { try { fb = new URL('/favicon.ico', item.client_uri).toString(); } catch (_) {} }
      if (!src) { src = fb; fb = ''; }
      if (!src) return '<span class="mcp-app-fallback">' + esc(initial(item)) + '</span>';
      return '<img class="mcp-app-icon" src="' + esc(src) + '" data-fb="' + esc(fb) + '" data-initial="' + esc(initial(item)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    };
    const hostOf = item => { try { return new URL(item.client_uri).host; } catch (_) { return ''; } };
    const branchSummary = item => {
      const ids = Array.isArray(item.branch_ids) ? item.branch_ids.map(String) : ['*'];
      return ids.includes('*') ? 'All branches' : ids.map(id => (snapshot.branches.find(b => String(b.id) === id) || {}).name || id).join(', ');
    };
    const isWrite = item => (item.scopes || []).includes('store:write');
    const renderConnections = () => {
      const apps = Array.isArray(snapshot.oauth_connections) ? snapshot.oauth_connections : [];
      if (!apps.length) return '<div class="mcp-empty">' + cutArt + '<b>Nothing connected yet</b><p>Apps you connect will show up here, each with its own permissions.</p></div>';
      return apps.map(item => {
        const revoked = !!item.revoked_at;
        return '<button type="button" class="mcp-linked-app' + (revoked ? ' is-revoked' : '') + '" data-manage="' + esc(item.client_id) + '" aria-label="Manage ' + esc(item.client_name || 'AI app') + '">' +
          appIcon(item) + '<span class="mcp-linked-copy"><b>' + esc(item.client_name || 'Connected AI app') + '</b><small>' + esc(hostOf(item) || 'AI connection') + '</small><span class="mcp-linked-meta">' + (revoked ? 'Access revoked' : (isWrite(item) ? 'Read and write' : 'Read only')) + ' · ' + esc(branchSummary(item)) + '</span></span>' +
          '<span class="mcp-status' + (revoked ? ' is-revoked' : '') + '">' + (revoked ? 'Revoked' : 'Connected') + '</span><span class="mcp-chev">' + ic('chev', 18, 2.2) + '</span></button>';
      }).join('');
    };
    const appSettings = item => {
      const ids = Array.isArray(item.branch_ids) ? item.branch_ids.map(String) : ['*'];
      const all = ids.includes('*'), write = isWrite(item), revoked = !!item.revoked_at;
      const chip = (v, label, on) => '<label class="mcp-chip"><input type="checkbox" name="mcp-branch" value="' + esc(v) + '" ' + (on ? 'checked' : '') + '><span>' + esc(label) + '</span></label>';
      const opt = (v, title, desc, icon, on) => '<label class="mcp-opt"><input type="radio" name="mcp-scope" value="' + v + '" ' + (on ? 'checked' : '') + '><span class="mcp-opt-body"><span class="mcp-opt-ic">' + ic(icon, 21) + '</span><span class="mcp-opt-tx"><b>' + title + '</b><small>' + desc + '</small></span><span class="mcp-rd"></span></span></label>';
      const perms = list => '<ul class="mcp-perms">' + list.map(t => '<li>' + ic('check', 15, 2.8) + esc(t) + '</li>').join('') + '</ul>';
      return '<div class="mcp-sheet-app">' + appIcon(item) + '<div><b>' + esc(item.client_name || 'Connected AI app') + '</b><small>' + esc(item.client_uri || 'Approved AI connection') + '</small></div><span class="mcp-status' + (revoked ? ' is-revoked' : '') + '">' + (revoked ? 'Revoked' : 'Connected') + '</span></div>' +
        '<div class="mcp-gh">What it can do</div>' +
        opt('read', 'Read only', 'Can look at your store. Can’t change anything.', 'eye', !write) +
        opt('write', 'Read and write', 'Can also add products, edit them and change stock.', 'pen', write) +
        '<div class="mcp-gh">Branches</div><div class="mcp-chips">' + chip('*', 'All branches', all) + snapshot.branches.map(b => chip(b.id, b.name, !all && ids.includes(String(b.id)))).join('') + '</div>' +
        '<div class="mcp-gh">Included</div><div class="mcp-perm-group"><b>Can see</b>' + perms(toolsRead) + '</div>' +
        '<div class="mcp-perm-group mcp-write' + (write ? '' : ' is-locked') + '"><b>Can change</b>' + perms(toolsWrite) + '<small>Choose Read and write to allow these.</small></div>' +
        '<div class="mcp-sheet-actions"><button class="mcp-btn" type="button" data-oauth-save="' + esc(item.client_id) + '">' + (revoked ? 'Restore access' : 'Save changes') + '</button>' +
        (revoked ? '' : '<button class="mcp-btn danger" type="button" data-revoke-oauth="' + esc(item.client_id) + '">Revoke access</button>') + '</div>';
    };
    const closeSheet = () => { stopWatch(); const sheet = root.querySelector('.mcp-sheet-backdrop'); if (sheet) sheet.remove(); document.body.classList.remove('mcp-sheet-open'); };
    const openSheet = (title, body, kind) => {
      closeSheet();
      const sheet = document.createElement('div'); sheet.className = 'mcp-sheet-backdrop'; sheet.dataset.mcpSheet = kind || 'settings';
      sheet.innerHTML = '<section class="mcp-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
        '<div class="mcp-sheet-grip"></div><header><h3>' + esc(title) + '</h3><button type="button" class="mcp-sheet-close" data-close-sheet aria-label="Close">' + ic('close', 19, 2.2) + '</button></header>' +
        '<div class="mcp-sheet-content">' + body + '</div></section>';
      root.appendChild(sheet); document.body.classList.add('mcp-sheet-open');
      requestAnimationFrame(() => sheet.classList.add('is-open'));
    };
    const confirmBox = (title, text, yes) => new Promise(resolve => {
      const m = document.createElement('div'); m.className = 'mcp-modal';
      m.innerHTML = '<div class="mcp-modal-card" role="alertdialog" aria-modal="true" aria-label="' + esc(title) + '">' + cutArt + '<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><button type="button" class="mcp-btn danger" data-y>' + esc(yes) + '</button><button type="button" class="mcp-btn alt" data-n>Keep it</button></div>';
      const done = v => { m.classList.remove('is-open'); setTimeout(() => m.remove(), 220); resolve(v); };
      m.addEventListener('click', e => { if (e.target.closest('[data-y]')) done(true); else if (e.target.closest('[data-n]') || e.target === m) done(false); });
      root.appendChild(m); requestAnimationFrame(() => m.classList.add('is-open'));
    });
    const activityMarkup = limit => {
      const list = (snapshot.activity || []).slice(0, limit || 100);
      if (!list.length) return '<p class="mcp-note">Actions taken by connected AI apps will appear here.</p>';
      return '<div class="mcp-activity-list">' + list.map(item => {
        const action = String(item.action || 'AI activity').replaceAll('strap_', '').replaceAll('_', ' ');
        return '<div><span class="mcp-activity-dot' + (/create|update|change|upload|set|delete/i.test(action) ? ' is-write' : '') + '"></span><section><b>' + esc(action) + '</b><small>' + esc(item.branch_id || 'Store') + ' · ' + esc(item.created_at ? new Date(item.created_at).toLocaleString() : 'Recently') + '</small></section></div>';
      }).join('') + '</div>';
    };
    const tokenMarkup = () => {
      const tokens = (snapshot.connections || []).map(item => '<div class="mcp-token-row"><div><b>' + esc(item.name || 'Private connection') + '</b><small>Private token · ' + esc(isWrite(item) ? 'Read and write' : 'Read only') + '</small></div><button class="mcp-mini danger" type="button" data-revoke="' + esc(item.id) + '">Revoke</button></div>').join('');
      return tokens || '<p class="mcp-note">No private tokens created.</p>';
    };
    const connectMarkup = () => '<p class="mcp-sheet-intro">Add Strap to your AI app. Once it connects, Strap detects the app’s name and icon for you.</p>' +
      '<div class="mcp-gh">Server address</div><div class="mcp-key"><input readonly value="' + endpoint + '" aria-label="MCP server address"><button type="button" data-copy-endpoint>Copy</button></div>' +
      '<ol class="mcp-steps"><li>Open your AI app and choose <b>Add custom connector</b> or <b>Add MCP server</b>.</li><li>Paste the server address. In Claude, choose <b>Use Claude’s published identity</b> when asked about OAuth client identity.</li><li>Continue to Strap, sign in and approve the access it asks for.</li></ol>' +
      '<div class="mcp-wait" id="mcp-wait" aria-live="polite"><i class="mcp-spin"></i><span>Waiting for your AI app to connect…</span></div>' +
      '<p class="mcp-safety-note">Only approve connection requests you started.</p>' +
      '<details class="mcp-token-create"><summary>Create a private token instead</summary><p class="mcp-note">For AI clients that can’t use secure browser approval. Treat a token like a password.</p>' +
      '<label class="mcp-field"><span>Connection name</span><input id="mcp-name" maxlength="80" placeholder="e.g. Local automation" autocomplete="off"></label>' +
      '<label class="mcp-field"><span>Branch access</span><select id="mcp-branch"><option value="*">All branches</option>' + snapshot.branches.map(b => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('') + '</select></label>' +
      '<label class="mcp-field"><span>Permissions</span><select id="mcp-scope"><option value="read">Read only</option><option value="write">Read and write</option></select></label>' +
      '<button class="mcp-btn" type="button" data-create>Generate private token</button><div id="mcp-new-token" hidden></div></details>' +
      '<div class="mcp-existing-tokens"><b>Private tokens</b>' + tokenMarkup() + '</div>';
    const paintHome = () => {
      const apps = Array.isArray(snapshot.oauth_connections) ? snapshot.oauth_connections : [];
      const active = apps.filter(x => !x.revoked_at).length;
      const c = $('#mcp-count', root); if (c) c.textContent = apps.length ? active + ' connected' : '';
      const l = $('#mcp-connections', root); if (l) l.innerHTML = renderConnections();
      const a = $('#mcp-activity', root); if (a) a.innerHTML = activityMarkup(5);
      const all = $('#mcp-all', root); if (all) all.hidden = !(snapshot.activity || []).length;
    };
    /* ---- auto-detect the app: no picking, we watch for the new connection ---- */
    function stopWatch() { if (watchTimer) clearInterval(watchTimer); watchTimer = null; if (watchVis) document.removeEventListener('visibilitychange', watchVis); watchVis = null; }
    const startWatch = () => {
      stopWatch();
      const base = new Map((snapshot.oauth_connections || []).map(x => [String(x.client_id), !!x.revoked_at]));
      const started = Date.now();
      const check = async () => {
        if (!root.querySelector('[data-mcp-sheet="connect"]') || Date.now() - started > 900000) return stopWatch();
        try {
          const fresh = await request('GET'); snapshot = fresh;
          const hit = (fresh.oauth_connections || []).find(x => !x.revoked_at && (!base.has(String(x.client_id)) || base.get(String(x.client_id)) === true));
          if (!hit) return;
          stopWatch(); paintHome();
          const box = $('#mcp-wait', root);
          if (box) { box.className = 'mcp-found'; box.innerHTML = appIcon(hit) + '<span><b>' + esc(hit.client_name || 'Your AI app') + ' is connected</b><small>' + esc(hostOf(hit) || 'Approved just now') + '</small></span><div class="mcp-found-actions"><button class="mcp-btn" type="button" data-manage="' + esc(hit.client_id) + '">Choose permissions</button><button class="mcp-btn alt" type="button" data-close-sheet>Done</button></div>'; }
          ctx.toast((hit.client_name || 'AI app') + ' connected');
        } catch (_) {}
      };
      watchTimer = setInterval(check, 3000);
      watchVis = () => { if (!document.hidden) check(); };
      document.addEventListener('visibilitychange', watchVis);
    };
    const draw = async () => {
      root.innerHTML = head('plug', 'MCP') +
        '<section class="mcp-home"><p class="mcp-lede">Let an AI app work with your store. You decide what it can do, and you can stop it any time.</p>' +
        '<button class="mcp-connect-btn" type="button" data-open-connect>Connect an AI app<i>' + ic('plus', 22, 2.4) + '</i></button>' +
        '<div class="mcp-sec"><h2>Your apps</h2><small id="mcp-count"></small></div>' +
        '<div id="mcp-connections" class="mcp-linked-list"><div class="mcp-loading"><i class="mcp-spin"></i>Loading connected apps…</div></div>' +
        '<div class="mcp-sec"><h2>Recent activity</h2><button type="button" class="mcp-link" id="mcp-all" data-open-activity hidden>See all</button></div>' +
        '<div id="mcp-activity"></div></section>';
      try { snapshot = await request('GET'); paintHome(); }
      catch (error) { $('#mcp-connections', root).innerHTML = '<div class="mcp-empty"><b>Could not load connections</b><p>' + esc(error.message) + '</p><button class="mcp-mini" type="button" data-refresh>Try again</button></div>'; }
    };
    root.addEventListener('error', event => {
      const img = event.target; if (!img || img.tagName !== 'IMG' || !img.classList.contains('mcp-app-icon')) return;
      if (img.dataset.fb && !img.dataset.tried) { img.dataset.tried = '1'; img.src = img.dataset.fb; return; }
      img.replaceWith(Object.assign(document.createElement('span'), { className: 'mcp-app-fallback', textContent: img.dataset.initial || '✦' }));
    }, true);
    root.addEventListener('change', event => {
      const t = event.target, sheet = t.closest && t.closest('.mcp-sheet'); if (!sheet) return;
      if (t.name === 'mcp-scope') { const g = $('.mcp-write', sheet); if (g) g.classList.toggle('is-locked', t.value !== 'write'); }
      if (t.name === 'mcp-branch') {
        const boxes = Array.from(sheet.querySelectorAll('input[name="mcp-branch"]')), all = boxes.find(b => b.value === '*');
        if (t.value === '*' && t.checked) boxes.forEach(b => { if (b !== t) b.checked = false; });
        else if (t.checked && all) all.checked = false;
        if (!boxes.some(b => b.checked) && all) all.checked = true;
      }
    });
    root.addEventListener('click', async event => {
      if (event.target.closest('[data-close-sheet]') || (event.target.classList.contains('mcp-sheet-backdrop'))) return closeSheet();
      if (event.target.closest('[data-open-connect]')) { openSheet('Connect an AI app', connectMarkup(), 'connect'); return startWatch(); }
      if (event.target.closest('[data-open-activity]')) return openSheet('Recent AI activity', activityMarkup(), 'activity');
      if (event.target.closest('[data-refresh]')) return draw();
      const manage = event.target.closest('[data-manage]');
      if (manage) { const item = (snapshot.oauth_connections || []).find(x => String(x.client_id) === manage.dataset.manage); if (item) openSheet('Manage connection', appSettings(item), 'app'); return; }
      if (event.target.closest('[data-copy-endpoint]')) return copy(endpoint, 'MCP server URL');
      const createButton = event.target.closest('[data-create]');
      if (createButton) {
        createButton.disabled = true;
        try {
          const name = $('#mcp-name', root).value.trim() || 'AI connection';
          const scope = $('#mcp-scope', root).value, branch = $('#mcp-branch', root).value || '*';
          const data = await request('POST', { name, scopes: scope === 'write' ? ['store:read', 'store:write'] : ['store:read'], branch_ids: [branch] });
          const panel = $('#mcp-new-token', root); panel.hidden = false;
          const config = JSON.stringify({ url: endpoint, headers: { Authorization: 'Bearer ' + data.access_token } }, null, 2);
          panel.innerHTML = '<p class="mcp-note"><b>Copy this token now.</b> Strap will not show it again.</p><textarea readonly rows="3" id="mcp-token-value">' + esc(data.access_token) + '</textarea><button type="button" class="mcp-btn" data-copy-token>Copy token</button><textarea readonly rows="5" id="mcp-config-value">' + esc(config) + '</textarea><button type="button" class="mcp-btn alt" data-copy-config>Copy client configuration</button>';
          ctx.toast('Private token created');
          snapshot = await request('GET');
          const list = root.querySelector('.mcp-existing-tokens'); if (list) list.innerHTML = '<b>Private tokens</b>' + tokenMarkup();
        } catch (error) { ctx.toast(error.message); }
        finally { if (createButton.isConnected) createButton.disabled = false; }
        return;
      }
      const oauthSave = event.target.closest('[data-oauth-save]');
      if (oauthSave) {
        const sheet = oauthSave.closest('.mcp-sheet'), picked = $('input[name="mcp-scope"]:checked', sheet), scope = picked ? picked.value : 'read';
        const selected = Array.from(sheet.querySelectorAll('input[name="mcp-branch"]:checked')).map(box => box.value);
        if (!selected.length) return ctx.toast('Choose at least one branch.');
        oauthSave.disabled = true;
        try { await request('PATCH', { client_id: oauthSave.dataset.oauthSave, scopes: scope === 'write' ? ['store:read', 'store:write'] : ['store:read'], branch_ids: selected.includes('*') ? ['*'] : selected }); ctx.toast('Access settings saved'); closeSheet(); await draw(); }
        catch (error) { ctx.toast(error.message); oauthSave.disabled = false; }
        return;
      }
      const revokeOAuth = event.target.closest('[data-revoke-oauth]');
      if (revokeOAuth) {
        const item = (snapshot.oauth_connections || []).find(x => String(x.client_id) === revokeOAuth.dataset.revokeOauth), name = (item && item.client_name) || 'this app';
        if (!await confirmBox('Revoke ' + name + '?', name + ' loses access to your store right away. You can restore it later.', 'Revoke access')) return;
        try { await request('DELETE', { client_id: revokeOAuth.dataset.revokeOauth }); ctx.toast('App access revoked'); closeSheet(); await draw(); }
        catch (error) { ctx.toast(error.message); }
        return;
      }
      const revoke = event.target.closest('[data-revoke]');
      if (revoke) {
        if (!await confirmBox('Revoke this token?', 'It will stop working immediately.', 'Revoke token')) return;
        try { await request('DELETE', { id: revoke.dataset.revoke }); ctx.toast('Token revoked'); snapshot = await request('GET'); const list = root.querySelector('.mcp-existing-tokens'); if (list) list.innerHTML = '<b>Private tokens</b>' + tokenMarkup(); }
        catch (error) { ctx.toast(error.message); }
        return;
      }
      if (event.target.closest('[data-copy-token]')) return copy($('#mcp-token-value', root).value, 'Private token');
      if (event.target.closest('[data-copy-config]')) return copy($('#mcp-config-value', root).value, 'Client configuration');
    });
    draw();
  }
  function build(id, root, ctx) {
    ctxRef = ctx;
    if (id === 'collections') return collections(root, ctx);
    if (CFG[id] && id !== 'orders') return list(id, root, ctx) || {};
    if (id === 'orders') return orders(root, ctx);
    return (MAP[id] && MAP[id](root, ctx)) || {};
  }
  return { build };
})();
