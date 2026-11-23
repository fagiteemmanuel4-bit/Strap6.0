/* Strap – StrapPicker: one custom dropdown system for the whole app.
   - StrapPicker.pick({...})  bottom-sheet list / chips / cards, single or multi select, optional "create new" row
   - StrapPicker.date({...})  custom calendar sheet (replaces the native date popup)
   - Every native <select>, <input type="date"> and <input list> that appears in the page is upgraded automatically
     (the original element stays in the DOM, hidden, so forms, validation and saving keep working unchanged).
   - PRESETS below give each dropdown its own look (icons, status dots, size cards, layout previews, ...). */
window.StrapPicker = (() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const tap = () => { try { window.StrapKit && StrapKit.fx && StrapKit.fx('tap'); } catch (e) {} };

  /* ---------- icons ---------- */
  const PATHS = {
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M6 12h12"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', chev: '<path d="m6 9 6 6 6-6"/>', chevL: '<path d="m15 6-6 6 6 6"/>', chevR: '<path d="m9 6 6 6-6 6"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="3.5"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', az: '<path d="M4 17 7.5 7 11 17M5.3 13.8h4.4"/><path d="M14 8h5l-5 8h5"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    shirt: '<path d="M8.5 4 4 6.5 6 10.5l2-1V20h8V9.5l2 1 2-4L15.5 4a3.5 3.5 0 0 1-7 0z"/>', drop: '<path d="M12 3.5s5.5 6 5.5 10a5.5 5.5 0 0 1-11 0c0-4 5.5-10 5.5-10z"/>',
    phone: '<rect x="7" y="3.5" width="10" height="17" rx="2.6"/><path d="M11 17.5h2"/>', cup: '<path d="M5 8.5h11V14a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2M12 3.5v2"/>',
    dumb: '<path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"/>', home: '<path d="M4 11 12 4.5 20 11v8.5H4z"/><path d="M10 19.5v-5h4v5"/>',
    pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="m14.5 6.5 3 3"/>', dots: '<circle cx="7" cy="7" r="1.6"/><circle cx="17" cy="7" r="1.6"/><circle cx="7" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/>',
    box: '<path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16z"/><path d="m3.5 8 8.5 4.5L20.5 8M12 12.5v8"/>', cloud: '<path d="M12 4.5v9M8 10l4 4 4-4"/><path d="M5 19.5h14"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>', tag: '<path d="M3.5 12.2V5.5a2 2 0 0 1 2-2h6.7l8 8a2 2 0 0 1 0 2.8l-5.2 5.2a2 2 0 0 1-2.8 0z"/><circle cx="8.3" cy="8.3" r="1.4"/>',
    collections: '<rect x="3.5" y="8" width="13" height="12" rx="2.5"/><path d="M7.5 4.5h11a2 2 0 0 1 2 2V16"/>', store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12.5V20h13v-7.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
    trend: '<path d="M4 19.5h16"/><path d="m5 15 4.5-4.5 3.5 3L19 7"/><path d="M14.5 7H19v4.5"/>', branch: '<circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="9" r="2.3"/><path d="M6 8.3v7.4M18 11.3c0 3.5-4 3-9.5 5"/>'
  };
  const ic = (k, s = 20, w = 1.9) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[k] || ''}</svg>`;

  /* ---------- layers (bottom sheets) ---------- */
  let locks = 0; const stack = [];
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) { e.stopPropagation(); stack[stack.length - 1](); } }, true);
  function layer(cls, title, html) {
    const w = document.createElement('div'); w.className = 'dd-layer ' + cls;
    w.innerHTML = `<div class="dd-scrim"></div><section class="dd-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><div class="dd-grab"><i></i></div>
      <header class="dd-h"><h2>${esc(title)}</h2><button type="button" class="dd-x" data-x aria-label="Close">${ic('close', 20, 2.2)}</button></header><div class="dd-b">${html}</div></section>`;
    document.body.appendChild(w); locks++; document.body.classList.add('dd-lock'); void w.offsetWidth; w.classList.add('on');
    let closed = false;
    const api = {
      el: w, body: $('.dd-b', w), onClose: null,
      close() {
        if (closed) return; closed = true; w.classList.remove('on');
        const i = stack.indexOf(api.close); if (i > -1) stack.splice(i, 1);
        locks = Math.max(0, locks - 1); if (!locks) document.body.classList.remove('dd-lock');
        setTimeout(() => w.remove(), reduced() ? 0 : 360); if (api.onClose) api.onClose();
      }
    };
    stack.push(api.close);
    w.addEventListener('click', e => { if (e.target.closest('.dd-scrim') || e.target.closest('[data-x]')) api.close(); });
    return api;
  }

  /* ---------- list / chips / cards picker ---------- */
  const TONES = ['lemon', 'blue', 'green', 'pink', 'amber', 'grey'];
  const toneOf = s => TONES[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
  const tile = o => {
    if (o.html) return `<i class="dd-tile tone-${o.tone || 'n'}">${o.html}</i>`;
    if (o.img) return `<i class="dd-tile"><img src="${esc(o.img)}" alt=""></i>`;
    if (o.sw) return `<i class="dd-sdot" style="--c:${esc(o.sw)}"></i>`;
    if (o.ic) return `<i class="dd-tile tone-${o.tone || 'n'}">${ic(o.ic, 22, 1.8)}</i>`;
    if (o.letter) return `<i class="dd-tile tone-${o.tone || toneOf(o.letter)}">${esc(o.letter)}</i>`;
    return '';
  };
  const optHtml = (o, variant, on) => {
    const ck = `<span class="dd-ck">${ic('check', 16, 3)}</span>`;
    const at = `type="button" role="option" data-v="${esc(o.v)}" aria-selected="${on}"${o.disabled ? ' disabled' : ''}`;
    const sub = o.s ? `<small>${esc(o.s)}</small>` : '';
    if (variant === 'chips') return `<button ${at} class="dd-chip${on ? ' on' : ''}"><b>${esc(o.l)}</b>${sub}</button>`;
    if (variant === 'cards') return `<button ${at} class="dd-card${on ? ' on' : ''}"><span class="dd-art">${o.art || ''}</span><b>${esc(o.l)}</b>${sub}${ck}</button>`;
    return `<button ${at} class="dd-o${on ? ' on' : ''}">${tile(o)}<span class="dd-ot"><b${o.css ? ` style="${esc(o.css)}"` : ''}>${esc(o.l)}</b>${sub}</span>${ck}</button>`;
  };

  // options: [{ v, l, s?, ic?, tone?, sw?, img?, letter?, html?, art?, css?, disabled? }]
  // resolves with the chosen value (array when multi), or undefined when dismissed
  function pick({ title = 'Choose', options = [], value, multi = false, variant = 'list', search, create, empty = 'Nothing here yet.', done = 'Done' } = {}) {
    return new Promise(resolve => {
      const opts = options.map(o => ({ ...o, _v: o.v, v: String(o.v) }));
      const sel = new Set(multi ? (value || []).map(String) : [String(value)]);
      let q = '', result;
      const showSearch = search == null ? opts.length > 8 : search;
      const L = layer('dd-pick ' + variant, title, `${showSearch ? `<label class="dd-s">${ic('search', 19, 2)}<input type="search" placeholder="Search" autocomplete="off" enterkeyhint="search" aria-label="Search"></label>` : ''}
        <div class="dd-list ${variant}${multi ? ' multi' : ''}" role="listbox" aria-multiselectable="${multi}"></div>
        ${create ? `<form class="dd-new" autocomplete="off"><input type="text" maxlength="40" placeholder="${esc(create.placeholder || 'Add new')}" aria-label="${esc(create.label || 'Add new')}"><button type="submit">${ic('plus', 18, 2.4)}<span>${esc(create.label || 'Add')}</span></button></form>` : ''}
        ${multi ? '<button type="button" class="dd-done" data-done></button>' : ''}`);
      L.onClose = () => resolve(result);
      const list = $('.dd-list', L.body), doneBtn = $('[data-done]', L.body);
      const draw = () => {
        const n = q.trim().toLowerCase(), rows = n ? opts.filter(o => (o.l + ' ' + (o.s || '')).toLowerCase().includes(n)) : opts;
        list.innerHTML = rows.length ? rows.map(o => optHtml(o, variant, sel.has(o.v))).join('') : `<p class="dd-empty">${esc(n ? 'No matches found.' : empty)}</p>`;
      };
      const upd = () => { if (doneBtn) doneBtn.textContent = sel.size ? `${done} · ${sel.size} selected` : done; };
      const finish = v => { result = v; L.close(); };
      draw(); upd();
      setTimeout(() => {
        const on = $('.on', list); if (on && opts.length > 6) on.scrollIntoView({ block: 'center' });
        const s = $('.dd-s input', L.body); if (s && matchMedia('(pointer:fine)').matches) s.focus(); else $('.dd-sheet', L.el).focus({ preventScroll: true });
      }, 380);
      const si = $('.dd-s input', L.body); if (si) si.addEventListener('input', () => { q = si.value; draw(); });
      L.body.addEventListener('click', e => {
        const b = e.target.closest('[data-v]');
        if (b) {
          const o = opts.find(x => x.v === b.dataset.v); if (!o || o.disabled) return; tap();
          if (multi) { sel.has(o.v) ? sel.delete(o.v) : sel.add(o.v); b.classList.toggle('on', sel.has(o.v)); b.setAttribute('aria-selected', sel.has(o.v)); upd(); }
          else finish(o._v);
          return;
        }
        if (e.target.closest('[data-done]')) finish(opts.filter(o => sel.has(o.v)).map(o => o._v));
      });
      const form = $('.dd-new', L.body);
      if (form) form.addEventListener('submit', async e => {
        e.preventDefault(); const inp = $('input', form), name = inp.value.trim(); if (!name) return;
        let o = null; try { o = await create.make(name); } catch (er) {}
        if (!o) { form.classList.add('bad'); setTimeout(() => form.classList.remove('bad'), 600); return; }
        const n = { ...o, _v: o.v, v: String(o.v) }; if (!opts.some(x => x.v === n.v)) opts.unshift(n);
        inp.value = ''; q = ''; if (si) si.value = ''; tap();
        if (multi) { sel.add(n.v); draw(); upd(); list.scrollTop = 0; } else finish(n._v);
      });
    });
  }

  /* ---------- calendar ---------- */
  function date({ title = 'Choose a date', value = '', min = '', max = '', start = '' } = {}) {
    return new Promise(resolve => {
      const pad = n => String(n).padStart(2, '0'), iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
      const parse = s => { const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return r ? { y: +r[1], m: +r[2] - 1, d: +r[3] } : null; };
      const now = new Date(), today = iso(now.getFullYear(), now.getMonth(), now.getDate());
      const v = parse(value), lo = parse(min), hi = parse(max);
      const base = v || (hi && today > max ? hi : lo && today < min ? lo : { y: now.getFullYear(), m: now.getMonth() });
      let y = base.y, m = base.m, mode = start === 'year' && !v ? 'year' : 'day', result;
      if (mode === 'year' && hi) y = Math.min(y, now.getFullYear() - 25);
      const yMin = lo ? lo.y : now.getFullYear() - 100, yMax = hi ? hi.y : now.getFullYear() + 10;
      const L = layer('dd-cal-l', title, '');
      L.onClose = () => resolve(result);
      const inRange = ds => !((min && ds < min) || (max && ds > max));
      const finish = ds => { result = ds; L.close(); };
      function draw() {
        if (mode === 'year') {
          let ys = ''; for (let k = yMax; k >= yMin; k--) ys += `<button type="button" class="dd-y${k === y ? ' on' : ''}" data-y="${k}">${k}</button>`;
          L.body.innerHTML = `<div class="dd-ch"><button type="button" class="dd-nav" data-back aria-label="Back to days">${ic('chevL', 20, 2.2)}</button><span class="dd-cm static">Select a year</span></div><div class="dd-yrs">${ys}</div>`;
          setTimeout(() => { const on = $('.dd-y.on', L.body); if (on) on.scrollIntoView({ block: 'center' }); }, 30); return;
        }
        const lead = (new Date(y, m, 1).getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
        const pl = new Date(y, m, 0), nf = new Date(y, m + 1, 1);
        const prevOff = min && iso(pl.getFullYear(), pl.getMonth(), pl.getDate()) < min, nextOff = max && iso(nf.getFullYear(), nf.getMonth(), 1) > max;
        let cells = '<span class="dd-d off"></span>'.repeat(lead);
        for (let d = 1; d <= dim; d++) { const ds = iso(y, m, d); cells += `<button type="button" class="dd-d${ds === value ? ' on' : ''}${ds === today ? ' today' : ''}" data-d="${ds}"${inRange(ds) ? '' : ' disabled'} aria-label="${d} ${new Date(y, m, 1).toLocaleDateString('en', { month: 'long' })} ${y}">${d}</button>`; }
        L.body.innerHTML = `<div class="dd-ch"><button type="button" class="dd-nav" data-prev aria-label="Previous month"${prevOff ? ' disabled' : ''}>${ic('chevL', 20, 2.2)}</button>
          <button type="button" class="dd-cm" data-mode>${new Date(y, m, 1).toLocaleDateString('en', { month: 'long' })} ${y}${ic('chev', 16, 2.4)}</button>
          <button type="button" class="dd-nav" data-next aria-label="Next month"${nextOff ? ' disabled' : ''}>${ic('chevR', 20, 2.2)}</button></div>
          <div class="dd-wk">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<span>${x}</span>`).join('')}</div><div class="dd-days">${cells}</div>
          ${inRange(today) ? '<div class="dd-cf"><button type="button" data-today>Today</button></div>' : ''}`;
      }
      draw();
      L.body.addEventListener('click', e => {
        const t = e.target;
        const d = t.closest('[data-d]'); if (d && !d.disabled) { tap(); return finish(d.dataset.d); }
        if (t.closest('[data-prev]')) { m--; if (m < 0) { m = 11; y--; } return draw(); }
        if (t.closest('[data-next]')) { m++; if (m > 11) { m = 0; y++; } return draw(); }
        if (t.closest('[data-mode]')) { mode = 'year'; return draw(); }
        if (t.closest('[data-back]')) { mode = 'day'; return draw(); }
        const yr = t.closest('[data-y]'); if (yr) { y = +yr.dataset.y; mode = 'day'; tap(); return draw(); }
        if (t.closest('[data-today]')) { tap(); finish(today); }
      });
    });
  }

  /* ---------- per-dropdown designs ---------- */
  const A = s => `<svg viewBox="0 0 120 80" fill="none" stroke="#0a0a0a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s}</svg>`;
  const Y = '#e6f53a';
  const ART = {
    box: A(`<path d="M60 12 94 28v32L60 76 26 60V28z" fill="#fff"/><path d="m26 28 34 16 34-16M60 44v32"/><path d="M60 44v32l34-16V28z" fill="${Y}" stroke="none" opacity=".9"/><path d="m26 28 34 16 34-16M60 44v32M94 28v32L60 76 26 60V28L60 12z"/>`),
    mailer: A(`<rect x="18" y="20" width="84" height="50" rx="9" fill="#fff"/><path d="m21 24 39 27 39-27"/><rect x="74" y="50" width="20" height="12" rx="3" fill="${Y}"/>`),
    big: A(`<path d="M60 8 100 26v36L60 78 20 62V26z" fill="#fff"/><path d="m20 26 40 18 40-18M60 44v34"/><rect x="52" y="52" width="16" height="9" rx="2" fill="${Y}" transform="rotate(-22 60 56)"/>`),
    lDefault: A(`<rect x="10" y="10" width="46" height="60" rx="9" fill="#fff"/><path d="m17 57 12-12 9 8 7-6 6 7"/><path d="M66 18h40M66 28h28M66 38h34"/><rect x="66" y="52" width="36" height="14" rx="7" fill="${Y}"/>`),
    lGallery: A(`<rect x="12" y="8" width="96" height="42" rx="9" fill="#fff"/><path d="m22 43 18-16 14 12 10-8 24 12"/><rect x="12" y="56" width="22" height="16" rx="5" fill="${Y}"/><rect x="40" y="56" width="22" height="16" rx="5" fill="#fff"/><rect x="68" y="56" width="22" height="16" rx="5" fill="#fff"/><rect x="96" y="56" width="12" height="16" rx="5" fill="#fff"/>`),
    lMinimal: A(`<rect x="42" y="8" width="36" height="30" rx="8" fill="#fff"/><path d="M30 50h60M40 60h40"/><rect x="46" y="66" width="28" height="9" rx="4.5" fill="${Y}"/>`)
  };
  const CAT = { 'Apparel & accessories': ['shirt', 'pink'], 'Beauty & personal care': ['drop', 'blue'], 'Electronics': ['phone', 'blue'], 'Food & drinks': ['cup', 'amber'], 'Fitness & sports': ['dumb', 'green'], 'Home & living': ['home', 'lemon'], 'Stationery & office': ['pencil', 'grey'], 'Other': ['dots', 'n'] };
  const TYPES = { Physical: { ic: 'box', tone: 'lemon', s: 'Items you ship or hand over' }, Digital: { ic: 'cloud', tone: 'blue', s: 'Downloads and licences' }, Service: { ic: 'user', tone: 'green', s: 'Bookings and time' } };
  const MODE = { 'Shop or supermarket': 'store', 'Food service': 'cup', 'Fashion or electronics': 'shirt', 'Online store only': 'globe', 'Growing brand': 'trend', 'Other': 'dots' };
  const sm = t => `<span style="font-size:12px;font-weight:700;letter-spacing:-.02em">${esc(t)}</span>`;
  const PRESETS = {
    'pm-sort': { title: 'Sort products', trig: 'icon', meta: v => ({ new: { ic: 'clock', tone: 'lemon', s: 'Latest products first' }, az: { ic: 'az', tone: 'blue', s: 'Alphabetical order' }, lo: { ic: 'up', tone: 'green', s: 'Cheapest first' }, hi: { ic: 'down', tone: 'pink', s: 'Most expensive first' } }[v] || {}) },
    textstyle: { title: 'Text style', meta: v => ({
      p: { html: '<span style="font-size:17px;font-weight:600">Aa</span>', s: 'Normal body text', css: 'font-weight:500' },
      h2: { html: '<span style="font-size:22px;font-weight:700;letter-spacing:-.04em">Aa</span>', s: 'Large section title', css: 'font-size:21px;font-weight:700;letter-spacing:-.03em' },
      h3: { html: '<span style="font-size:18px;font-weight:700;letter-spacing:-.03em">Aa</span>', s: 'Smaller title', css: 'font-size:18px;font-weight:600;letter-spacing:-.02em' } }[v] || {}) },
    category: { title: 'Product category', clear: 'No category', search: true, trig: 'icon', meta: v => CAT[v] ? { ic: CAT[v][0], tone: CAT[v][1] } : {} },
    package: { title: 'Package', variant: 'cards', trig: 'art', meta: (v, l) => /^Store default/.test(l) ? { l: 'Store default', ts: '22 × 13.7 × 4.2 cm', s: 'Sample box · 22 × 13.7 × 4.2 cm', art: ART.box }
      : /mailer/i.test(l) ? { s: 'Padded envelope, light items', art: ART.mailer } : /large/i.test(l) ? { s: 'Bulky items or bundles', art: ART.big } : {} },
    dunit: { title: 'Size unit', variant: 'chips', trig: 'compact', meta: v => ({ cm: { s: 'Centimetres' }, in: { s: 'Inches' }, m: { s: 'Metres' } }[v] || {}) },
    wunit: { title: 'Weight unit', variant: 'chips', trig: 'compact', meta: v => ({ kg: { s: 'Kilograms' }, g: { s: 'Grams' }, lb: { s: 'Pounds' }, oz: { s: 'Ounces' } }[v] || {}) },
    status: { title: 'Product status', trig: 'dot', meta: v => ({ active: { sw: '#1f7a4d', s: 'Shows on your POS and catalogue' }, draft: { sw: '#9a9a93', s: 'Hidden until you’re ready' }, archived: { sw: '#d99a1f', s: 'Kept for records, not for sale' } }[v] || {}) },
    layout: { title: 'Product page layout', variant: 'cards', trig: 'art', meta: v => ({ 'Default product': { s: 'Photo beside the details', art: ART.lDefault }, 'Gallery focus': { s: 'Big photos first', art: ART.lGallery }, Minimal: { s: 'Clean and text-led', art: ART.lMinimal } }[v] || {}) },
    type: { title: 'Product type', clear: 'None', trig: 'icon', create: { label: 'Add type', placeholder: 'New type, e.g. Wholesale' }, empty: 'No types yet. Add one below.', meta: v => TYPES[v] || (v ? { ic: 'tag', tone: toneOf(v) } : {}) },
    vendor: { title: 'Vendor', clear: 'None', trig: 'icon', create: { label: 'Add vendor', placeholder: 'New vendor name' }, empty: 'No vendors yet. Add one below.', meta: v => v ? { letter: v.trim()[0].toUpperCase() } : {} },
    due: { title: 'Due date' }, dob: { title: 'Date of birth' },
    country: { title: 'Select your country', trig: 'tile', meta: (v, l) => v ? { ic: 'globe', tone: toneOf(l) } : {} },
    bcountry: { title: 'Select a country', trig: 'tile', meta: (v, l) => v ? { ic: 'globe', tone: toneOf(l) } : {} },
    currency: { title: 'Select a currency', trig: 'tile', meta: v => v ? { html: sm(v), tone: toneOf(v) } : {} },
    mode: { title: 'Business mode', trig: 'tile', meta: (v, l) => MODE[l] ? { ic: MODE[l], tone: toneOf(l) } : {} },
    branches: { title: 'Number of branches', trig: 'tile', meta: (v, l, i) => ({ html: sm(['1', '2–5', '6–20', '20+'][i - 1] || ''), tone: ['lemon', 'blue', 'green', 'pink'][(i - 1) % 4] }) }
  };
  PRESETS.sort = PRESETS['pm-sort'];

  /* ---------- upgrade native controls ---------- */
  const SEL = 'select, input[type=date], input[list]';
  const kindOf = el => el.tagName === 'SELECT' ? 'select' : el.type === 'date' ? 'date' : 'list';
  const presetOf = el => PRESETS[el.dataset.dd || el.name || el.id] || {};
  const labelText = el => { const lb = el.closest('label'), sp = lb && $(':scope>span', lb); return sp ? sp.textContent.replace(/[*:]/g, '').trim() : ''; };
  const fmtDate = s => { const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return r ? new Date(+r[1], +r[2] - 1, +r[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : s; };

  function optionsOf(el, pr) {
    let list;
    if (el.tagName === 'SELECT') {
      list = [...el.options].filter(o => !o.hidden).map(o => ({ v: o.value, l: o.textContent.trim(), disabled: o.disabled }));
      if (list.length && list[0].v === '') list.shift();
    } else {
      const dl = el.list || $('#' + el.getAttribute('list')); const seen = new Set();
      list = dl ? [...dl.options].map(o => o.value || o.textContent.trim()).filter(v => v && !seen.has(v) && seen.add(v)).map(v => ({ v, l: v })) : [];
      if (el.value && !seen.has(el.value)) list.push({ v: el.value, l: el.value });
    }
    const out = list.map((o, i) => ({ ...o, ...(pr.meta ? pr.meta(o.v, o.l, i + 1) : {}) }));
    if (pr.clear) out.unshift({ v: '', l: pr.clear, ic: 'minus', tone: 'n' });
    return out;
  }

  function paint(el) {
    const b = el._btn; if (!b) return;
    const kind = kindOf(el), pr = presetOf(el), v = el.value;
    let text = v, idx = 0;
    if (kind === 'select') { const o = el.options[el.selectedIndex]; text = o && v !== '' ? o.textContent.trim() : ''; idx = el.selectedIndex; }
    if (kind === 'date') text = v ? fmtDate(v) : '';
    const ph = kind === 'select' ? (el.options[0] && el.options[0].value === '' ? el.options[0].textContent.trim() : 'Select')
      : (el.getAttribute('placeholder') || (kind === 'date' ? 'Select a date' : 'Select'));
    const m = v !== '' && pr.meta ? pr.meta(v, text, idx) || {} : {};
    let vis = '';
    if (v !== '') {
      if (pr.trig === 'dot' && m.sw) vis = `<i class="dd-mdot" style="--c:${esc(m.sw)}"></i>`;
      else if (pr.trig === 'art' && m.art) vis = `<i class="dd-mart">${m.art}</i>`;
      else if ((pr.trig === 'icon' || pr.trig === 'tile') && (m.ic || m.html || m.letter)) vis = `<i class="dd-mi tone-${m.tone || (m.letter ? toneOf(m.letter) : 'n')}">${m.ic ? ic(m.ic, 16, 2) : m.html || esc(m.letter)}</i>`;
    }
    const label = v === '' ? ph : (m.l || text);
    const end = kind === 'date' ? ic('cal', 20, 1.8) : b.classList.contains('fs') ? '' : ic('chev', 18, 2.2);
    b.innerHTML = `<span class="dd-tv${v === '' ? ' ph' : ''}">${vis}<span class="dd-tt">${esc(label)}</span>${m.ts ? `<small class="dd-ts">${esc(m.ts)}</small>` : ''}</span>${end}`;
    b.classList.toggle('compact', pr.trig === 'compact');
  }
  function commit(el, val) {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); paint(el);
  }
  async function open(el) {
    const kind = kindOf(el), pr = presetOf(el), title = pr.title || labelText(el) || el.getAttribute('aria-label') || 'Choose';
    if (kind === 'date') {
      const r = await date({ title, value: el.value, min: el.min, max: el.max, start: (el.autocomplete === 'bday' || el.dataset.ddStart) ? 'year' : '' });
      if (r !== undefined) commit(el, r); return;
    }
    const options = optionsOf(el, pr);
    const create = kind === 'list' ? { ...(pr.create || { label: 'Add', placeholder: 'Add new' }), make: async name => { const ex = options.find(o => o.l.toLowerCase() === name.toLowerCase()); return ex || { v: name, l: name, ...(pr.meta ? pr.meta(name, name, 0) : {}) }; } } : null;
    const r = await pick({ title, options, value: el.value, variant: pr.variant || 'list', search: pr.search, create, empty: pr.empty });
    if (r !== undefined) commit(el, r);
  }
  function enhance(el) {
    if (el._btn || el.hasAttribute('data-dd-off') || el.closest('.dd-layer') || el.type === 'hidden') return;
    const kind = kindOf(el), b = document.createElement('button'); b.type = 'button';
    b.className = 'dd-t' + (el.classList.contains('fi') ? ' ' + el.className : '');
    b.setAttribute('aria-haspopup', kind === 'date' ? 'dialog' : 'listbox'); b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', el.getAttribute('aria-label') || labelText(el) || 'Choose');
    el.classList.add('dd-native'); el.tabIndex = -1; el.setAttribute('aria-hidden', 'true'); el.after(b); el._btn = b; b.disabled = el.disabled;
    b.addEventListener('click', async () => {
      if (b.disabled) return; b.setAttribute('aria-expanded', 'true');
      try { await open(el); } finally { b.setAttribute('aria-expanded', 'false'); try { b.focus({ preventScroll: true }); } catch (e) {} }
    });
    const lb = el.closest('label');
    if (lb && !lb._dd) { lb._dd = 1; lb.addEventListener('click', e => { const t = lb.querySelector('.dd-t'); if (t && !t.contains(e.target) && !e.target.closest('button,a')) { e.preventDefault(); t.click(); } }); }
    el.addEventListener('change', () => paint(el)); paint(el);
  }
  const scan = n => { if (n.nodeType !== 1) return; if (n.matches(SEL)) enhance(n); n.querySelectorAll(SEL).forEach(enhance); };
  const sync = (root = document) => { const items = root.matches && root.matches(SEL) ? [root] : []; items.concat($$(SEL, root)).forEach(el => el._btn ? paint(el) : enhance(el)); };
  document.addEventListener('reset', e => setTimeout(() => sync(e.target), 0), true);
  const boot = () => { scan(document.body); new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true }); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();

  return { pick, date, sync, enhance, ic, PRESETS };
})();
