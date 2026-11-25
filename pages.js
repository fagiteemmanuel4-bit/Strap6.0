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
    const draw = () => {
      const sales = S.sales();
      const now = new Date();
      const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
      const recent = sales.filter(x => Number(x.ts) >= start.getTime());
      const revenue = sales.reduce((sum, x) => sum + (Number(x.total) || 0), 0);
      const recentRevenue = recent.reduce((sum, x) => sum + (Number(x.total) || 0), 0);
      const units = sales.reduce((sum, x) => sum + (Array.isArray(x.lines) ? x.lines.reduce((n, line) => n + (Number(line.qty) || 0), 0) : 0), 0);
      const products = new Map();
      sales.forEach(sale => (Array.isArray(sale.lines) ? sale.lines : []).forEach(line => {
        const key = String(line.id || line.title || 'product');
        const item = products.get(key) || { title: line.title || 'Product', qty: 0, revenue: 0 };
        item.qty += Number(line.qty) || 0;
        item.revenue += (Number(line.price) || 0) * (Number(line.qty) || 0);
        products.set(key, item);
      }));
      const top = [...products.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(start); date.setDate(start.getDate() + i);
        const key = S.dayKey(date.getTime());
        const rows = recent.filter(s => S.dayKey(Number(s.ts)) === key);
        return { label: date.toLocaleDateString('en-NG', { weekday: 'short' }), value: rows.reduce((sum, x) => sum + (Number(x.total) || 0), 0), count: rows.length };
      });
      const max = Math.max(1, ...days.map(x => x.value));
      root.innerHTML = head('growth', 'Growth') + (sales.length ? `
        <section class="pg-big"><span>All-time sales revenue</span><b>${ctx.money(revenue)}</b><small>${sales.length.toLocaleString('en-NG')} sales recorded · ${units.toLocaleString('en-NG')} items sold</small></section>
        <div class="pg-sum two"><div><b>${ctx.money(recentRevenue)}</b><small>Last 7 days</small></div><div><b>${recent.length.toLocaleString('en-NG')}</b><small>Sales this week</small></div></div>
        <section class="pg-card"><h3>Sales over the last 7 days</h3><div class="pg-bars">${days.map(day => `<i title="${day.label}: ${ctx.money(day.value)} · ${day.count} sales" style="--h:${Math.max(day.value ? 8 : 0, day.value / max * 100)}%;--d:${days.indexOf(day) * 50}ms"></i>`).join('')}</div><div class="pg-bar-labels">${days.map(day => `<small>${day.label}</small>`).join('')}</div></section>
        <section class="pg-card"><h3>Best-selling products</h3>${top.length ? `<div class="pg-rows">${top.map((item, i) => `<div class="pg-r"><span>${i + 1}. ${esc(item.title)}</span><b>${item.qty.toLocaleString('en-NG')} sold</b></div>`).join('')}</div>` : '<p>No product sales yet.</p>'}</section>
        <p class="pg-note">Visitor counts and conversion rates will appear when online-store analytics tracking is connected. These figures are based on sales recorded in Strap on this device.</p>
      ` : empty('growth', 'Your growth starts here', 'Record your first sale to see revenue trends, sales activity and your best-selling products.'));
    };
    draw();
    return { onShow: draw };
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
    const endpoint = 'https://strap60.vercel.app/api/mcp';
    const request = async (method, body) => {
      const response = await fetch('/api/mcp/keys', { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Could not load MCP settings.');
      return data;
    };
    const renderConnections = data => {
      const keys=(data.connections||[]).map(item=>'<div class="pg-r"><div><b>'+esc(item.name)+'</b><small>'+esc(item.token_prefix)+'… · '+esc(item.scopes.join(', '))+' · '+esc(item.branch_ids.includes('*')?'All branches':item.branch_ids.join(', '))+'</small></div><button class="pm-imp" type="button" data-revoke="'+esc(item.id)+'">Revoke</button></div>').join('');
      const oauth=(data.oauth_connections||[]).map(item=>{
        const allBranches=item.branch_ids.includes('*'); const branches='<option value="*" '+(allBranches?'selected':'')+'>All branches</option>' +(data.branches||[]).map(b=>'<option value="'+esc(b.id)+'" '+(!allBranches&&item.branch_ids.includes(String(b.id))?'selected':'')+'>'+esc(b.name)+'</option>').join('');
        const revoked=!!item.revoked_at;
        return '<div class="pg-card" data-oauth-card="'+esc(item.client_id)+'"><div class="pg-r"><div><b>'+esc(item.client_name||'OAuth AI client')+'</b><small>OAuth client · '+esc(item.client_id)+'</small></div><b class="pg-pill">'+(revoked?'Revoked':'Connected')+'</b></div>'+(revoked?'<p class="pg-note">Access is blocked until you explicitly restore this connection.</p>':'')+'<label class="pm-fl"><span>Permissions</span><select data-oauth-scope><option value="read" '+(!item.scopes.includes('store:write')?'selected':'')+'>Read only</option><option value="write" '+(item.scopes.includes('store:write')?'selected':'')+'>Read and write products / stock</option></select></label><label class="pm-fl"><span>Allowed branches</span><select data-oauth-branches multiple size="3">'+branches+'</select></label><button class="pm-imp" type="button" data-oauth-save="'+esc(item.client_id)+'">'+(revoked?'Restore connection':'Save permissions')+'</button>'+(revoked?'':'<button class="pm-imp" type="button" data-revoke-oauth="'+esc(item.client_id)+'">Revoke OAuth access</button>')+'</div>';
      }).join('');
      return (keys||oauth)?keys+oauth:'<p class="pg-note">No AI connections yet. Connect an OAuth client or create an access token above.</p>';
    };
    const copy = async (value, label) => {
      try { await navigator.clipboard.writeText(value); ctx.toast(label + ' copied'); }
      catch (_) { ctx.toast('Copy is not available in this browser.'); }
    };
    const draw = async () => {
      root.innerHTML = head('plug', 'MCP') + '<section class="pg-card"><h3>Connect your AI tools</h3><p>Connect Claude or another MCP-compatible AI client. OAuth sign-in is supported, and private access tokens are available for clients that need them.</p><div class="pg-r"><span>Server address</span><b>strap60.vercel.app</b></div><button class="pm-imp" type="button" data-copy-endpoint>' + ic('copy', 18, 2) + ' Copy MCP address</button><p class="pg-note">Server URL: <code>' + endpoint + '</code></p><p class="pg-note">Strap icon: <code>https://strap60.vercel.app/favicon.svg</code></p></section><section class="pg-card"><h3>Create an AI connection</h3><p>Each connection gets its own access token. Start with read-only access; only enable writing when you trust the AI client.</p><label class="pm-fl"><span>Connection name</span><input id="mcp-name" maxlength="80" placeholder="e.g. Claude on my phone" autocomplete="off"></label><label class="pm-fl"><span>Branch access</span><select id="mcp-branch"><option value="*">All branches</option></select></label><label class="pm-fl"><span>Permissions</span><select id="mcp-scope"><option value="read">Read only</option><option value="write">Read and write products / stock</option></select></label><button class="pm-add wide" type="button" data-create>Generate access token</button><div id="mcp-new-token" hidden></div></section><section class="pg-card"><h3>Active connections</h3><div id="mcp-connections"><p class="pg-note">Loading connections…</p></div></section><section class="pg-card"><h3>Recent AI activity</h3><div id="mcp-activity"><p class="pg-note">Loading activity…</p></div></section>';
      try {
        const data = await request('GET');
        const branch = $('#mcp-branch', root);
        branch.innerHTML = '<option value="*">All branches</option>' + (data.branches || []).map(b => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('');
        const connections = $('#mcp-connections', root);
        connections.innerHTML = renderConnections(data);
        const activity = $('#mcp-activity', root);
        activity.innerHTML = data.activity && data.activity.length ? data.activity.map(item => '<div class="pg-r"><div><b>' + esc(item.action.replaceAll('strap_', '').replaceAll('_', ' ')) + '</b><small>' + esc(item.branch_id || 'Store') + ' · ' + esc(new Date(item.created_at).toLocaleString()) + '</small></div></div>').join('') : '<p class="pg-note">No AI actions recorded yet.</p>';
      } catch (error) {
        if (/Premium/i.test(error.message)) {
          $('#mcp-connections', root).innerHTML = '<p class="pg-note">MCP connections require Strap Premium. Upgrade your plan to enable AI access.</p>';
          $('#mcp-activity', root).innerHTML = '';
          $('[data-create]', root).disabled = true;
        } else {
          $('#mcp-connections', root).innerHTML = '<p class="pg-note">' + esc(error.message) + '</p>';
          $('#mcp-activity', root).innerHTML = '';
        }
      }
    };
    root.addEventListener('click', async event => {
      const copyButton = event.target.closest('[data-copy-endpoint]');
      if (copyButton) return copy(endpoint, 'MCP address');
      const createButton = event.target.closest('[data-create]');
      if (createButton) {
        createButton.disabled = true;
        try {
          const name = $('#mcp-name', root).value.trim() || 'AI connection';
          const scope = $('#mcp-scope', root).value;
          const branch = $('#mcp-branch', root).value || '*';
          const data = await request('POST', { name, scopes: scope === 'write' ? ['store:read', 'store:write'] : ['store:read'], branch_ids: [branch] });
          const panel = $('#mcp-new-token', root);
          panel.hidden = false;
          const config = JSON.stringify({ url: endpoint, headers: { Authorization: 'Bearer ' + data.access_token } }, null, 2);
          panel.innerHTML = '<div class="pg-note"><b>Copy this token now.</b> Strap will not show it again.</div><textarea readonly rows="3" id="mcp-token-value">' + esc(data.access_token) + '</textarea><button type="button" class="pm-add wide" data-copy-token>Copy access token</button><p class="pg-note">Client configuration</p><textarea readonly rows="5" id="mcp-config-value">' + esc(config) + '</textarea><button type="button" class="pm-imp" data-copy-config>Copy client configuration</button><p class="pg-note">Keep this token private. Revoking the connection stops access immediately.</p>';
          ctx.toast('AI connection created');
          await drawConnectionsOnly();
        } catch (error) { ctx.toast(error.message); }
        finally { createButton.disabled = false; }
        return;
      }
      const oauthSave = event.target.closest('[data-oauth-save]');
      if (oauthSave) {
        const card=oauthSave.closest('[data-oauth-card]'), scope=$('select[data-oauth-scope]',card).value;
        const selectedBranches=Array.from($('select[data-oauth-branches]',card).selectedOptions).map(option=>option.value); const branches=selectedBranches.includes('*')?['*']:selectedBranches;
        oauthSave.disabled=true;
        try { await request('PATCH',{client_id:oauthSave.dataset.oauthSave,scopes:scope==='write'?['store:read','store:write']:['store:read'],branch_ids:branches});ctx.toast('OAuth permissions saved');await draw(); }
        catch(error){ctx.toast(error.message);oauthSave.disabled=false;}
        return;
      }
      const revokeOAuth=event.target.closest('[data-revoke-oauth]');
      if(revokeOAuth){
        if(!confirm('Revoke this OAuth connection? It will stop working immediately.'))return;
        try{await request('DELETE',{client_id:revokeOAuth.dataset.revokeOauth});ctx.toast('OAuth access revoked');await draw();}
        catch(error){ctx.toast(error.message);}
        return;
      }
      const revoke = event.target.closest('[data-revoke]');
      if (revoke) {
        if (!confirm('Revoke this AI connection? It will stop working immediately.')) return;
        try { await request('DELETE', { id: revoke.dataset.revoke }); ctx.toast('Connection revoked'); await draw(); }
        catch (error) { ctx.toast(error.message); }
        return;
      }
      if (event.target.closest('[data-copy-token]')) return copy($('#mcp-token-value', root).value, 'Access token');
      if (event.target.closest('[data-copy-config]')) return copy($('#mcp-config-value', root).value, 'Client configuration');
    });
    async function drawConnectionsOnly() {
      try {
        const data = await request('GET');
        $('#mcp-connections', root).innerHTML = renderConnections(data);
      } catch (_) {}
    }
    draw();
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
