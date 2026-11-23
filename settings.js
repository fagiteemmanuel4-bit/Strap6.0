/* Strap – Settings: store details, sales receipt designer (live preview, colours, fonts, text, JSON),
   activity PIN, sound + vibration, credit reminders, change password and sign out. */
window.StrapSettings = (() => {
  const { $, $$, el, sheet, pick, dd, confirm, colorField, switchHtml, fx, HEX } = StrapKit;
  const U = StrapUI, ic = U.ic, esc = U.esc;
  const S = StrapStore, R = StrapReceipt, Sec = StrapSec;

  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const set = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const strength = v => (v.length >= 8) + /[a-z]/i.test(v) + /\d/.test(v) + (/[^a-z0-9]/i.test(v) || v.length >= 12);

  const PAPER_OPTS = [{ v: '58mm', l: '58 mm roll', s: 'Small thermal printers' }, { v: '80mm', l: '80 mm roll', s: 'Standard receipt printers' }, { v: 'a6', l: 'A6 slip', s: 'Wider, good for invoices' }];
  const DIV_OPTS = [{ v: 'dashed', l: 'Dashed' }, { v: 'dotted', l: 'Dotted' }, { v: 'solid', l: 'Solid line' }, { v: 'double', l: 'Double line' }, { v: 'none', l: 'No divider' }];
  const SHOW = [
    ['header.showLogo', 'Logo'], ['meta.showReceiptNo', 'Receipt number'], ['meta.showDate', 'Date and time'], ['meta.showCashier', 'Cashier name'], ['meta.showCustomer', 'Customer name'], ['meta.showPayment', 'Payment method'],
    ['items.showQty', 'Quantity on each item'], ['items.showUnitPrice', 'Price of each item'], ['items.showSku', 'Item SKU'], ['totals.showSubtotal', 'Subtotal'], ['totals.showTax', 'Tax line'], ['footer.showThanks', 'Thank-you message'], ['footer.showNote', 'Policy note']
  ];

  const field = (label, path, tpl, o = {}) => `<label class="pm-fl"><span>${label}</span>${o.area ? `<textarea rows="2" data-p="${path}" placeholder="${esc(o.ph || '')}" maxlength="${o.max || 240}">${esc(get(tpl, path) || '')}</textarea>` : `<input data-p="${path}" type="${o.type || 'text'}" ${o.type === 'number' ? 'inputmode="decimal" min="0" max="100" step="0.5"' : ''} placeholder="${esc(o.ph || '')}" value="${esc(get(tpl, path) ?? '')}" autocomplete="off" maxlength="${o.max || 120}">`}</label>`;

  function mount(root, ctx) {
    let view = 'root', tab = 'details', tpl = R.load(ctx.store.bizname), saved = 0;
    const money = n => ctx.money(n);
    const hdr = (title, icon, back) => `<header class="pm-head">${back ? `<button type="button" class="pm-round" data-back aria-label="Back">${ic('back', 22, 2.2)}</button>` : ''}<h1 class="pm-title">${back ? '' : `<span class="pm-tico">${ic(icon, 24, 1.8)}</span>`}${title}</h1></header>`;
    const nav = (key, icon, label, val = '') => `<button type="button" class="pg-r st-nav" data-nav="${key}"><span class="st-ri">${ic(icon, 20, 1.8)}</span><span>${label}</span>${val ? `<b>${esc(val)}</b>` : ''}${ic('chevR', 18, 2)}</button>`;
    const sw = (key, icon, label, on, sub = '') => `<div class="pg-r static st-sw"><span class="st-ri">${ic(icon, 20, 1.8)}</span><span>${label}${sub ? `<small>${sub}</small>` : ''}</span>${switchHtml(key, on, label)}</div>`;

    /* ================= root ================= */
    function drawRoot() {
      const s = ctx.store, P = S.prefs;
      const fx = (k, i, l, v = '', c = '') => `<button type="button" class="pg-r st-nav" data-fx="${k}"><span class="st-ri">${ic(i, 20, 1.8)}</span><span${c}>${l}</span>${v ? `<b>${v}</b>` : ''}${ic('chevR', 18, 2)}</button>`;
            root.innerHTML = hdr('Settings', 'gear') + `
        <section class="pg-prof"><div class="av">${esc((s.bizname || 'S').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase())}</div><div><b>${esc(s.bizname || 'My Store')}</b><small>${esc(s.name || '')}</small></div></section>
        <h2 class="pm-h">Store</h2>
        <div class="pg-rows"><button type="button" class="pg-r st-nav" data-name><span class="st-ri">${ic('store', 20, 1.8)}</span><span>Store name</span><b>${esc(s.bizname || '')}</b>${ic('chevR', 18, 2)}</button>
          <div class="pg-r static"><span class="st-ri">${ic('globe', 20, 1.8)}</span><span>Currency</span><b>${esc(s.currency || 'NGN')}</b></div></div>
        <h2 class="pm-h">Sales</h2>
        <div class="pg-rows">${nav('receipt', 'receipt', 'Sales receipt', 'Design and contact details')}${nav('pin', 'shield', 'Activity PIN', S.hasPin() ? 'On' : 'Not set')}
          ${sw('sound', 'volume', 'Beep sound', P.sound, 'Plays when you add items and finish a sale')}${sw('vibrate', 'vibrate', 'Vibration', P.vibrate, 'A short buzz on scans and completed sales')}${sw('creditReminders', 'clock', 'Credit reminders', P.creditReminders, 'Flag customers whose payment is due')}</div>
        <h2 class="pm-h">Notifications</h2>
        <div class="pg-rows">${sw('orderAlerts', 'bell', 'Order alerts', P.orderAlerts)}${sw('lowStock', 'inbox', 'Low stock alerts', P.lowStock)}</div>
        <h2 class="pm-h">Help & legal</h2>
        <div class="pg-rows st-help-links">
          <a class="pg-r st-nav" href="support.html"><span class="st-ri">${ic('help', 20, 1.8)}</span><span>Contact Support<small>Questions, complaints and feedback</small></span>${ic('chevR', 18, 2)}</a>
          <a class="pg-r st-nav" href="legal.html?doc=terms"><span class="st-ri">${ic('file', 20, 1.8)}</span><span>Terms of Use</span>${ic('chevR', 18, 2)}</a>
          <a class="pg-r st-nav" href="legal.html?doc=privacy"><span class="st-ri">${ic('shield', 20, 1.8)}</span><span>Privacy Policy</span>${ic('chevR', 18, 2)}</a>
        </div>
        <h2 class="pm-h">Account</h2>
        <div class="pg-rows">${nav('password', 'key', 'Change password')}${fx('security', 'shield', 'Security and 2FA', StrapFeatures.state.twofa.on ? 'On' : 'Off')}${fx('backup', 'mail', 'Backup email or phone')}${fx('appearance', 'palette', 'Appearance', StrapFeatures.state.theme)}${fx('staff', 'users', 'Staff')}${fx('branchsw', 'store', 'Branch', esc(StrapFeatures.branchName()))}${fx('premium', 'flash', 'Plan', StrapFeatures.state.plan === 'premium' ? 'Active' : 'Free')}<button type="button" class="pg-r" data-out><span class="st-ri">${ic('out', 20, 1.8)}</span><span>Sign out</span></button></div>
        <div class="pg-rows" style="margin-top:16px">${fx('delete', 'trash', 'Delete account', '', ' style="color:#c62828"')}</div>
        <footer class="st-legal">By using Strap, you agree to our <a href="legal.html?doc=terms">Terms of Use</a> and <a href="legal.html?doc=privacy">Privacy Policy</a>. For assistance, visit <a href="support.html">Strap Support</a>.</footer>`;
    }

    /* ================= receipt designer ================= */
    const commit = () => { S.setReceiptRaw(tpl); saved = Date.now(); const st = $('#st-saved', root); if (st) st.textContent = 'Saved'; paintPrev(); };
    const paintPrev = () => { const p = $('#st-prev', root); if (p) p.innerHTML = R.render(tpl, null, money); };
    function drawReceipt() {
      root.innerHTML = hdr('Sales receipt', 'receipt', true) + `
        <p class="st-lead">This is how your receipts look. Changes save as you type.</p>
        <section class="st-pv"><div class="st-pv-in" id="st-prev"></div><div class="st-pv-fade"></div><button type="button" class="pm-imp st-pv-b" data-full>${ic('eye', 18, 2)} Full preview</button></section>
        <div class="pm-tabs st-tabs" role="tablist">${[['details', 'Details'], ['style', 'Style'], ['show', 'Show or hide'], ['json', 'JSON']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="pm-tab${tab === k ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
        <div id="st-tb"></div>
        <div class="st-foot"><span id="st-saved" class="st-saved">${saved ? 'Saved' : 'Up to date'}</span><button type="button" class="st-reset" data-reset>${ic('undo', 18, 2)} Reset to default</button></div>`;
      paintPrev(); drawTab();
    }
    function drawTab() {
      const b = $('#st-tb', root); if (!b) return; const f = tpl.font;
      if (tab === 'details') {
        b.innerHTML = `<h2 class="pm-h">Business</h2>
          <div class="st-logo"><span class="st-logo-i">${tpl.header.logo ? `<img src="${esc(tpl.header.logo)}" alt="">` : ic('image', 24, 1.6)}</span><div><b>Logo</b><small>${tpl.header.logo ? 'Your logo is on the receipt' : 'Shows your initials until you add one'}</small></div>
            <button type="button" class="pm-imp sm" data-logo>${tpl.header.logo ? 'Change' : 'Upload'}</button>${tpl.header.logo ? `<button type="button" class="pg-x" data-nologo aria-label="Remove logo">${ic('trash', 19, 1.8)}</button>` : ''}<input type="file" accept="image/*" hidden id="st-file"></div>
          ${field('Business name', 'header.businessName', tpl, { ph: 'Your store', max: 60 })}${field('Tagline', 'header.tagline', tpl, { ph: 'e.g. Quality you can trust', max: 80 })}
          <h2 class="pm-h">Contact details</h2>
          ${field('Address', 'header.address', tpl, { area: 1, ph: '12 Allen Avenue, Ikeja, Lagos', max: 140 })}${field('Phone', 'header.phone', tpl, { type: 'tel', ph: '0803 000 0000', max: 30 })}${field('Email', 'header.email', tpl, { type: 'email', ph: 'hello@yourstore.com', max: 80 })}${field('Website', 'header.website', tpl, { ph: 'yourstore.com', max: 80 })}${field('Social handle', 'header.social', tpl, { ph: '@yourstore', max: 60 })}
          <h2 class="pm-h">Wording</h2>
          ${field('Receipt heading', 'meta.title', tpl, { ph: 'Receipt', max: 40 })}${field('Cashier name', 'meta.cashier', tpl, { ph: 'Leave empty to use the signed-in name', max: 60 })}${field('Total label', 'totals.totalLabel', tpl, { ph: 'Total', max: 30 })}
          ${field('Tax label', 'totals.taxLabel', tpl, { ph: 'VAT', max: 30 })}${field('Tax rate (%)', 'totals.taxRate', tpl, { type: 'number' })}
          ${field('Thank-you message', 'footer.thanks', tpl, { area: 1, ph: 'Thank you for shopping with us!', max: 120 })}${field('Policy note', 'footer.note', tpl, { area: 1, ph: 'Goods sold are not returnable after 7 days.', max: 240 })}`;
      } else if (tab === 'style') {
        b.innerHTML = `<h2 class="pm-h">Layout</h2><div class="st-dds">
          ${dd('paper', 'Paper size', (PAPER_OPTS.find(o => o.v === tpl.paper) || {}).l)}${dd('font', 'Font', f.family, `style="font-family:${esc(R.FONTS[f.family])}"`)}${dd('divider', 'Divider style', (DIV_OPTS.find(o => o.v === tpl.divider) || {}).l)}</div>
          <div class="st-two"><div class="pm-fl st-fs"><span>Text size</span><div class="pm-step"><button type="button" data-fs="-1" aria-label="Smaller">−</button><span class="pg-q">${f.size}px</span><button type="button" data-fs="1" aria-label="Larger">+</button></div></div>
          <div class="pm-fl st-fs"><span>Align</span><div class="st-seg" role="radiogroup">${[['left', 'Left'], ['center', 'Centre']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${tpl.align === k}" class="${tpl.align === k ? 'on' : ''}" data-al="${k}">${l}</button>`).join('')}</div></div></div>
          <div class="pg-r static st-bold"><span>Bold text<small>Heavier weight for faint thermal printers</small></span>${switchHtml('font.bold', f.bold, 'Bold text')}</div>
          <h2 class="pm-h">Colours</h2><div class="st-cols">${colorField('colors.text', 'Text', tpl.colors.text)}${colorField('colors.background', 'Background', tpl.colors.background)}${colorField('colors.accent', 'Accent (name, heading, total)', tpl.colors.accent)}${colorField('colors.muted', 'Soft text (labels, contact)', tpl.colors.muted)}</div>`;
      } else if (tab === 'show') {
        b.innerHTML = `<h2 class="pm-h">What appears on the receipt</h2><div class="pg-rows">${SHOW.map(([p, l]) => `<div class="pg-r static"><span>${l}</span>${switchHtml(p, !!get(tpl, p), l)}</div>`).join('')}</div>`;
      } else {
        b.innerHTML = `<h2 class="pm-h">Template as JSON</h2><p class="st-lead sm">Edit the template directly, or paste one from another device. Colours use hex like #0a0a0a.</p>
          <textarea id="st-json" class="st-json" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Receipt template JSON">${esc(JSON.stringify(tpl, null, 2))}</textarea>
          <p class="sx-err" id="st-jerr" role="alert"></p>
          <div class="st-jb"><button type="button" class="pm-add" data-apply>Apply JSON</button><button type="button" class="pm-imp" data-copy>${ic('copy', 18, 2)} Copy</button></div>`;
      }
    }
    function textSheetFor(path) { /* reserved for future inline editors */ }

    function logoPick(file) {
      if (!file) return; if (!file.type.startsWith('image/')) return ctx.toast('Choose an image file');
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 200 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          tpl.header.logo = c.toDataURL('image/jpeg', .85); tpl.header.showLogo = true; commit(); drawTab();
        };
        img.onerror = () => ctx.toast('That image couldn’t be read');
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    }
    async function applyDropdown(key) {
      const cfg = {
        paper: { title: 'Paper size', options: PAPER_OPTS, value: tpl.paper, set: v => tpl.paper = v },
        font: { title: 'Font', options: Object.keys(R.FONTS).map(k => ({ v: k, l: k, font: R.FONTS[k], s: 'The quick brown fox 0123' })), value: tpl.font.family, set: v => tpl.font.family = v },
        divider: { title: 'Divider style', options: DIV_OPTS, value: tpl.divider, set: v => tpl.divider = v }
      }[key]; if (!cfg) return;
      const v = await pick({ title: cfg.title, options: cfg.options, value: cfg.value });
      if (v !== undefined) { cfg.set(v); commit(); drawTab(); }
    }
    function setColor(path, val) {
      if (!HEX.test(val)) return false; set(tpl, path, val.toLowerCase()); commit(); return true;
    }

    /* ================= activity PIN ================= */
    function drawPin() {
      const has = S.hasPin();
      root.innerHTML = hdr('Activity PIN', 'shield', true) + `
        <section class="st-pinc${has ? ' on' : ''}"><span class="st-pinc-i">${ic(has ? 'shield' : 'lock', 30, 1.8)}</span><h2>${has ? 'Your PIN is on' : 'No PIN yet'}</h2>
          <p>${has ? 'You’ll enter your 4-digit PIN to close sales and confirm other important actions.' : 'Set a 4-digit PIN. You’ll need it to close sales and confirm important actions.'}</p></section>
        <div class="st-pa">${has ? `<button type="button" class="pm-add wide" data-pin="change">Change PIN</button><button type="button" class="pm-imp wide" data-pin="reset">I forgot my PIN</button>` : `<button type="button" class="pm-add wide" data-pin="set">Set PIN now</button>`}</div>
        <p class="st-lead sm">Changing or resetting your PIN needs a 6-digit code we email to you.</p>`;
    }
    async function pinAction(kind) {
      const email = ctx.store.email;
      let mode = kind;
      if (kind === 'change') {
        const r = await Sec.pinPad({ title: 'Enter your current PIN', sub: 'Confirm it’s you before choosing a new PIN.' });
        if (r === 'forgot') mode = 'reset'; else if (r !== true) return;
      }
      const done = await Sec.setupFlow({ email, mode });
      if (done) { await StrapKit.sleep(200); ctx.toast('Activity PIN saved'); }
      if (view === 'pin') drawPin();
    }

    /* ================= change password ================= */
    function drawPassword() {
      const pw = (id, ph, ac) => `<div class="pm-fl st-pw"><span>${ph}</span><input id="${id}" type="password" placeholder="${ph}" autocomplete="${ac}"><button type="button" class="st-eye" data-eye="${id}">Show</button></div>`;
      root.innerHTML = hdr('Change password', 'key', true) + `<p class="st-lead">Use at least 8 characters with a letter and a number.</p>
        <div class="pg-form st-form">${pw('pw-c', 'Current password', 'current-password')}${pw('pw-n', 'New password', 'new-password')}<div class="st-meter" id="pw-m" data-s="0"><i></i><i></i><i></i><i></i></div>${pw('pw-r', 'Confirm new password', 'new-password')}
        <p class="sx-err" id="pw-e" role="alert"></p><button type="button" class="pm-add wide" id="pw-go">Update password</button></div>`;
    }
    async function submitPassword() {
      const c = $('#pw-c', root).value, n = $('#pw-n', root).value, r = $('#pw-r', root).value, er = $('#pw-e', root), btn = $('#pw-go', root);
      const bad = m => { er.textContent = m; fx('err'); };
      if (!c) return bad('Enter your current password.');
      if (n.length < 8 || !/[a-z]/i.test(n) || !/\d/.test(n)) return bad('Use at least 8 characters with a letter and a number.');
      if (n === c) return bad('Your new password must be different from the current one.');
      if (n !== r) return bad('The new passwords don’t match.');
      btn.disabled = true; btn.textContent = 'Updating…';
      const res = await S.api.changePassword(c, n);
      btn.disabled = false; btn.textContent = 'Update password';
      if (!res.ok) return bad(res.msg || 'We couldn’t update your password. Try again.');
      fx('ok'); ctx.toast('Password updated'); go('root');
    }

    /* ================= routing ================= */
    function go(v) {
      view = v; ({ root: drawRoot, receipt: drawReceipt, pin: drawPin, password: drawPassword }[v] || drawRoot)(); window.scrollTo({ top: 0 });
    }

    root.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('[data-back]')) return go('root');
      const n = t.closest('[data-nav]'); if (n) return go(n.dataset.nav);
      if (t.closest('[data-out]')) return ctx.signOut();
      if (t.closest('[data-name]')) {
        const sh = sheet({ title: 'Store name', body: `<label class="pm-fl"><span>Store name</span><input id="st-nm" type="text" value="${esc(ctx.store.bizname || '')}" maxlength="60" autocomplete="off"></label><button type="button" class="pm-add wide" data-ok>Save</button>` });
        const i = $('#st-nm', sh.body); setTimeout(() => i.focus(), 350);
        const ok = () => { const v = i.value.trim(); if (!v) return fx('err'); ctx.rename(v); tpl = R.load(v); if (!S.getReceiptRaw()) tpl.header.businessName = v; sh.close(); drawRoot(); ctx.toast('Store name updated'); };
        sh.body.addEventListener('click', ev => { if (ev.target.closest('[data-ok]')) ok(); }); sh.body.addEventListener('keydown', ev => { if (ev.key === 'Enter') ok(); });
        return;
      }
      // switches (root prefs, show/hide, bold)
      const sbtn = t.closest('.pm-sw'); if (sbtn && sbtn.dataset.sw) {
        const key = sbtn.dataset.sw, on = !sbtn.classList.contains('on');
        sbtn.classList.toggle('on', on); sbtn.setAttribute('aria-checked', on);
        if (view === 'receipt') { set(tpl, key, on); return commit(); }
        S.prefs[key] = on; S.save(); if (key === 'sound' && on) fx('ok'); if (key === 'vibrate' && on) StrapKit.buzz('ok'); return;
      }
      // receipt designer
      if (t.closest('[data-full]')) { return sheet({ title: 'Receipt preview', cls: 'sx-rsheet', body: `<div class="sx-rcw">${R.render(tpl, null, money)}</div><button type="button" class="pm-add wide" data-kc>Done</button>` }); }
      const tb = t.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; $$('[data-tab]', root).forEach(x => { const on = x === tb; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); }); return drawTab(); }
      const d = t.closest('[data-dd]'); if (d) return applyDropdown(d.dataset.dd);
      const fs = t.closest('[data-fs]'); if (fs) { tpl.font.size = Math.min(18, Math.max(9, tpl.font.size + +fs.dataset.fs)); fx('tap'); commit(); return drawTab(); }
      const al = t.closest('[data-al]'); if (al) { tpl.align = al.dataset.al; commit(); return drawTab(); }
      const sw = t.closest('.kt-sw[data-c]'); if (sw) { const box = sw.closest('.kt-col'); setColor(box.dataset.cpath, sw.dataset.c); return drawTab(); }
      if (t.closest('[data-logo]')) return $('#st-file', root).click();
      if (t.closest('[data-nologo]')) { tpl.header.logo = ''; commit(); return drawTab(); }
      if (t.closest('[data-reset]')) { if (await confirm({ title: 'Reset the receipt?', body: 'Your colours, fonts and wording go back to the default design.', ok: 'Reset', cancel: 'Keep mine', icon: 'undo', danger: true })) { tpl = R.defaults(ctx.store.bizname); commit(); drawReceipt(); } return; }
      if (t.closest('[data-copy]')) { try { await navigator.clipboard.writeText($('#st-json', root).value); ctx.toast('JSON copied'); } catch (er) { $('#st-json', root).select(); ctx.toast('Select and copy the text'); } return; }
      if (t.closest('[data-apply]')) {
        const er = $('#st-jerr', root);
        try {
          const parsed = JSON.parse($('#st-json', root).value);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The template must be a JSON object.');
          tpl = R.normalize(parsed, ctx.store.bizname); commit(); er.textContent = ''; fx('ok'); ctx.toast('Template applied'); drawTab();
        } catch (ex) { fx('err'); er.textContent = 'That isn’t valid JSON: ' + ex.message; }
        return;
      }
      // PIN
      const pn = t.closest('[data-pin]'); if (pn) return pinAction(pn.dataset.pin);
      // password
      const ey = t.closest('[data-eye]'); if (ey) { const i = $('#' + ey.dataset.eye, root), h = i.type === 'password'; i.type = h ? 'text' : 'password'; ey.textContent = h ? 'Hide' : 'Show'; return; }
      if (t.closest('#pw-go')) return submitPassword();
    });

    root.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.p) { // receipt text fields
        let v = t.value; if (t.type === 'number') v = Math.min(100, Math.max(0, +v || 0));
        set(tpl, t.dataset.p, v); commit(); return;
      }
      const hex = t.closest && t.closest('.kt-hex'); if (hex) {
        let v = t.value.trim(); if (v && v[0] !== '#') v = '#' + v;
        const box = t.closest('.kt-col'); if (setColor(box.dataset.cpath, v)) { $('i', hex).style.background = v; $$('.kt-sw[data-c]', box).forEach(s => s.classList.toggle('on', s.dataset.c.toLowerCase() === v.toLowerCase())); }
        return;
      }
      if (t.type === 'color') { const box = t.closest('.kt-col'); setColor(box.dataset.cpath, t.value); $('.kt-hex input', box).value = t.value; $('.kt-hex i', box).style.background = t.value; $$('.kt-sw[data-c]', box).forEach(s => s.classList.remove('on')); return; }
      if (t.id === 'pw-n') $('#pw-m', root).dataset.s = t.value ? Math.max(1, strength(t.value)) : 0;
      if (t.closest('.st-form')) { const er = $('#pw-e', root); if (er) er.textContent = ''; }
    });
    root.addEventListener('change', e => { if (e.target.id === 'st-file') logoPick(e.target.files[0]); });

    go('root');
    return { onShow() { if (view === 'root') drawRoot(); else if (view === 'pin') drawPin(); } };
  }
  return { mount };
})();
