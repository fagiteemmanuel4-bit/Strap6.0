/* Strap – shared UI kit: bottom sheets, custom dropdown picker (no native <select>), confirm dialog,
   colour field, beep + vibration. Used by the sales page, security flow and settings. */
window.StrapKit = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const U = StrapUI, ic = U.ic, esc = U.esc;
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- sound + vibration (respect the user's settings) ---------- */
  let ac = null;
  const prefs = () => StrapStore.prefs;
  function tone(freq, start, dur, type = 'square', vol = 0.07) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + start;
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  const beep = kind => {
    if (!prefs().sound) return;
    if (kind === 'add') tone(1480, 0, 0.09);
    else if (kind === 'ok') { tone(988, 0, 0.12, 'triangle', .1); tone(1318, 0.13, 0.12, 'triangle', .1); tone(1760, 0.27, 0.22, 'triangle', .1); }
    else if (kind === 'err') { tone(220, 0, 0.18, 'sawtooth', .06); tone(165, 0.2, 0.22, 'sawtooth', .06); }
    else if (kind === 'tap') tone(900, 0, 0.04, 'sine', .05);
  };
  // "little sprinkle" = a quick run of small pulses
  const buzz = kind => {
    if (!prefs().vibrate || !navigator.vibrate) return;
    try {
      navigator.vibrate(kind === 'ok' ? [22, 40, 22, 40, 22, 40, 22, 60, 90] : kind === 'err' ? [70, 50, 70] : kind === 'tap' ? 8 : 16);
    } catch (e) {}
  };
  const fx = kind => { beep(kind); buzz(kind); };

  /* ---------- scroll lock shared by every layer ---------- */
  let locks = 0;
  const lock = on => { locks = Math.max(0, locks + (on ? 1 : -1)); document.body.classList.toggle('pm-open', locks > 0); };

  /* ---------- bottom sheet ---------- */
  function sheet({ title = '', body = '', cls = '', onClose } = {}) {
    const wrap = el('div', 'pm-layer kt-layer');
    wrap.innerHTML = `<div class="pm-scrim"></div><section class="pm-sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="pm-grab"><i></i></div>
      <div class="pm-sh"><h2>${title}</h2><button type="button" class="pm-x" data-kc aria-label="Close">${ic('close', 20, 2.2)}</button></div><div class="kt-body">${body}</div></section>`;
    document.body.appendChild(wrap); lock(true); void wrap.offsetWidth; wrap.classList.add('on');
    let closed = false;
    const api = {
      el: wrap, body: $('.kt-body', wrap), panel: $('.pm-sheet', wrap),
      setTitle: t => { $('.pm-sh h2', wrap).innerHTML = t; },
      close() {
        if (closed) return; closed = true; wrap.classList.remove('on'); lock(false);
        setTimeout(() => wrap.remove(), reduced() ? 0 : 380); if (onClose) onClose();
      }
    };
    wrap.addEventListener('click', e => { if (e.target.closest('.pm-scrim') || e.target.closest('[data-kc]')) api.close(); });
    return api;
  }

  /* ---------- custom dropdown: a field that opens a bottom list ---------- */
  // options: [{ v, l, s?, sw?, font? }]; resolves with the chosen value (or undefined when dismissed)
  const pick = ({ title, options, value }) => StrapPicker.pick({ title, value, options: options.map(o => ({ ...o, css: o.font ? 'font-family:' + o.font : '' })) });
  // field markup for a custom dropdown (the caller listens for clicks on [data-dd])
  const dd = (key, label, valueLabel, extra = '') => `<button type="button" class="kt-dd" data-dd="${esc(key)}" aria-haspopup="listbox"><span class="kt-ddl">${esc(label)}</span><b ${extra}>${esc(valueLabel)}</b>${ic('chevUD', 18, 2.2)}</button>`;

  /* ---------- centred confirm dialog ---------- */
  function confirm({ title, body = '', ok = 'Yes', cancel = 'Not now', icon = 'info', danger = false }) {
    return new Promise(res => {
      const w = el('div', 'kt-modal');
      w.innerHTML = `<div class="kt-mscrim"></div><div class="kt-card" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <span class="kt-mic${danger ? ' bad' : ''}">${ic(icon, 28, 1.9)}</span><h2>${title}</h2><p>${body}</p>
        <div class="kt-mact"><button type="button" class="kt-b alt" data-n>${esc(cancel)}</button><button type="button" class="kt-b${danger ? ' danger' : ''}" data-y>${esc(ok)}</button></div></div>`;
      document.body.appendChild(w); lock(true); void w.offsetWidth; w.classList.add('on');
      const done = v => { w.classList.remove('on'); lock(false); setTimeout(() => w.remove(), reduced() ? 0 : 260); res(v); };
      w.addEventListener('click', e => { if (e.target.closest('[data-y]')) done(true); else if (e.target.closest('[data-n]') || e.target.closest('.kt-mscrim')) done(false); });
      setTimeout(() => $('[data-y]', w).focus(), 60);
    });
  }

  /* ---------- colour field: swatches + hex + native picker ---------- */
  const SWATCHES = ['#0a0a0a', '#ffffff', '#e6f53a', '#1f7a4d', '#1d4ed8', '#c026d3', '#d6342a', '#f59e0b', '#6b6b66'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const colorField = (path, label, value) => `<div class="kt-col" data-cpath="${esc(path)}"><span class="kt-cl">${esc(label)}</span>
    <div class="kt-sws">${SWATCHES.map(c => `<button type="button" class="kt-sw${c.toLowerCase() === String(value).toLowerCase() ? ' on' : ''}" style="--c:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}
      <label class="kt-sw kt-sw-c" aria-label="Custom colour"><input type="color" value="${HEX.test(value) ? value : '#000000'}">${ic('plus', 16, 2.4)}</label></div>
    <label class="kt-hex"><i style="background:${HEX.test(value) ? value : '#000'}"></i><input type="text" value="${esc(value)}" maxlength="7" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="${esc(label)} hex"></label></div>`;

  const switchHtml = (key, on, label) => `<button type="button" class="pm-sw${on ? ' on' : ''}" role="switch" data-sw="${esc(key)}" aria-checked="${!!on}" aria-label="${esc(label)}"><i></i></button>`;
  const money = (n, cur) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur || 'NGN', maximumFractionDigits: 2, minimumFractionDigits: 0, currencyDisplay: 'narrowSymbol' }).format(n); } catch (e) { return Math.round(n).toLocaleString('en'); } };

  return { $, $$, el, sleep, reduced, sheet, pick, date: StrapPicker.date, dd, confirm, colorField, switchHtml, fx, beep, buzz, lock, money, HEX };
})();
