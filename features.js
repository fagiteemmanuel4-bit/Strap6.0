/* Strap – features: 2FA and backup phone, branches, staff, transfers, premium, appearance, Strap AI import, plan limits.
   Local-only for now: replace F.api.* with real backend calls. */
window.StrapFeatures = (() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const U = StrapUI, ic = U.ic, esc = U.esc, K = StrapKit;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KEY = 'strap.f1';
  const LIM = { free: { branches: 1, staff: 0, products: 30, imports: 30 }, premium: { branches: 1e6, staff: 1e6, products: 1e6, imports: 1e6 } };
  const mkey = () => new Date().toISOString().slice(0, 7);
  let S = { plan: 'free', branches: [{ id: 'b0', name: 'Main branch' }], active: 'b0', staff: [], imports: { m: mkey(), n: 0 }, theme: 'light', twofa: { on: false, secret: '' },
    backup: { email: '', phone: '' }, mcp: [], transfers: [], dismissed: [] };
  try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  S.plan = 'free'; // The server is the only authority for Premium access.\n  const lim = () => LIM[S.plan === 'premium' ? 'premium' : 'free'];
  let ctx = null;
  // Keep gated navigation paused until the server has verified the current plan.
  let planVerified = false, planPromise = null;

  /* ===== backend hooks ===== */
  const api = {
    deleteAccount: p => StrapAPI.auth.deleteAccount(p),
    async checkout() {
      const r = await StrapAPI.call('POST', 'premium/checkout', {});
      if (!r.ok || !r.public_key || !r.tx_ref) { toast(r.msg || 'Could not start checkout.'); return r; }
      try {
        if (typeof window.FlutterwaveCheckout !== 'function') {
          await new Promise((resolve, reject) => {
            let script = document.querySelector('script[data-strap-flw-inline]');
            if (script) {
              if (script.dataset.loaded === 'true') return resolve();
              script.addEventListener('load', resolve, { once: true });
              script.addEventListener('error', reject, { once: true });
              return;
            }
            script = document.createElement('script');
            script.src = 'https://checkout.flutterwave.com/v3.js';
            script.async = true;
            script.dataset.strapFlwInline = 'true';
            script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
            script.onerror = () => reject(new Error('Flutterwave payment library could not load.'));
            document.head.appendChild(script);
          });
        }
        if (typeof window.FlutterwaveCheckout !== 'function') throw new Error('Flutterwave payment library is unavailable.');
        return await new Promise(resolve => {
          let modal = null, finished = false;
          const close = () => { try { if (modal && typeof modal.close === 'function') modal.close(); } catch (_) {} };
          modal = window.FlutterwaveCheckout({
            public_key: r.public_key,
            tx_ref: r.tx_ref,
            amount: Number(r.amount),
            currency: 'NGN',
            payment_options: 'card',
            customer: r.customer,
            customizations: { title: 'Strap Premium', description: 'Premium access for your Strap business' },
            configurations: { session_duration: 30, max_retry_attempt: 3 },
            callback: async payment => {
              if (finished) return;
              const transactionId = payment && (payment.transaction_id || payment.id);
              // Treat the inline callback as a transaction notification, not proof of failure.
              // Flutterwave test/live callback status strings can differ; the server must
              // verify the transaction with Flutterwave before activating or rejecting it.
              if (!transactionId) {
                const callbackStatus = String(payment && payment.status || 'unknown').toLowerCase();
                await StrapAPI.call('POST', 'billing/payment-failed', { tx_ref: r.tx_ref, reason: 'Flutterwave callback had no transaction ID (status: ' + callbackStatus.slice(0, 32) + ')' }).catch(() => {});
                finished = true; close(); resolve({ ok: false, msg: 'Flutterwave did not return a transaction ID.' });
                toast('Flutterwave did not return a transaction ID. If you were charged, contact support before trying again.'); return;
              }
              try {
                const verified = await StrapAPI.call('POST', 'premium/verify', { tx_ref: r.tx_ref, transaction_id: String(transactionId) });
                if (!verified.ok || !verified.active) throw new Error(verified.msg || 'Payment verification is still pending.');
                finished = true;
                await refreshPlan();
                toast('Strap Premium is now active.');
                close();
                showPremiumActivationSuccess(verified.receipt||{});
                resolve({ ok: true });
              } catch (error) {
                toast(error.message || 'We could not verify this payment yet.');
                close();
                finished = true;
                resolve({ ok: false, msg: error.message || 'Payment verification failed.' });
              }
            },
            onclose: () => {
              if (!finished) { finished = true; resolve({ ok: false, msg: 'Payment window closed.' }); }
            }
          });
        });
      } catch (error) {
        toast(error.message || 'Could not open Flutterwave checkout.');
        return { ok: false, msg: error.message || 'Could not open Flutterwave checkout.' };
      }
    },
    async aiExtract({ text, file }) { await sleep(1400); return null; }       // return [{title,price,qty}] from Strap AI; null = use the built-in text reader
  };

  function showPremiumActivationSuccess() {
    const existing=document.getElementById('strap-premium-success');
    if(existing) existing.remove();
    const overlay=document.createElement('div');
    overlay.id='strap-premium-success';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'99999',background:'#e6f53a'});
    const frame=document.createElement('iframe');
    frame.title='Strap Premium thank-you animation';
    frame.src='/premium-thank-you.html';
    frame.setAttribute('sandbox','allow-scripts allow-same-origin');
    frame.setAttribute('referrerpolicy','no-referrer');
    Object.assign(frame.style,{display:'block',width:'100%',height:'100%',border:'0'});
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    let closed=false;
    const close=()=>{
      if(closed)return;closed=true;
      clearTimeout(timer);
      overlay.remove();
      window.removeEventListener('message',onMessage);
    };
    const onMessage=e=>{
      if(e.source===frame.contentWindow&&e.data&&e.data.type==='premium:close')close();
    };
    window.addEventListener('message',onMessage);
    const timer=window.setTimeout(()=>{
      try{frame.contentWindow.document.getElementById('x').click();}
      catch(e){close();}
      window.setTimeout(close,500);
    },6000);
    StrapAPI.call('POST','premium/welcome-seen',{}).catch(()=>{});
  }

  async function showPendingPremiumWelcome() {
    try {
      const r=await StrapAPI.call('GET','premium/status');
      if(r.ok&&r.active&&r.welcomePending) showPremiumActivationSuccess();
    } catch(e) { console.warn('[Strap Premium] Welcome animation check failed:',e); }
  }

  /* ===== theme ===== */
  const applyTheme = () => {
    const dark = S.theme === 'dark' || (S.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };
  applyTheme();

  /* ===== per-branch products ===== */
  const ik = id => KEY + '.items.' + (id || S.active);
  const items = id => { try { return JSON.parse(localStorage.getItem(ik(id)) || '[]'); } catch (e) { return []; } };
  const setItems = (list, id) => { try { localStorage.setItem(ik(id), JSON.stringify(list.map(({ media, ...p }) => p))); } catch (e) {} };
  const branch = id => S.branches.find(b => b.id === (id || S.active)) || S.branches[0];

  /* ===== loader + roll-out screens ===== */
  async function cover(msg, fn) {
    const L = $('#loader'), M = $('#loader-msg'); M.textContent = msg; L.className = 'loader'; L.hidden = false; void L.offsetWidth; L.classList.add('on');
    await sleep(reduced() ? 0 : 650); try { await fn(); } finally { await sleep(60); L.classList.add('out'); await sleep(reduced() ? 0 : 800); L.hidden = true; L.className = 'loader'; }
  }
  let depth = 0;
  const head = (t, back = true, right = '') => `<header class="pm-head">${back ? `<button type="button" class="pm-round" data-x aria-label="Back">${ic('back', 22, 2.2)}</button>` : ''}<h1 class="pm-title">${t}</h1>${right}</header>`;
  function screen(html, wire) {
    const el = document.createElement('section'); el.className = 'fx-screen'; el.innerHTML = `<div class="fx-in" id="fxb">${html}</div>`;
    document.body.appendChild(el); depth++; document.body.classList.add('pm-open'); void el.offsetWidth; el.classList.add('on');
    const s = { el, root: $('#fxb', el), set(h) { const html = /class=["']bill-/.test(h) && !h.includes('bill-workspace') ? '<div class="bill-workspace">' + h + '</div>' : h; s.root.innerHTML = html; s.root.style.animation = 'none'; void s.root.offsetWidth; s.root.style.animation = ''; },
      async close(msg = 'Going back') { await cover(msg, () => { el.remove(); if (!--depth) document.body.classList.remove('pm-open'); }); } };
    el.addEventListener('click', e => { if (e.target.closest('[data-x]')) s.close(); });
    wire && wire(s); return s;
  }
  const toast = m => ctx.toast(m);
  const gate = (what) => K.confirm({ title: 'Upgrade to Premium', body: what, ok: 'Upgrade', cancel: 'Not now', icon: 'flash' }).then(y => y && open('premium'));
  const chk = (on, txt, k) => `<div class="fx-chk${on ? ' on' : ''}" data-chk="${k}" role="checkbox" aria-checked="${on}" tabindex="0"><i>${ic('check', 16, 3)}</i><span>${txt}</span></div>`;
  const toggleChk = t => { const c = t.closest('[data-chk]'); if (!c) return null; c.classList.toggle('on'); c.setAttribute('aria-checked', c.classList.contains('on')); return c; };

  /* ===== crypto: TOTP + hashing ===== */
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const rnd = n => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map(x => B32[x % 32]).join(''); };
  const unb32 = s => { let bits = ''; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return new Uint8Array(o); };
  async function totp(secret, t = Date.now()) {
    const k = await crypto.subtle.importKey('raw', unb32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']), m = new Uint8Array(8);
    new DataView(m.buffer).setUint32(4, Math.floor(t / 30000)); const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, m)), o = h[19] & 15;
    return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
  }
  const verifyTotp = async (secret, code) => { for (const d of [-1, 0, 1]) if (await totp(secret, Date.now() + d * 30000) === code) return true; return false; };
  const sha = async s => { try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (e) { return 'x' + btoa(s); } };
  const digits = (el, n) => { el.value = el.value.replace(/\D/g, '').slice(0, n); return el.value.length === n; };
  const bad = el => { el.classList.add('bad'); K.fx('err'); setTimeout(() => el.classList.remove('bad'), 400); };

  /* ===== PAGES ===== */
  const PAGES = {};

  /* --- Security / 2FA --- */
  PAGES.security = (s) => {
    const draw = () => s.set(head('Security') + `
      <div class="fx-card"><div class="fx-row" style="padding:0"><span class="st-ri">${ic('shield', 22, 1.8)}</span><div><b>Two-factor authentication</b><small>${S.twofa.on ? 'On. You’ll enter a 6-digit code from your authenticator app when you sign in.' : 'Add a second step at sign-in using an authenticator app like Google Authenticator or Authy.'}</small></div></div></div>
      <button class="fx-btn${S.twofa.on ? ' o' : ''}" data-a="${S.twofa.on ? 'off' : 'on'}">${S.twofa.on ? 'Turn off 2FA' : 'Set up 2FA'}</button>
      <h2 class="pm-h" style="margin-top:24px">Backup</h2><div class="pg-rows"><button class="pg-r st-nav" data-fx="backup"><span class="st-ri">${ic('mail', 20, 1.8)}</span><span>Backup email or phone</span><b>${S.backup.email || S.backup.phone ? 'Added' : 'Not set'}</b>${ic('chevR', 18, 2)}</button></div>`);
    draw();
    s.el.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'on') return setup2fa(draw);
      if (await K.confirm({ title: 'Turn off 2FA?', body: 'Your account will only be protected by your password.', ok: 'Turn off', cancel: 'Keep it on', icon: 'shield', danger: true })) { S.twofa = { on: false, secret: '' }; save(); notify('security', '2FA turned off', 'Your account is protected by your password only.'); draw(); toast('2FA turned off'); }
    });
  };

  /* --- Backup contact --- */
  PAGES.backup = (s) => {
    s.set(head('Backup contact') + `<p class="fx-p">If you ever lose access, we can reach you here. Add a backup email, a phone number, or both.</p>
      <label class="pm-fl"><span>Backup email</span><input id="bk-e" type="email" value="${esc(S.backup.email)}" placeholder="name@example.com" autocomplete="off"></label>
      <label class="pm-fl"><span>Backup phone number</span><input id="bk-p" type="tel" value="${esc(S.backup.phone)}" placeholder="+234 801 234 5678" autocomplete="off"></label><button class="fx-btn" data-s>Save backup contact</button>`);
    $('[data-s]', s.el).onclick = async () => {
      const e = $('#bk-e', s.el).value.trim(), p = $('#bk-p', s.el).value.trim();
      if (!e && !p) return toast('Add an email or a phone number');
      if (e && !/^\S+@\S+\.\S+$/.test(e)) return bad($('#bk-e', s.el).parentNode);
      if (p && p.replace(/\D/g, '').length < 7) return bad($('#bk-p', s.el).parentNode);
      S.backup = { email: e, phone: p }; save(); notify('security', 'Backup contact saved', 'We can reach you here if you lose access.'); K.fx('ok'); await s.close('Saving'); toast('Backup contact saved');
    };
  };

  /* --- Appearance --- */
  PAGES.appearance = (s) => {
    const draw = () => s.set(head('Appearance') + `<p class="fx-p">Choose how Strap looks on this device.</p><div class="fx-card">${[['light', 'Light', 'Bright and clean'], ['dark', 'Dark', 'Easier on the eyes at night'], ['system', 'Match device', 'Follows your phone’s setting']].map(([k, l, d]) =>
      `<div class="fx-row" data-t="${k}" style="cursor:pointer"><div><b>${l}</b><small>${d}</small></div><span class="fx-sw${S.theme === k ? ' on' : ''}"></span></div>`).join('')}</div>`);
    draw(); s.el.addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (!t) return; S.theme = t.dataset.t; save(); applyTheme(); draw(); });
  };

  /* --- Delete account --- */
  PAGES.delete = (s) => {
    const reasons = ['I’m closing my business', 'Strap is missing features I need', 'It’s too hard to use', 'I found another tool', 'Too expensive', 'I have a privacy concern', 'Something else'];
    const A = { reasons: new Set(), note: '', agree: false };
    const step1 = () => s.set(head('Delete account') + `<h2 class="fx-h">Before you go</h2><p class="fx-p">Tell us why you’re leaving. It takes a few seconds and helps us improve.</p>
      ${reasons.map((r, i) => chk(A.reasons.has(r), r, 'r' + i)).join('')}<label class="pm-fl"><span>Anything else? (optional)</span><input id="dn" maxlength="200" value="${esc(A.note)}"></label>
      <button class="fx-btn" data-n1 ${A.reasons.size ? '' : 'disabled'}>Continue</button><button class="fx-btn o" data-x>Keep my account</button>`);
    const step2 = () => s.set(head('Delete account', false) + `<h2 class="fx-h">What will happen</h2>
      <div class="fx-warn"><b>Deleting your account will:</b><ul><li>Remove your login, 2FA, PIN and all staff accounts</li><li>Delete every branch, product, sale, customer and receipt setting</li><li>Disconnect any AI tools you’ve authorised</li><li>Be permanent: we can’t restore it afterwards</li></ul></div>
      <div class="fx-card"><b>Your store record</b><small>For legal and reference purposes, Strap keeps a record of your store (its name, branches and plan history). Your personal login details are removed.</small></div>
      <h2 class="pm-h">Privacy policy</h2><div class="fx-doc"><h4>What we keep</h4>A reference record of your store, such as its name, branches and subscription history, is kept for audit, fraud prevention and legal obligations.<h4>What we delete</h4>Your sign-in details, staff accounts, PINs, 2FA keys, products, customers and sales data are deleted from active systems.<h4>Your rights</h4>You can ask us what we hold about your store or request correction at any time by contacting support.</div>
      ${chk(A.agree, 'I’ve read this and the privacy policy, and I understand my account can’t be restored.', 'ag')}<button class="fx-btn" data-n2 ${A.agree ? '' : 'disabled'}>Continue</button><button class="fx-btn o" data-b1>Back</button>`);
    const step3 = () => s.set(head('Delete account', false) + `<h2 class="fx-h">Confirm deletion</h2><p class="fx-p">Type <b>DELETE</b> to confirm.</p><input class="fx-pin" id="dc" maxlength="6" style="letter-spacing:.2em;font-size:20px" placeholder="DELETE" autocapitalize="characters">
      <button class="fx-btn r" data-go disabled>Delete my account</button><button class="fx-btn o" data-b2>Back</button>`);
    step1();
    s.el.addEventListener('click', async e => {
      const t = e.target; const c = toggleChk(t);
      if (c) { const k = c.dataset.chk; if (k === 'ag') { A.agree = c.classList.contains('on'); $('[data-n2]', s.el).disabled = !A.agree; } else { const r = reasons[+k.slice(1)]; c.classList.contains('on') ? A.reasons.add(r) : A.reasons.delete(r); $('[data-n1]', s.el).disabled = !A.reasons.size; } return; }
      if (t.closest('[data-n1]')) { A.note = ($('#dn', s.el) || {}).value || ''; step2(); }
      if (t.closest('[data-n2]')) { step3(); }
      if (t.closest('[data-b1]')) step1(); if (t.closest('[data-b2]')) step2();
      if (t.closest('[data-go]')) {
        await cover('Deleting your account', async () => {
          await api.deleteAccount({ survey: [...A.reasons], note: A.note, store: { name: ctx.store.bizname, branches: S.branches, plan: S.plan } });
          Object.keys(localStorage).filter(k => k.startsWith('strap')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear();
        }); location.replace('/');
      }
    });
    s.el.addEventListener('input', e => { if (e.target.id === 'dc') $('[data-go]', s.el).disabled = e.target.value.trim().toUpperCase() !== 'DELETE'; });
  };

  /* ===== onboarding-style screens: same look and motion as the sign-up form ===== */
  const ARROW = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
  const pill = (label, attrs = '', cls = '') => `<button type="button" class="pill ${cls}" ${attrs}>${label}</button>`;
  const fld = (id, ph, o = {}) => `<div class="fg"><input class="fi${o.cls ? ' ' + o.cls : ''}" id="${id}" type="${o.type || 'text'}" ${o.mode ? `inputmode="${o.mode}"` : ''} ${o.max ? `maxlength="${o.max}"` : ''} ${o.ac ? `autocomplete="${o.ac}"` : 'autocomplete="off"'} placeholder="${ph}" value="${esc(o.v || '')}" aria-label="${ph}"><p class="ferr" role="alert"></p></div>`;
  const ferr = (i, m) => { const e = i.parentNode.querySelector('.ferr'); if (e) e.textContent = m || ''; i.setAttribute('aria-invalid', m ? 'true' : 'false'); if (m) K.fx('err'); };
  function ob() {
    const el = document.createElement('section'); el.className = 'ob'; document.body.appendChild(el); depth++; document.body.classList.add('pm-open'); void el.offsetWidth; el.classList.add('on');
    const o = { el, back: null, tm: 0,
      step({ t, s = '', body = '', foot = '', back = null, noBack = false, cls = '' }) {
        clearTimeout(o.tm); o.back = back;
        el.innerHTML = `<form class="step enter ${cls}" novalidate><div class="top">${noBack ? '<div class="back-ic"></div>' : `<button type="button" class="back-ic" data-back aria-label="Back">${ARROW}</button>`}</div><div class="body"><h2 class="st">${t}</h2>${s ? `<p class="ss">${s}</p>` : ''}${body}</div><div class="sp"></div><div class="foot">${foot}</div></form>`;
        $$('.st,.ss,.fg,.rw,.qrb,.chk2,.chips,.empt,.foot > *', el).forEach((n, k) => { n.classList.add('rise'); n.style.setProperty('--i', Math.min(k, 8)); });
        el.scrollTop = 0; $('.step', el).addEventListener('submit', e => e.preventDefault());
        const i = $('input.fi', el); if (i) setTimeout(() => { try { i.focus({ preventScroll: true }); } catch (e) {} }, 400);
      },
      // success screen: ring draws, tick draws, sparks burst, then we carry on (button, or automatically after `auto` ms)
      ok(t, s, label, fn, auto = 0) {
        clearTimeout(o.tm); o.back = null; let done = false; const go = () => { if (done) return; done = true; clearTimeout(o.tm); fn(); };
        el.innerHTML = `<div class="step enter okw"><div class="top"><div class="back-ic"></div></div><div class="body"><div class="okm"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="okr" cx="60" cy="60" r="54" pathLength="1"/><circle class="okd" cx="60" cy="60" r="44"/><path class="okt" d="M41 62l14 14 26-31" pathLength="1"/></svg><i></i><i></i><i></i></div><h2 class="st">${t}</h2>${s ? `<p class="ss">${s}</p>` : ''}</div><div class="foot">${pill(label, 'data-ok')}</div></div>`;
        K.fx('ok'); $('[data-ok]', el).onclick = go; if (auto) o.tm = setTimeout(go, reduced() ? 600 : auto);
      },
      async close(msg = 'Going back') { clearTimeout(o.tm); await cover(msg, () => { el.remove(); if (!--depth) document.body.classList.remove('pm-open'); }); }
    };
    el.addEventListener('click', e => { if (e.target.closest('[data-back]')) o.back ? o.back() : o.close(); });
    return o;
  }

  /* --- 2FA + backup phone (set up once; Settings, Branch and Staff all rely on it) --- */
  const secured = () => !!(S.twofa.on && S.backup.phone);
  function twoStep(o, back, after) {
    const secret = rnd(32), label = encodeURIComponent((ctx.store.bizname || 'Store') + ':' + (ctx.store.email || ctx.store.name || 'owner'));
    const uri = `otpauth://totp/Strap:${label}?secret=${secret}&issuer=Strap&digits=6&period=30`;
    o.step({ t: 'Scan with your authenticator', s: 'Open Google Authenticator, Authy or 1Password, tap add, then scan this code.', back,
      body: `<div class="qrb"><div id="qr"></div></div><p class="ss c">Can’t scan? Enter this key instead</p><div class="fx-key">${secret.match(/.{1,4}/g).join(' ')}</div><button type="button" class="lnk" data-copy>Copy key</button>${fld('otp', 'Enter the 6 digit code', { cls: 'code8', mode: 'numeric', ac: 'one-time-code', max: 6 })}`,
      foot: pill('Verify and turn on', 'data-v disabled') });
    try { new QRCode($('#qr', o.el), { text: uri, width: 176, height: 176, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { const q = $('.qrb', o.el); q && q.remove(); }
    const oi = $('#otp', o.el), v = $('[data-v]', o.el);
    oi.oninput = () => { v.disabled = !digits(oi, 6); ferr(oi, ''); };
    $('[data-copy]', o.el).onclick = async () => { try { await navigator.clipboard.writeText(secret); toast('Key copied'); } catch (er) { toast('Select and copy the key'); } };
    v.onclick = async () => {
      if (v.disabled) return; let ok = false; try { ok = await verifyTotp(secret, oi.value); } catch (er) { toast('Open Strap over https to use 2FA'); return; }
      if (!ok) { ferr(oi, 'That code isn’t right. Check the app and try again.'); oi.value = ''; v.disabled = true; return; }
      S.twofa = { on: true, secret }; save(); notify('security', '2FA is on', 'You’ll need a code from your authenticator app to sign in.'); after();
    };
  }
  function phoneStep(o, back, after) {
    o.step({ t: 'Add a backup phone number', s: 'If you ever lose your authenticator, we’ll use this number to reach you.', back,
      body: fld('bk', '+234 801 234 5678', { type: 'tel', mode: 'tel', ac: 'tel', max: 20, v: S.backup.phone }), foot: pill('Save number', 'data-s disabled') });
    const i = $('#bk', o.el), b = $('[data-s]', o.el), okp = () => i.value.replace(/\D/g, '').length >= 8;
    b.disabled = !okp(); i.oninput = () => { b.disabled = !okp(); ferr(i, ''); };
    b.onclick = () => { if (!okp()) return ferr(i, 'Enter a valid phone number.'); S.backup = { ...S.backup, phone: i.value.trim() }; save(); notify('security', 'Backup number saved', 'We can reach you here if you lose access.'); after(); };
  }
  function ensureSecure(o, why, next) {
    if (secured()) return next();
    const row = (ico, t, d, on) => `<div class="rw ro"><i class="ri">${ic(ico, 22, 1.8)}</i><div><b>${t}</b><small>${d}</small></div>${on ? `<em class="rt">${ic('check', 14, 3)} Done</em>` : ''}</div>`;
    const fin = () => o.ok('Your account is secured', 'Two-factor authentication and your backup number are set. You won’t be asked again.', 'Continue', next);
    const afterTwo = () => !S.backup.phone ? phoneStep(o, intro, fin) : fin();
    const pick = () => !S.twofa.on ? twoStep(o, intro, afterTwo) : afterTwo();
    const intro = () => { o.step({ t: 'Secure your account first', s: `Before you ${why}, add two protections. You only do this once.`, back: null,
      body: `<div class="rws">${row('shield', 'Two-factor authentication', 'A 6 digit code from your authenticator app', S.twofa.on)}${row('phone', 'Backup phone number', 'So we can reach you if you lose access', !!S.backup.phone)}</div>`, foot: pill('Continue', 'data-c') }); $('[data-c]', o.el).onclick = pick; };
    intro();
  }
  function setup2fa(done) {
    cover('Preparing your secure key', () => { const o = ob(); twoStep(o, null, () => o.ok('2FA is on', 'From now on you’ll need a code from your authenticator app when you sign in.', 'Done', async () => { await o.close(); done && done(); })); });
  }

  /* --- Branch: switch and create, from Settings only --- */
  function branchFlow() { cover('Opening', () => { const o = ob(); ensureSecure(o, 'switch branches', () => branchHome(o)); }); }
  function branchHome(o, sel) {
    sel = sel || S.active;
    o.step({ t: 'Switch branch', s: `You’re viewing <b>${esc(branch().name)}</b>. Each branch keeps its own products.`, back: null,
      body: `<div class="rws">${S.branches.map(b => `<button type="button" class="rw pick${sel === b.id ? ' on' : ''}" data-b="${b.id}"><i class="rd"></i><div><b>${esc(b.name)}</b><small>${items(b.id).length} products${b.id === S.active ? ' · Current' : ''}</small></div></button>`).join('')}</div>`,
      foot: pill('Switch branch', 'data-sw' + (sel === S.active ? ' disabled' : '')) + pill('Add a branch', 'data-add', 'alt') + (S.plan === 'free' ? `<p class="note">${S.branches.length} of ${lim().branches} branches used on the free plan</p>` : '') });
    const sw = $('[data-sw]', o.el);
    $$('[data-b]', o.el).forEach(b => b.onclick = () => { sel = b.dataset.b; $$('[data-b]', o.el).forEach(x => x.classList.toggle('on', x === b)); sw.disabled = sel === S.active; K.fx('tap'); });
    sw.onclick = () => { if (sw.disabled) return; const id = sel, nm = branch(id).name; o.ok('Switched to ' + esc(nm), 'Taking you back to your dashboard.', 'Back to dashboard', () => { S.active = id; save(); location.reload(); }, 2200); };
    $('[data-add]', o.el).onclick = () => {
      if (S.branches.length >= lim().branches) return gate(`The free plan includes ${LIM.free.branches} branches. Upgrade to Premium to add more.`);
      o.step({ t: 'Name your branch', s: 'Give it a name your team will recognise.', back: () => branchHome(o, sel), body: fld('bn', 'e.g. Lekki branch', { max: 40 }), foot: pill('Create branch', 'data-ok disabled') });
      const i = $('#bn', o.el), b = $('[data-ok]', o.el); i.oninput = () => { b.disabled = !i.value.trim(); ferr(i, ''); };
      b.onclick = () => { const n = i.value.trim(); if (!n) return ferr(i, 'Enter a branch name.'); S.branches.push({ id: 'b' + Date.now().toString(36), name: n }); save(); notify('account', 'Branch created', n + ' is ready.'); o.ok('Branch created', `${esc(n)} is ready. You can switch to it any time.`, 'Done', () => branchHome(o, sel)); };
    };
  }

  /* --- Staff --- */
  const ROLES = [['Cashier', 'Sales desk and sales history'], ['Stock keeper', 'Products, inventory and transfers']];
  const slug = (n, max = 14) => {
    const skip = new Set(['and', 'the', 'ltd', 'limited', 'store', 'stores', 'shop', 'house', 'enterprises', 'global', 'ventures', 'company', 'co', 'inc', 'of']);
    let w = n.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean), k = w.filter(x => !skip.has(x)); if (!k.length) k = w;
    let s = k.join(''); if (s.length > max) s = k[0].slice(0, max - (k.length - 1)) + k.slice(1).map(x => x[0]).join(''); return (s || 'mystore').slice(0, max);
  };
  const mailFor = (name, dom) => { const p = name.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean); let m; do m = `${p[0] || 'staff'}${p[1] ? '.' + p[1][0] : ''}${10 + Math.floor(Math.random() * 90)}@${dom}.com`; while (S.staff.some(x => x.email === m)); return m; };
  function staffFlow() {
    cover('Opening', async () => {
      const o = ob();
      const loadStaff = async () => {
        o.step({ t: 'Staff', s: 'Loading your staff accounts…', body: '<div class="empt"><p>Please wait while Strap loads your team.</p></div>', foot: '' });
        try {
          const res = await StrapAPI.auth.listStaff();
          if (!res || !res.ok) throw new Error(res && res.msg || 'Could not load staff from your store.');
          S.staff = (Array.isArray(res.staff) ? res.staff : []).map(x => ({ ...x, shift: x.shift || { mode: 'closed', from: '', to: '' } }));
          save();
          staffHome(o);
        } catch (error) {
          console.error('[Strap staff] Could not load staff:', error);
          o.step({
            t: 'Could not load staff',
            s: 'Your staff accounts are safe. Check your connection and try again.',
            body: '<div class="fx-warn"><b>Staff list unavailable</b><p class="fx-p">' + esc(error && error.message || 'Please try again.') + '</p></div>',
            foot: pill('Try again', 'data-retry') + pill('Close', 'data-x', 'alt')
          });
          const retry = $('[data-retry]', o.el);
          if (retry) retry.onclick = loadStaff;
        }
      };
      ensureSecure(o, 'manage staff', loadStaff);
    });
  }
  /* ===== STAFF MENU (new): open / close a cashier's sales, automatic hours, remove ===== */
  // A cashier's `shift` is { mode: 'open' | 'closed' | 'auto', from: 'HH:MM', to: 'HH:MM' }. New cashiers start closed,
  // so nobody sells until you open sales. `auto` opens at `from` and closes at `to` every day (overnight hours work too).
  const shiftOf = x => Object.assign({ mode: 'closed', from: '', to: '' }, x.shift || {});
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const t12 = t => { const m = toMin(t); if (m == null) return ''; const h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  function shiftNow(x) {
    const s = shiftOf(x), a = toMin(s.from), b = toMin(s.to);
    if (s.mode === 'open') return { open: true, s };
    if (s.mode === 'auto' && a != null && b != null) { const d = new Date(), n = d.getHours() * 60 + d.getMinutes(); return { open: a <= b ? (n >= a && n < b) : (n >= a || n < b), s }; }
    return { open: false, s };
  }
  const shiftText = x => { const { open, s } = shiftNow(x); return s.mode === 'auto' && toMin(s.from) != null && toMin(s.to) != null ? (open ? `Open · closes ${t12(s.to)}` : `Closed · opens ${t12(s.from)}`) : (open ? 'Sales open' : 'Sales closed'); };
  const first = x => (x.name || 'them').trim().split(/\s+/)[0];

  async function setShift(o, x, patch, msg) {
    const next = Object.assign(shiftOf(x), patch);
    const result = await api.setStaffShift(x.id, next);
    if (!result || !result.ok) { toast(result && result.msg || 'Could not update this cashier.'); return; }
    x.shift = next; save(); notify('staff', 'Sales hours changed', msg); toast(msg); staffHome(o);
  }
  function closeMenu(o) {
    const sm = o.sm; if (!sm) return; o.sm = null;
    sm.btn.setAttribute('aria-expanded', 'false'); sm.m.classList.remove('on');
    document.removeEventListener('pointerdown', sm.out, true); document.removeEventListener('keydown', sm.key, true); o.el.removeEventListener('scroll', sm.off); removeEventListener('resize', sm.off);
    setTimeout(() => sm.m.remove(), 160);
  }
  function openMenu(o, btn, x) {
    if (o.sm && o.sm.btn === btn) return closeMenu(o);
    closeMenu(o);
    const { open, s } = shiftNow(x), auto = s.mode === 'auto' && toMin(s.from) != null;
    const m = document.createElement('div'); m.className = 'smenu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', `Options for ${x.name}`);
    m.innerHTML = `<div class="smh"><i class="${open ? 'on' : ''}"></i><div><b>${open ? 'Sales is open' : 'Sales is closed'}</b><small>${esc(x.name)}${auto ? ` · ${t12(s.from)} to ${t12(s.to)}` : ''}</small></div></div>
      <button type="button" class="smi" role="menuitem" data-a="toggle"><span class="si">${ic(open ? 'lock' : 'flash', 20, 1.9)}</span><div><b>${open ? 'Close sales now' : 'Open sales now'}</b><small>${open ? `Stops ${esc(first(x))} from selling` : `Lets ${esc(first(x))} start selling`}${auto ? ' · replaces automatic hours' : ''}</small></div></button>
      <button type="button" class="smi" role="menuitem" data-a="auto"><span class="si">${ic('clock', 20, 1.9)}</span><div><b>Automatic open &amp; close</b><small>${auto ? `${t12(s.from)} to ${t12(s.to)}, every day` : 'Set daily opening hours'}</small></div><em class="smt${auto ? ' on' : ''}">${auto ? 'On' : 'Off'}</em></button>
      <div class="smd" role="separator"></div>
      <button type="button" class="smi" role="menuitem" data-a="message"><span class="si">${ic('mail', 20, 1.9)}</span><div><b>Send message</b><small>Write to this staff member by email</small></div></button>
      <button type="button" class="smi dg" role="menuitem" data-a="del"><span class="si">${ic('trash', 20, 1.9)}</span><div><b>Remove staff</b><small>Their login stops working</small></div></button>`;
    o.el.appendChild(m);
    const er = o.el.getBoundingClientRect(), br = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    const left = Math.max(12, Math.min(br.right - er.left - w, er.width - w - 12));
    const flip = br.bottom + 10 + h > er.bottom - 12 && br.top - er.top > h + 20;
    m.style.left = left + 'px'; m.style.top = (flip ? br.top - er.top - h - 8 : br.bottom - er.top + 8) + o.el.scrollTop + 'px'; m.classList.toggle('up', flip);
    m.style.setProperty('--ox', (br.right - er.left - left - 22) + 'px');
    void m.offsetWidth; m.classList.add('on'); btn.setAttribute('aria-expanded', 'true');
    const items = $$('.smi', m); setTimeout(() => items[0] && items[0].focus({ preventScroll: true }), 30);
    const sm = o.sm = { m, btn, off: () => closeMenu(o),
      out: e => { if (!m.contains(e.target) && !btn.contains(e.target)) closeMenu(o); },
      key: e => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(o); btn.focus(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const k = items.indexOf(document.activeElement); items[(k + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); } } };
    document.addEventListener('pointerdown', sm.out, true); document.addEventListener('keydown', sm.key, true); o.el.addEventListener('scroll', sm.off, { passive: true }); addEventListener('resize', sm.off);
    m.addEventListener('click', async e => {
      const it = e.target.closest('[data-a]'); if (!it) return; const act = it.dataset.a; closeMenu(o);
      if (act === 'toggle') {
        if (!open) return setShift(o, x, { mode: 'open' }, `Sales is open for ${first(x)}`);
        if (await K.confirm({ title: 'Close sales now?', body: `${x.name} won’t be able to sell until you open sales again. A sale in progress stays in their cart.`, ok: 'Close sales', cancel: 'Keep open', icon: 'lock', danger: true })) setShift(o, x, { mode: 'closed' }, `Sales is closed for ${first(x)}`);
      } else if (act === 'auto') autoStep(o, x);
      else if (act === 'message') { const subject=encodeURIComponent('Message from '+(ctx.store.bizname||'your store')); location.href='mailto:'+encodeURIComponent(x.email)+'?subject='+subject; }
      else if (act === 'del' && await K.confirm({ title: 'Remove this staff member?', body: 'Their login stops working immediately.', ok: 'Remove', cancel: 'Keep', icon: 'trash', danger: true })) { const res=await StrapAPI.auth.removeStaff(x.id); if(!res||!res.ok)return toast(res&&res.msg||'Could not remove staff.'); S.staff = S.staff.filter(y => y.id !== x.id); save(); staffHome(o); }
    });
  }
  function autoStep(o, x) {
    const s = shiftOf(x), on = s.mode === 'auto', home = () => staffHome(o);
    o.step({ t: 'Automatic hours', s: `Sales opens and closes by itself for ${esc(x.name)}, every day. Outside these hours they can’t make a sale.`, back: home,
      body: `<p class="ss lab">Opens at</p><div class="fg tm"><input class="fi" id="ta" type="time" value="${esc(s.from || '08:00')}" aria-label="Opening time"><p class="ferr" role="alert"></p></div>
        <p class="ss lab">Closes at</p><div class="fg tm"><input class="fi" id="tb" type="time" value="${esc(s.to || '20:00')}" aria-label="Closing time"><p class="ferr" role="alert"></p></div><p class="ss" id="tn"></p>`,
      foot: pill(on ? 'Save hours' : 'Turn on automatic hours', 'data-save') + (on ? pill('Turn off automatic hours', 'data-off', 'alt') : '') });
    const ta = $('#ta', o.el), tb = $('#tb', o.el), note = () => { const a = toMin(ta.value), b = toMin(tb.value);
      $('#tn', o.el).textContent = a == null || b == null ? '' : a === b ? 'Opening and closing can’t be the same time.' : a < b ? `Open for ${Math.floor((b - a) / 60)}h${(b - a) % 60 ? ' ' + ((b - a) % 60) + 'm' : ''} each day.` : `Overnight: opens ${t12(ta.value)} and closes ${t12(tb.value)} the next morning.`; };
    ta.oninput = tb.oninput = note; note();
    $('[data-save]', o.el).onclick = async () => {
      const a = toMin(ta.value), b = toMin(tb.value);
      if (a == null) return ferr(ta, 'Choose the opening time.'); if (b == null) return ferr(tb, 'Choose the closing time.'); if (a === b) return ferr(tb, 'Closing time must be different.');
      const next = { mode: 'auto', from: ta.value, to: tb.value }; const result = await api.setStaffShift(x.id, next); if (!result || !result.ok) return toast(result && result.msg || 'Could not save automatic hours.'); x.shift = next; save();
      notify('staff', 'Automatic hours on', `${x.name}’s sales opens at ${t12(ta.value)} and closes at ${t12(tb.value)}.`);
      o.ok('Automatic hours on', `${esc(x.name)}’s sales opens at ${t12(ta.value)} and closes at ${t12(tb.value)}, every day.`, 'Back to staff', home, 1800);
    };
    const off = $('[data-off]', o.el); if (off) off.onclick = () => { setShift(o, x, { mode: 'closed' }, `Automatic hours off. Sales is closed for ${first(x)} until you open it`); };
  }

  function staffHome(o) {
    closeMenu(o); clearInterval(o.shT);
    const card = x => { const cash = x.role === 'Cashier';
      return `<div class="rw ro"><i class="ri">${ic('users', 22, 1.8)}</i><div><b>${esc(x.name)}</b><small>${esc(x.role)} · ${esc(x.branch ? branch(x.branch).name : 'All branches')}<br>${esc(x.email)}</small>${cash ? `<span class="shp${shiftNow(x).open ? ' on' : ''}" data-shp="${x.id}"><i></i><span>${esc(shiftText(x))}</span></span>` : ''}</div>`
        + (cash ? `<button type="button" class="rx rmore" data-more="${x.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Options for ${esc(x.name)}">${ic('dots', 22, 2)}</button>`
                : `<button type="button" class="rx" data-del="${x.id}" aria-label="Remove ${esc(x.name)}">${ic('trash', 20, 1.8)}</button>`) + `</div>`; };
    o.step({ t: 'Staff', s: `${S.staff.length} of ${lim().staff} staff accounts used${S.plan === 'free' ? ' on the free plan' : ''}.`, back: null,
      body: S.staff.length ? `<div class="rws">${S.staff.map(card).join('')}</div>` : `<div class="empt">${U.illus('customers')}<p>No staff yet. Add the people who help you run the business and give each one their own login.</p></div>`,
      foot: pill('Add staff', 'data-add') + (S.plan === 'free' ? pill('Upgrade for branch staff', 'data-up', 'alt') : '') });
    $('[data-add]', o.el).onclick = () => { if (S.staff.length >= lim().staff) return gate(`The free plan includes ${LIM.free.staff} staff accounts. Upgrade to Premium for more.`); addStaff(o); };
    const up = $('[data-up]', o.el); if (up) up.onclick = () => open('premium');
    $$('[data-more]', o.el).forEach(b => b.onclick = () => openMenu(o, b, S.staff.find(y => y.id === b.dataset.more)));
    $$('[data-del]', o.el).forEach(d => d.onclick = async () => { if (await K.confirm({ title: 'Remove this staff member?', body: 'Their login stops working immediately.', ok: 'Remove', cancel: 'Keep', icon: 'trash', danger: true })) { const res=await StrapAPI.auth.removeStaff(d.dataset.del); if(!res||!res.ok)return toast(res&&res.msg||'Could not remove staff.'); S.staff = S.staff.filter(x => x.id !== d.dataset.del); save(); staffHome(o); } });
    // keep the "Sales open / closed" pills right while this screen stays open and automatic hours roll over
    o.shT = setInterval(() => { if (!o.el.isConnected) return clearInterval(o.shT); S.staff.forEach(x => { const p = $(`[data-shp="${x.id}"]`, o.el); if (p) { p.classList.toggle('on', shiftNow(x).open); p.lastElementChild.textContent = shiftText(x); } }); }, 20000);
  }
  function addStaff(o) {
    const A = { name: '', role: '', branch: null, pin: '', dom: slug(ctx.store.bizname || 'store'), email: '' }, fn = () => esc(A.name.split(' ')[0]);
    const home = () => staffHome(o);
    const privacy = () => { let agree = false;
      o.step({ t: 'Before you add staff', s: 'Staff can see parts of your business. Please confirm the privacy policy.', back: home,
        body: `<div class="doc"><h4>Your responsibility</h4>You decide what each staff member can access and you’re responsible for how they use your store’s data.<h4>Staff data</h4>Strap stores each staff member’s name, role, work email and a protected PIN so they can sign in. PINs are never stored in plain text.<h4>Activity</h4>Sales and stock changes made by staff are recorded against their name so you can review them.<h4>Removal</h4>You can remove a staff member at any time and their access ends immediately.</div><button type="button" class="chk2" data-agree role="checkbox" aria-checked="false"><i>${ic('check', 16, 3)}</i><span>I accept the privacy policy and will tell my staff how their details are used.</span></button>`,
        foot: pill('Continue', 'data-n disabled') });
      const c = $('[data-agree]', o.el), n = $('[data-n]', o.el); c.onclick = () => { agree = !agree; c.classList.toggle('on', agree); c.setAttribute('aria-checked', agree); n.disabled = !agree; K.fx('tap'); }; n.onclick = () => agree && who(); };
    const who = () => {
      o.step({ t: 'Who are you adding?', back: privacy,
        body: fld('sn', 'Staff full name', { max: 40, ac: 'off', v: A.name }) + `<p class="ss lab">What will they handle?</p><div class="chips">${ROLES.map(([r]) => `<button type="button" class="chp${A.role === r ? ' on' : ''}" data-r="${r}">${r}</button>`).join('')}</div><p class="ss" id="rd">${A.role ? ROLES.find(x => x[0] === A.role)[1] : 'Pick the part of the business they’ll look after.'}</p>` +
          (S.branches.length > 1 ? `<p class="ss lab">Branch</p><div class="chips"><button type="button" class="chp${A.branch === null ? ' on' : ''}" data-bb="">All branches</button>${S.branches.map(b => `<button type="button" class="chp${A.branch === b.id ? ' on' : ''}" data-bb="${b.id}">${esc(b.name)}${S.plan === 'free' ? ' · Premium' : ''}</button>`).join('')}</div>` : ''),
        foot: pill('Continue', 'data-n') });
      $$('[data-r]', o.el).forEach(r => r.onclick = () => { A.role = r.dataset.r; $$('[data-r]', o.el).forEach(x => x.classList.toggle('on', x === r)); $('#rd', o.el).textContent = ROLES.find(x => x[0] === A.role)[1]; });
      $$('[data-bb]', o.el).forEach(b => b.onclick = () => { if (b.dataset.bb && S.plan === 'free') return gate('Assigning a dedicated staff member to a branch needs a Premium account.'); A.branch = b.dataset.bb || null; $$('[data-bb]', o.el).forEach(x => x.classList.toggle('on', x === b)); });
      $('[data-n]', o.el).onclick = () => { const i = $('#sn', o.el); A.name = i.value.trim(); if (!A.name) return ferr(i, 'Enter their name.'); if (!A.role) return toast('Choose what they’ll handle'); pin(); };
    };
    const pin = () => {
      o.step({ t: 'Create a 6 digit login PIN', s: `${fn()} will use this PIN with their Strap work email to sign in.`, back: who,
        body: fld('p1', 'Create PIN', { type: 'password', mode: 'numeric', max: 6, cls: 'code8' }) + fld('p2', 'Confirm PIN', { type: 'password', mode: 'numeric', max: 6, cls: 'code8' }), foot: pill('Set up staff', 'data-n disabled') });
      const a = $('#p1', o.el), b = $('#p2', o.el), n = $('[data-n]', o.el);
      const chk = () => { const x = digits(a, 6), y = digits(b, 6); n.disabled = !(x && y && a.value === b.value); ferr(b, b.value.length === 6 && a.value !== b.value ? 'The PINs don’t match.' : ''); };
      a.oninput = chk; b.oninput = chk; n.onclick = () => { if (n.disabled) return; A.pin = a.value; setup(); };
    };
    const setup = async () => {
      o.step({ t: `Setting up ${fn()}`, s: 'Creating their account', noBack: true, body: '<div class="spn"><div class="fx-spin"><i></i><b></b><span></span></div></div>' });
      for (const m of ['Creating their account', 'Locking in their PIN', 'Choosing a work email']) { const s = $('.ss', o.el); if (!s) return; s.textContent = m; await sleep(1000); }
      A.email = mailFor(A.name, A.dom); email();
    };
    const email = () => {
      o.step({ t: `${fn()}’s work email`, s: `Give this email to ${fn()}. They’ll sign in with it and their 6 digit PIN.`, noBack: true,
        body: `<div class="fx-mail">${esc(A.email)}</div>`, foot: pill('Finish', 'data-fin') + pill('Adjust email', 'data-ed', 'alt') + pill('Copy email', 'data-cp', 'alt') });
      $('[data-cp]', o.el).onclick = async () => { try { await navigator.clipboard.writeText(A.email); toast('Email copied'); } catch (er) { toast(A.email); } };
      $('[data-ed]', o.el).onclick = () => {
        const sh = K.sheet({ title: 'Adjust email', body: `<p class="fx-p">Change the name part, or use another @business name.</p><label class="pm-fl"><span>Name part</span><input id="e1" value="${esc(A.email.split('@')[0])}" maxlength="30"></label><label class="pm-fl"><span>Business name part (ends in .com)</span><input id="e2" value="${esc(A.dom)}" maxlength="20"></label><button class="pm-add wide" data-ok>Use this email</button>` });
        sh.body.addEventListener('click', ev => { if (!ev.target.closest('[data-ok]')) return; const a = $('#e1', sh.body).value.toLowerCase().replace(/[^a-z0-9.\-_]/g, ''), d = $('#e2', sh.body).value.toLowerCase().replace(/[^a-z0-9\-]/g, '');
          if (!a || !d) return bad($('#e1', sh.body).parentNode); if (S.staff.some(x => x.email === `${a}@${d}.com`)) return toast('That email is taken'); A.dom = d; A.email = `${a}@${d}.com`; sh.close(); email(); });
      };
      $('[data-fin]', o.el).onclick = async () => {
        const result = await api.createStaff({ name:A.name, role:A.role, branch:A.branch, email:A.email, pin:A.pin });
        if(!result || !result.ok || !result.staff) { toast(result && result.msg || 'Could not create this staff account.'); return email(); }
        const st = {...result.staff, shift:{mode:'closed',from:'',to:''}}; S.staff.unshift(st); save(); notify('staff', 'Staff added', `${st.name} can now sign in as ${st.role}.`);
        o.ok('Staff added', `${esc(st.name)} can now sign in as ${esc(st.role)}.`, 'Back to staff', home);
      };
    };
    privacy();
  }

  /* --- Transfers between branches --- */
  PAGES.transfers = (s) => {
    const draw = () => s.set(head('Transfers') + (S.branches.length < 2 ? `<div class="pg-empty">${U.illus('transfers')}<h2>Add a second branch</h2><p>Transfers move stock between your branches. Create another branch to start.</p><button class="fx-btn" data-add>Create branch</button></div>` :
      `<p class="fx-p">Viewing <b>${esc(branch().name)}</b>. Move stock to another branch, then switch to see it there.</p><button class="fx-btn" data-new>${ic('transfer', 20, 2)} New transfer</button>
      ${S.transfers.length ? `<div class="fx-card">${S.transfers.map(t => `<div class="fx-row"><span class="st-ri">${ic('transfer', 20, 1.8)}</span><div><b>${t.qty} × ${esc(t.title)}</b><small>${esc(t.from)} → ${esc(t.to)} · ${new Date(t.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></div></div>`).join('')}</div>` : ''}`));
    draw();
    s.el.addEventListener('click', e => {
      if (e.target.closest('[data-add]')) return open('branchsw');
      if (!e.target.closest('[data-new]')) return;
      const src = items().filter(p => (p.qty || 0) > 0); if (!src.length) return toast('This branch has no stock to move');
      const T = { p: src[0].id, to: S.branches.find(b => b.id !== S.active).id, q: 1 };
      const sh = K.sheet({ title: 'New transfer', body: '' }), paint = () => { const p = src.find(x => x.id === T.p); T.q = Math.min(Math.max(1, T.q), p.qty);
        sh.body.innerHTML = `<p class="fx-p" style="margin-top:0">From <b>${esc(branch().name)}</b> to</p><div class="fx-chips">${S.branches.filter(b => b.id !== S.active).map(b => `<button class="fx-chip${T.to === b.id ? ' on' : ''}" data-to="${b.id}">${esc(b.name)}</button>`).join('')}</div>
        <h2 class="pm-h">Product</h2><div class="fx-chips">${src.slice(0, 30).map(x => `<button class="fx-chip${T.p === x.id ? ' on' : ''}" data-p="${x.id}">${esc(x.title)} (${x.qty})</button>`).join('')}</div>
        <h2 class="pm-h">Quantity</h2><div class="pm-step"><button data-q="-1">−</button><span class="pg-q">${T.q}</span><button data-q="1">+</button></div><button class="pm-add wide" data-go>Transfer ${T.q}</button>`; };
      paint();
      sh.body.addEventListener('click', async ev => {
        const t = ev.target, to = t.closest('[data-to]'), p = t.closest('[data-p]'), q = t.closest('[data-q]');
        if (to) { T.to = to.dataset.to; paint(); } if (p) { T.p = p.dataset.p; T.q = 1; paint(); } if (q) { T.q += +q.dataset.q; paint(); }
        if (!t.closest('[data-go]')) return; sh.close();
        await cover('Transferring stock', async () => {
          const from = items(), dest = items(T.to), a = from.find(x => x.id === T.p), b = dest.find(x => x.title === a.title);
          a.qty -= T.q; if (b) b.qty = (b.qty || 0) + T.q; else dest.push({ ...a, id: 'p' + Date.now().toString(36), qty: T.q });
          setItems(from); setItems(dest, T.to); const live = ctx.products();
          if (live) { const arr = live.items(), la = arr.find(x => x.id === T.p); if (la) live.setQty(la.id, a.qty); }
          S.transfers.unshift({ title: a.title, qty: T.q, from: branch().name, to: branch(T.to).name, at: Date.now() }); save(); notify('stock', 'Stock transferred', `${T.q} × ${a.title} to ${branch(T.to).name}.`);
        }); K.fx('ok'); draw(); toast('Stock transferred');
      });
    });
  };


  /* --- Billing workspace: live account-scoped billing pages --- */
  const BILLING_IDS = ['billing-overview','billing-history','billing-receipts','billing-results','billing-renew','billing-subscription','billing-notifications','billing-reconciliation'];
  const billMoney = n => new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(Number(n)||0);
  const billDate = v => v ? new Date(v).toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'}) : '—';
  const billStatus = v => '<span class="bill-status '+esc(String(v||'pending').toLowerCase())+'">'+esc(String(v||'pending').replace(/_/g,' '))+'</span>';
  const billEmpty = (title,body) => '<div class="bill-empty"><span>'+ic('receipt',25,1.8)+'</span><b>'+title+'</b><p>'+body+'</p></div>';
  const billUsage = (count, premium) => {
    const pct = Math.min(100, Math.round(count / 30 * 100));
    return '<section class="bill-card"><div class="bill-card-head"><b>Product allowance</b><span>' + (premium ? 'Premium' : 'Free plan') + '</span></div>' +
      '<div class="bill-usage-line"><b>' + Number(count).toLocaleString('en-NG') + (premium ? ' products' : ' of 30 products') + '</b><span>' + (premium ? 'No product cap' : pct + '% used') + '</span></div>' +
      (premium ? '' : '<div class="bill-usage-track" role="progressbar" aria-label="Free product allowance" aria-valuemin="0" aria-valuemax="30" aria-valuenow="' + Math.min(30, count) + '"><i class="' + (pct >= 80 ? 'near-limit' : '') + '" style="width:' + pct + '%"></i></div>') +
      '<p class="bill-help">' + (premium ? 'Premium removes the Free plan product cap.' : 'The Free plan includes up to 30 products. Upgrade before reaching the limit.') + '</p></section>';
  };
  const billFailedAlert = count => Number(count) > 0
    ? '<div class="bill-alert"><strong>' + Number(count).toLocaleString('en-NG') + ' failed payment' + (Number(count) === 1 ? '' : 's') + '</strong>A previous checkout did not complete. You can safely start a new secure payment when you are ready.<br><button class="bill-secondary" style="margin-top:10px" data-fx="billing-renew">Retry payment</button></div>'
    : '';
  async function billGet(path) { return StrapAPI.call('GET',path); }
  async function billLaunchRenew() {
    const r=await StrapAPI.call('POST','billing/renew',{});
    if(!r.ok||!r.public_key||!r.tx_ref) throw new Error(r.msg||'Could not prepare renewal checkout.');
    if(typeof window.FlutterwaveCheckout!=='function') await new Promise((resolve,reject)=>{
      let script=document.querySelector('script[data-strap-flw-inline]');
      if(script){if(script.dataset.loaded==='true')return resolve();script.addEventListener('load',resolve,{once:true});script.addEventListener('error',reject,{once:true});return;}
      script=document.createElement('script');script.src='https://checkout.flutterwave.com/v3.js';script.async=true;script.dataset.strapFlwInline='true';
      script.onload=()=>{script.dataset.loaded='true';resolve();};script.onerror=()=>reject(new Error('Flutterwave payment library could not load.'));document.head.appendChild(script);
    });
    await new Promise((resolve,reject)=>{
      let done=false,modal;
      modal=window.FlutterwaveCheckout({public_key:r.public_key,tx_ref:r.tx_ref,amount:Number(r.amount),currency:'NGN',payment_options:'card',
        customer:r.customer,customizations:{title:'Strap Premium renewal',description:'Renew your Strap Premium subscription'},
        callback:async p=>{if(done)return;
          if(p&&String(p.status||'').toLowerCase()&&String(p.status).toLowerCase()!=='successful'){
            await StrapAPI.call('POST','billing/payment-failed',{tx_ref:r.tx_ref,reason:'Flutterwave checkout returned '+String(p.status).slice(0,40)}).catch(()=>{});
            done=true;try{modal&&modal.close&&modal.close();}catch(e){}resolve();toast('Payment was not completed. You can try again from Billing.');return;
          }
          const id=p&&(p.transaction_id||p.id);if(!id)return;
          try{const v=await StrapAPI.call('POST','premium/verify',{tx_ref:r.tx_ref,transaction_id:String(id)});if(!v.ok||!v.active)throw new Error(v.msg||'Payment verification is pending.');
            done=true;await refreshPlan();toast('Premium renewed successfully.');try{modal&&modal.close&&modal.close();}catch(e){}showPremiumActivationSuccess(v.receipt||{});resolve();
            setTimeout(()=>location.reload(),500);
          }catch(e){done=true;try{modal&&modal.close&&modal.close();}catch(x){}reject(e);}
        },onclose:()=>{if(!done){done=true;resolve();}}
      });
    });
  }
  PAGES['billing-overview'] = s => {
    const draw=async()=>{s.set(head('Billing overview')+'<div class="bill-loading">Loading your billing details…</div>');
      try{const r=await billGet('billing/overview');if(!r.ok)throw new Error(r.msg||'Could not load billing details.');
        const sub=r.subscription||{},t=r.totals||{},active=sub.status==='active'&&new Date(sub.expires_at)>new Date(),planStatus=active?'active':(sub.cancel_at_period_end?'ending_at_expiry':(r.subscription?'expired':'free')),productCount=items().length;
        s.set(head('Billing overview')+`
          <section class="bill-hero"><div class="bill-hero-top"><span>Current plan</span>${billStatus(planStatus)}</div><h2>${active?'Strap Premium':'Free plan'}</h2><p>${active?'Your Premium tools are available until '+billDate(sub.expires_at):'Upgrade whenever you are ready to unlock Premium.'}</p><div class="bill-hero-foot"><b>${active?billMoney(sub.amount):'₦0'}</b><small>${active?'per 30-day billing period':'No active subscription'}</small></div></section>
          ${billFailedAlert(t.failed)}
          ${billUsage(productCount,active)}
          <div class="bill-metrics"><article><small>Total paid</small><b>${billMoney(t.paid)}</b></article><article><small>Successful payments</small><b>${Number(t.successful||0).toLocaleString('en-NG')}</b></article><article><small>Pending</small><b>${Number(t.pending||0).toLocaleString('en-NG')}</b></article></div>
          <section class="bill-card"><div class="bill-card-head"><b>Subscription details</b><button data-fx="billing-subscription">Manage</button></div><div class="bill-kv"><span>Renewal type</span><b>Manual</b></div><div class="bill-kv"><span>Next renewal price</span><b>${billMoney(r.nextAmount)}</b></div><div class="bill-kv"><span>Expiry date</span><b>${active?billDate(sub.expires_at):'Not subscribed'}</b></div><div class="bill-kv"><span>Renewal setting</span><b>${sub.cancel_at_period_end?'Ends at expiry':'Not automatic'}</b></div></section>
          <div class="bill-actions"><button class="bill-primary" data-fx="billing-renew">${active?'Renew Premium':'Get Premium'}</button><button class="bill-secondary" data-fx="billing-history">Payment history</button></div>
          <section class="bill-links"><button data-fx="billing-receipts"><span>${ic('file-text',19,1.8)} Receipts and payments received</span>${ic('chevR',18,2)}</button><button data-fx="billing-results"><span>${ic('activity',19,1.8)} Payment results</span>${ic('chevR',18,2)}</button><button data-fx="billing-notifications"><span>${ic('mail',19,1.8)} Billing email notifications</span>${ic('chevR',18,2)}</button><button data-fx="billing-reconciliation"><span>${ic('refresh-cw',19,1.8)} Payment reconciliation</span>${ic('chevR',18,2)}</button></section>`);
      }catch(e){s.set(head('Billing overview')+billEmpty('Billing details unavailable',esc(e.message))+'<button class="bill-secondary" data-reload>Try again</button>');}};
    draw();s.el.addEventListener('click',e=>{if(e.target.closest('[data-reload]'))draw();});
  };
  PAGES['billing-history'] = s => {
    let status='all';
    const draw=async()=>{s.set(head('Payment history')+'<div class="bill-loading">Loading payments…</div>');
      const r=await billGet('billing/payments?limit=100'+(status==='all'?'':'&status='+encodeURIComponent(status)));
      if(!r.ok){s.set(head('Payment history')+billEmpty('Could not load payments',esc(r.msg||'Please try again.')));return;}
      const rows=r.payments||[];
      s.set(head('Payment history')+`<div class="bill-filter">${['all','successful','pending','failed'].map(x=>'<button data-filter="'+x+'" class="'+(status===x?'on':'')+'">'+(x==='all'?'All':x[0].toUpperCase()+x.slice(1))+'</button>').join('')}</div>
        <p class="bill-subtitle">Your Strap Premium charges, newest first.</p>${rows.length?'<div class="bill-list">'+rows.map(x=>'<button class="bill-payment" data-detail="'+esc(x.tx_ref)+'"><span class="bill-payment-icon">'+ic('receipt',19,1.8)+'</span><span class="bill-payment-main"><b>'+billMoney(x.amount)+'</b><small>'+billDate(x.created_at)+'</small><small class="bill-ref">'+esc(x.tx_ref)+'</small></span>'+billStatus(x.status)+ic('chevR',17,2)+'</button>').join('')+'</div>':billEmpty('No payments yet','Your Premium payment history will appear here.')}`);
    };
    draw();s.el.addEventListener('click',e=>{const f=e.target.closest('[data-filter]');if(f){status=f.dataset.filter;draw();return;}const b=e.target.closest('[data-detail]');if(b){PAGES['billing-receipts'](s,b.dataset.detail);}});
  };
  PAGES['billing-receipts'] = (s,selectedRef) => {
    const draw=async(ref)=>{s.set(head(ref?'Payment receipt':'Payments received')+'<div class="bill-loading">Loading payment records…</div>');
      if(ref){const r=await billGet('billing/payment?tx_ref='+encodeURIComponent(ref));if(!r.ok){s.set(head('Payment receipt')+billEmpty('Receipt unavailable',esc(r.msg||'')));return;}
        const x=r.payment;s.set(head('Payment receipt')+`<section class="bill-receipt"><div class="bill-receipt-brand"><b>STRAP</b><small>PAYMENT RECEIPT</small></div><div class="bill-receipt-total"><small>Amount paid</small><b>${billMoney(x.amount)}</b>${billStatus(x.status)}</div><div class="bill-kv"><span>Payment reference</span><b>${esc(x.tx_ref)}</b></div><div class="bill-kv"><span>Flutterwave transaction</span><b>${esc(x.transaction_id||'Not available')}</b></div><div class="bill-kv"><span>Payment date</span><b>${billDate(x.created_at)}</b></div><div class="bill-kv"><span>Verified</span><b>${billDate(x.verified_at)}</b></div><div class="bill-kv"><span>Currency</span><b>${esc(x.currency)}</b></div><p>Issued by Strap. Keep this receipt for your records.</p></section><button class="bill-primary" data-print>Print / Save receipt</button><button class="bill-secondary" data-back-list>All payments</button>`);
      }else{const r=await billGet('billing/payments?limit=100');if(!r.ok){s.set(head('Payments received')+billEmpty('Could not load receipts',esc(r.msg||'')));return;}const rows=(r.payments||[]).filter(x=>x.status==='successful');
        s.set(head('Payments received')+`<p class="bill-subtitle">Verified Premium payments and downloadable receipts.</p>${rows.length?'<div class="bill-list">'+rows.map(x=>'<button class="bill-payment" data-detail="'+esc(x.tx_ref)+'"><span class="bill-payment-icon">'+ic('file-check',19,1.8)+'</span><span class="bill-payment-main"><b>'+billMoney(x.amount)+'</b><small>'+billDate(x.verified_at||x.created_at)+'</small><small class="bill-ref">'+esc(x.tx_ref)+'</small></span>'+billStatus(x.status)+ic('chevR',17,2)+'</button>').join('')+'</div>':billEmpty('No verified payments yet','Receipts appear here after Flutterwave confirms a payment.')}`);
      }};
    draw(selectedRef);s.el.addEventListener('click',e=>{const b=e.target.closest('[data-detail]');if(b){draw(b.dataset.detail);return;}if(e.target.closest('[data-print]'))window.print();if(e.target.closest('[data-back-list]'))draw(null);});
  };
  PAGES['billing-results'] = s => {
    const draw=async()=>{s.set(head('Payment results')+'<div class="bill-loading">Checking payment status…</div>');const r=await billGet('billing/payments?limit=100');if(!r.ok){s.set(head('Payment results')+billEmpty('Results unavailable',esc(r.msg||'')));return;}
      const rows=r.payments||[];s.set(head('Payment results')+`<p class="bill-subtitle">Every checkout attempt and its latest recorded result.</p>${rows.length?'<div class="bill-list">'+rows.map(x=>'<article class="bill-result"><div><b>'+billMoney(x.amount)+'</b>'+billStatus(x.status)+'</div><small>'+billDate(x.created_at)+'</small><small class="bill-ref">'+esc(x.tx_ref)+'</small>'+(x.status==='pending'?'<button class="bill-text-btn" data-fx="billing-reconciliation">Resolve this payment</button>':(x.status==='failed'?'<button class="bill-text-btn" data-fx="billing-renew">Retry payment</button>':''))+'</article>').join('')+'</div>':billEmpty('No payment attempts','When you start a Premium checkout, its result will appear here.')}`);
    };draw();
  };
  PAGES['billing-renew'] = s => {
    const draw=async()=>{s.set(head('Renew Premium')+'<div class="bill-loading">Checking your subscription…</div>');const r=await billGet('billing/overview');if(!r.ok){s.set(head('Renew Premium')+billEmpty('Could not load subscription',esc(r.msg||'')));return;}
      const sub=r.subscription||{},active=sub.status==='active'&&new Date(sub.expires_at)>new Date();
      s.set(head('Renew Premium')+`<section class="bill-hero"><span>Strap Premium</span><h2>${billMoney(r.nextAmount)} <small>/ 30 days</small></h2><p>${active?'Your current access remains active. Renewing early adds 30 days to the existing expiry date.':'Restore full access to your Strap business tools.'}</p></section><div class="bill-card"><div class="bill-kv"><span>Payment</span><b>Flutterwave · Card</b></div><div class="bill-kv"><span>Currency</span><b>NGN</b></div><div class="bill-kv"><span>Billing</span><b>Manual renewal</b></div><div class="bill-kv"><span>Price sequence</span><b>₦4,500 first 3 successful payments, then ₦6,000</b></div></div><p class="bill-help">Pay by card through Flutterwave's secure hosted checkout. Strap does not store card numbers or CVV, and saved-card management is not currently available. You will be taken to Flutterwave's secure checkout. Strap never collects your card number or CVV.</p><button class="bill-primary" data-renew>Continue to secure payment</button>`);
    };draw();s.el.addEventListener('click',async e=>{const b=e.target.closest('[data-renew]');if(!b)return;b.disabled=true;b.textContent='Opening secure checkout…';try{await billLaunchRenew();}catch(err){toast(err.message||'Renewal could not be completed.');}finally{b.disabled=false;b.textContent='Continue to secure payment';}});
  };
  PAGES['billing-subscription'] = s => {
    const draw=async()=>{s.set(head('Subscription management')+'<div class="bill-loading">Loading subscription…</div>');const r=await billGet('billing/subscription');if(!r.ok){s.set(head('Subscription management')+billEmpty('Subscription unavailable',esc(r.msg||'')));return;}
      const sub=r.subscription;if(!sub){s.set(head('Subscription management')+billEmpty('No Premium subscription','Choose Premium when you are ready to upgrade.')+'<button class="bill-primary" data-fx="billing-renew">Get Premium</button>');return;}
      const active=sub.status==='active'&&new Date(sub.expires_at)>new Date();
      s.set(head('Subscription management')+`<section class="bill-card"><div class="bill-card-head"><b>Strap Premium</b>${billStatus(active?'active':'expired')}</div><div class="bill-kv"><span>Started</span><b>${billDate(sub.started_at)}</b></div><div class="bill-kv"><span>Expires</span><b>${billDate(sub.expires_at)}</b></div><div class="bill-kv"><span>Current price</span><b>${billMoney(sub.amount)} / 30 days</b></div><div class="bill-kv"><span>Renewal</span><b>Manual</b></div></section><section class="bill-card"><b>Renewal preference</b><p class="bill-help">Strap does not charge automatically. You stay in control and renew manually. You can request that your subscription ends when the current paid period expires.</p><div class="bill-toggle-row"><span><b>End subscription at expiry</b><small>${sub.cancel_at_period_end?'Your Premium access remains until the expiry date.':'Your plan remains active until its paid expiry date.'}</small></span><button class="bill-secondary" data-cancel="${sub.cancel_at_period_end?'false':'true'}">${sub.cancel_at_period_end?'Keep subscription':'End at expiry'}</button></div></section><button class="bill-primary" data-fx="billing-renew">Renew Premium</button>`);
    };draw();s.el.addEventListener('click',async e=>{const b=e.target.closest('[data-cancel]');if(!b)return;b.disabled=true;const r=await StrapAPI.call('PUT','billing/subscription',{cancel_at_period_end:b.dataset.cancel==='true'});if(!r.ok){toast(r.msg||'Could not update subscription.');b.disabled=false;return;}toast(b.dataset.cancel==='true'?'Subscription set to end at expiry.':'Subscription will remain active.');draw();});
  };
  PAGES['billing-notifications'] = s => {
    const draw=async()=>{s.set(head('Billing notifications')+'<div class="bill-loading">Loading email preferences…</div>');const r=await billGet('billing/notifications');if(!r.ok){s.set(head('Billing notifications')+billEmpty('Preferences unavailable',esc(r.msg||'')));return;}const p=r.preferences||{};
      s.set(head('Billing notifications')+`<section class="bill-card"><div class="bill-card-head"><b>Email delivery</b>${r.emailConfigured?'<span class="bill-status successful">Configured</span>':'<span class="bill-status pending">Setup required</span>'}</div><p class="bill-help">${r.emailConfigured?'Billing emails are routed through your configured EmailJS service.':'Connect EmailJS in Vercel to enable delivery. The settings below can still be saved.'}</p>${[['email_enabled','All billing emails'],['payment_success','Successful payment receipts'],['payment_failed','Payment failure alerts'],['renewal_reminders','Subscription expiry reminders']].map(([k,t])=>'<label class="bill-switch"><span>'+t+'</span><input type="checkbox" data-pref="'+k+'" '+(p[k]!==false?'checked':'')+'><i></i></label>').join('')}</section><section class="bill-card"><b>Renewal reminder timing</b><p class="bill-help">Choose when to receive expiry reminders.</p><div class="bill-checks">${[7,3,1,14].map(n=>'<label><input type="checkbox" data-day="'+n+'" '+((p.renewal_reminder_days||[7,3,1]).includes(n)?'checked':'')+'> '+n+' days before</label>').join('')}</div></section><button class="bill-primary" data-save-pref>Save email preferences</button><button class="bill-secondary" data-test-email ${r.emailConfigured?'':'disabled'}>Send test email to my account</button><div class="bill-help">EmailJS setup requires a Service ID, a template ID and a Public Key. Template variables are listed in the Strap setup notes.</div>${(r.recentEmails||[]).length?'<section class="bill-card"><b>Recent email activity</b>'+r.recentEmails.map(x=>'<div class="bill-kv"><span>'+esc(String(x.event_type).replace(/_/g,' '))+' · '+billDate(x.created_at)+'</span><b>'+billStatus(x.status)+'</b></div>').join('')+'</section>':''}`);
    };draw();s.el.addEventListener('click',async e=>{if(e.target.closest('[data-save-pref]')){const prefs={};s.el.querySelectorAll('[data-pref]').forEach(x=>prefs[x.dataset.pref]=x.checked);prefs.renewal_reminder_days=[...s.el.querySelectorAll('[data-day]:checked')].map(x=>Number(x.dataset.day));const r=await StrapAPI.call('PUT','billing/notifications',prefs);toast(r.ok?'Billing email preferences saved.':r.msg||'Could not save preferences.');return;}if(e.target.closest('[data-test-email]')){const b=e.target.closest('[data-test-email]');b.disabled=true;const r=await StrapAPI.call('POST','billing/email-test',{});toast(r.msg|| (r.ok?'Test email sent.':'Email could not be sent.'));b.disabled=false;}});
  };
  PAGES['billing-reconciliation'] = s => {
    const draw=async()=>{s.set(head('Payment reconciliation')+'<div class="bill-loading">Checking payment records…</div>');const r=await billGet('billing/reconcile');if(!r.ok){s.set(head('Payment reconciliation')+billEmpty('Could not load reconciliation',esc(r.msg||'')));return;}
      const rows=r.payments||[],pending=rows.filter(x=>x.status==='pending');
      s.set(head('Payment reconciliation')+`<section class="bill-card"><b>Resolve a payment</b><p class="bill-help">If Flutterwave shows that you paid but Strap has not updated your Premium access, enter the original Strap reference and Flutterwave transaction ID. Strap verifies directly with Flutterwave before changing your account.</p><label class="bill-field">Strap payment reference<input id="bill-ref" placeholder="STRAP-TEST-…"></label><label class="bill-field">Flutterwave transaction ID<input id="bill-txid" inputmode="numeric" placeholder="Numeric transaction ID"></label><button class="bill-primary" data-reconcile>Verify payment</button></section><h2 class="bill-section-title">Pending and recent attempts</h2>${rows.length?'<div class="bill-list">'+rows.map(x=>'<article class="bill-result"><div><b>'+billMoney(x.amount)+'</b>'+billStatus(x.status)+'</div><small>'+billDate(x.created_at)+'</small><small class="bill-ref">'+esc(x.tx_ref)+'</small>'+(x.status==='pending'?'<button class="bill-text-btn" data-fill="'+esc(x.tx_ref)+'">Use this reference</button>':'')+'</article>').join('')+'</div>':billEmpty('No payments to reconcile','Your payment attempts will appear here.')}${(r.events||[]).length?'<section class="bill-card"><b>Reconciliation activity</b>'+r.events.map(x=>'<div class="bill-kv"><span>'+esc(x.action)+' · '+billDate(x.created_at)+'</span><b>'+esc(x.outcome)+'</b></div>').join('')+'</section>':''}`);
    };draw();s.el.addEventListener('click',async e=>{const fill=e.target.closest('[data-fill]');if(fill){$('#bill-ref',s.el).value=fill.dataset.fill;$('#bill-txid',s.el).focus();return;}if(e.target.closest('[data-reconcile]')){const b=e.target.closest('[data-reconcile]'),ref=$('#bill-ref',s.el).value.trim(),id=$('#bill-txid',s.el).value.trim();if(!ref||!id){toast('Enter both payment reference and transaction ID.');return;}b.disabled=true;b.textContent='Verifying with Flutterwave…';const r=await StrapAPI.call('POST','billing/reconcile',{tx_ref:ref,transaction_id:id});toast(r.msg|| (r.ok?'Payment verified.':'Verification failed.'));if(r.ok){await refreshPlan();draw();}else{b.disabled=false;b.textContent='Verify payment';}}});
  };

  /* --- Premium plan comparison and checkout --- */
  PAGES.premium = s => {
    const perks = [
      'Unlimited product uploads and imports',
      'Point of sale, sales history and revenue reports',
      'Gift cards, collections and inventory tools',
      'Expenses, purchase tools and advanced reporting',
      'Online store and customer orders',
      'MCP connections and AI agent access',
      'Branches and advanced business tools'
    ];
    const draw = () => {
      const prem = S.plan === 'premium';
      const price = billMoney(S.checkoutAmount || 4500);
      const expiry = S.sub && S.sub.expiresAt ? billDate(S.sub.expiresAt) : 'your paid expiry date';
      s.set(head('Plans & billing') +
        '<div class="bill-intro">Choose the Strap plan that fits your business. Your account data stays yours if Premium access expires.</div>' +
        '<section class="bill-hero"><div class="bill-hero-top"><span>Your current plan</span>' + billStatus(prem ? 'active' : 'free') + '</div>' +
        '<h2>' + (prem ? 'Strap Premium is active' : 'Start with the essentials') + '</h2>' +
        '<p>' + (prem ? 'Your Premium access is verified by Strap and remains available until ' + esc(expiry) + '.' : 'You are currently using the Free plan. Upgrade when you are ready for the full Strap toolkit.') + '</p>' +
        '<div class="bill-hero-foot"><b>' + (prem ? 'Premium' : 'Free') + '</b><small>' + (prem ? 'Manual renewal · 30-day access' : 'No subscription required') + '</small></div></section>' +
        '<div class="bill-price-grid"><article class="bill-price-card"><h3>Free</h3><div class="bill-price">₦0</div><p>For getting started and managing a small catalogue.</p><ul><li>Up to 30 products</li><li>Core store workspace</li><li>Basic product management</li><li>No recurring charge</li></ul>' +
        (!prem ? '<button class="bill-secondary" type="button" disabled>Current plan</button>' : '') + '</article>' +
        '<article class="bill-price-card featured"><h3>Strap Premium</h3><div class="bill-price">' + price + '<small style="font:500 11px Inter,sans-serif;color:#d2d2c8"> / 30 days</small></div><p>Full business tools with secure payment through Flutterwave.</p><ul>' +
        perks.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
        (prem ? '<button class="bill-primary" type="button" data-fx="billing-subscription">Manage subscription</button>' : (S.checkoutReady ? '<button class="bill-primary" type="button" data-up>Continue to secure payment</button>' : '<button class="bill-primary" type="button" disabled>Checkout temporarily unavailable</button>')) +
        '</article></div>' +
        '<div class="bill-note"><b>Clear billing terms.</b> Premium is currently one 30-day plan with manual renewal. The introductory price applies to the first three successful payments; the standard price applies afterwards. Strap does not automatically charge your card or store your card number or CVV. Annual billing, prorated plan changes and saved-card management are not currently offered.</div>' +
        (prem ? '<div class="bill-actions"><button class="bill-secondary" data-fx="billing-overview">Open billing overview</button><button class="bill-primary" data-fx="billing-renew">Renew Premium</button></div>' : '<p class="bill-help">You will complete payment on Flutterwave’s secure checkout. Premium access is activated only after Strap verifies the transaction.</p>'));
    };
    draw();
    refreshPlan().then(draw);
    s.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-up]');
      if (!b) return;
      b.disabled = true;
      b.textContent = 'Opening secure checkout…';
      const result = await api.checkout();
      if (!result || !result.ok) {
        b.disabled = false;
        b.textContent = 'Try again';
      }
    });
  };

  /* ===== Server-authoritative plan state ===== */
  async function refreshPlan() {
    if (planPromise) return planPromise;
    const pending = (async () => {
      try {
        const r = await StrapAPI.call('GET', 'premium/status');
        if (!r || !r.ok || typeof r.active !== 'boolean') {
          throw new Error((r && r.msg) || 'Subscription status could not be verified.');
        }
        S.plan = r.active ? 'premium' : 'free';
        S.sub = r.active ? { expiresAt: r.expiresAt } : null;
        S.checkoutReady = !!r.checkoutReady;
        S.checkoutAmount = Number(r.amount) || Number(r.introductoryAmount) || 4500;
        planVerified = true;
        save();
      } catch (e) {
        // A temporary API/network failure must not silently downgrade a paid account.
        // Keep navigation usable; retry the authoritative check on the next page change.
        planVerified = false;
        console.warn('[Strap Premium] Plan status could not be verified; keeping page navigation available until it can be checked.', e);
      }
      return { verified: planVerified, plan: S.plan };
    })();
    planPromise = pending;
    try {
      return await pending;
    } finally {
      if (planPromise === pending) planPromise = null;
    }
  }
  Object.assign(api, {
    async getAccountStatus() { await sleep(900); return { status: S.account.status }; },
    async requestReview(r) { await sleep(1000); return { ok: true, ticket: 'RV-' + Math.floor(10000 + Math.random() * 89999) }; }
  });
  S.notifs = S.notifs || []; S.account = S.account || { status: 'active' }; S.reports = S.reports || []; S.lowSeen = S.lowSeen || [];
  try { const q = new URLSearchParams(location.search).get('account'); if (['active', 'review', 'suspended'].includes(q)) { S.account = { status: q, ticket: q === 'review' ? 'RV-48213' : '', at: Date.now() }; save(); } } catch (e) {}
    /* ===== notifications ===== */
  const NT = { sale: ['receipt', 'Sales'], stock: ['inbox', 'Stock'], security: ['shield', 'Security'], staff: ['users', 'Team'], plan: ['flash', 'Plan'], account: ['info', 'Account'], help: ['chat', 'Support'] };
  let bellEl = null;
  const unread = () => S.notifs.filter(n => !n.read).length;
  const refreshBell = () => { const d = bellEl && $('i', bellEl); if (d) d.style.display = unread() ? '' : 'none'; };
  function notify(type, title, body) { S.notifs.unshift({ id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type, title, body, at: Date.now(), read: false }); S.notifs = S.notifs.slice(0, 60); save(); refreshBell(); }
  const ago = t => { const m = Math.floor((Date.now() - t) / 6e4); return m < 1 ? 'Just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  PAGES.notifications = (s) => {
    let tab = 'all';
    const draw = () => {
      const all = S.notifs, list = tab === 'unread' ? all.filter(n => !n.read) : all, today = new Date().toDateString();
      const grp = (label, arr) => arr.length ? `<h2 class="pm-h">${label}</h2><div class="fx-card" style="padding:4px 16px">${arr.map(n => `<div class="fx-row" data-n="${n.id}" style="cursor:pointer;align-items:flex-start"><span class="st-ri">${ic(NT[n.type][0], 20, 1.8)}</span><div><b>${esc(n.title)}</b><small style="white-space:normal">${esc(n.body)}</small><small>${NT[n.type][1]} · ${ago(n.at)}</small></div>${n.read ? '' : '<i class="fx-dot"></i>'}</div>`).join('')}</div>` : '';
      const push = 'Notification' in window && Notification.permission === 'default' && !S.pushAsked ? `<div class="fx-card"><b>Turn on alerts</b><small>Get low-stock and security alerts even when Strap is closed.</small><button class="fx-btn sm" style="margin-top:10px" data-push>Enable alerts</button></div>` : '';
      s.set(head('Notifications', true, unread() ? '<button class="fx-btn sm o" data-all>Mark all read</button>' : '') + push + `<div class="fx-chips"><button class="fx-chip${tab === 'all' ? ' on' : ''}" data-tab="all">All</button><button class="fx-chip${tab === 'unread' ? ' on' : ''}" data-tab="unread">Unread${unread() ? ' (' + unread() + ')' : ''}</button></div>` +
        (list.length ? grp('Today', list.filter(n => new Date(n.at).toDateString() === today)) + grp('Earlier', list.filter(n => new Date(n.at).toDateString() !== today)) : `<div class="pg-empty">${U.illus('orders')}<h2>${tab === 'unread' ? 'Nothing unread' : 'You’re all caught up'}</h2><p>Sales, stock, security and account updates will show up here.</p></div>`));
    };
    draw();
    s.el.addEventListener('click', async e => {
      const t = e.target, tb = t.closest('[data-tab]'), n = t.closest('[data-n]');
      if (tb) { tab = tb.dataset.tab; draw(); }
      if (t.closest('[data-all]')) { S.notifs.forEach(x => x.read = true); save(); refreshBell(); draw(); }
      if (n) { const x = S.notifs.find(y => y.id === n.dataset.n); if (x && !x.read) { x.read = true; save(); refreshBell(); draw(); } }
      if (t.closest('[data-push]')) { S.pushAsked = true; save(); try { await Notification.requestPermission(); } catch (er) {} draw(); }
    });
  };
  function seedNotifs() {
    if (!S.seeded) { S.seeded = true; notify('account', 'Welcome to Strap', 'Your workspace is ready. Add your first product to get started.'); }
    if (StrapStore.prefs.lowStock) items().filter(p => p.tracked && (+p.qty || 0) <= 5 && !S.lowSeen.includes(p.id)).forEach(p => { S.lowSeen.push(p.id); notify('stock', p.title + ' is running low', `${p.qty || 0} left in ${branch().name}.`); });
    if (planBefore === 'free' && S.plan === 'premium' && S.seeded) notify('plan', 'Premium is active', 'Your higher limits are switched on.');
    save();
  }

  /* ===== account status: suspended / under review / request a review ===== */
  function accountGate() {
    $$('.fx-gate').forEach(n => n.remove()); if (S.account.status === 'active') return;
    const g = document.createElement('section'); g.className = 'fx-gate'; document.body.appendChild(g); document.body.classList.add('pm-open');
    const set = h => { g.innerHTML = `<div class="fx-in">${h}</div>`; };
    const badge = (i, tone) => `<div class="fx-badge ${tone}">${ic(i, 38, 1.8)}</div>`;
    const acts = `<button class="fx-btn o" data-sup>Contact support</button><button class="fx-btn o" data-out>Sign out</button>`;
    const suspended = () => set(badge('lock', 'red') + `<h2 class="fx-h" style="text-align:center">Your account is suspended</h2><p class="fx-p" style="text-align:center">${esc(S.account.reason || 'We noticed unusual activity, so we paused your account to keep your store safe.')}</p>
      <div class="fx-card"><b>What this means</b><ul class="fx-ul"><li>You can’t sell or change products for now</li><li>Your data, products and sales are safe</li><li>If this is a mistake, ask us to review it</li></ul></div><button class="fx-btn" data-req>Request a review</button>${acts}`);
    const review = () => set(badge('clock', 'amber') + `<h2 class="fx-h" style="text-align:center">Your account is under review</h2><p class="fx-p" style="text-align:center">Our team is looking at your request. This usually takes 1 to 2 business days, and we’ll notify you by email.</p>
      <div class="fx-card"><div class="fx-tl"><div class="done"><i></i><div><b>Request sent</b><small>${S.account.at ? new Date(S.account.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</small></div></div><div class="now"><i></i><div><b>In review</b><small>Reference ${esc(S.account.ticket || 'RV-00000')}</small></div></div><div><i></i><div><b>Decision</b><small>We’ll email you the outcome</small></div></div></div></div><button class="fx-btn" data-chk>Check status</button>${acts}`);
    const form = () => { const A = { agree: false }; set(`<button class="pm-round" data-b aria-label="Back" style="margin-top:14px">${ic('back', 22, 2.2)}</button><h2 class="fx-h">Request a review</h2><p class="fx-p">Tell us what happened. A clear explanation helps us decide faster.</p>
      <label class="pm-fl"><span>What should we know?</span><textarea id="rv-t" rows="4" maxlength="600" placeholder="Explain why you think the suspension is a mistake"></textarea></label>
      <label class="pm-fl"><span>Contact email</span><input id="rv-e" type="email" value="${esc(ctx.store.email || S.backup.email || '')}" placeholder="name@example.com" autocomplete="off"></label>
      <label class="pm-fl"><span>Phone (optional)</span><input id="rv-p" type="tel" value="${esc(S.backup.phone || '')}" placeholder="+234 801 234 5678" autocomplete="off"></label>
      ${chk(false, 'I confirm the details above are true.', 'ag')}<button class="fx-btn" data-send disabled>Send request</button>`); };
    g.addEventListener('click', async e => {
      const t = e.target, c = toggleChk(t); if (c) { A2.agree = c.classList.contains('on'); const b = $('[data-send]', g); if (b) b.disabled = !A2.agree; return; }
      if (t.closest('[data-req]')) form(); if (t.closest('[data-b]')) suspended();
      if (t.closest('[data-sup]')) toast('Support is being updated. Please check back soon.');
      if (t.closest('[data-out]')) ctx.signOut();
      if (t.closest('[data-chk]')) { let r; await cover('Checking your status', async () => { r = await api.getAccountStatus(); S.account.status = r.status; save(); render(); }); if (r.status === 'review') toast('Still under review. We’ll notify you.'); }
      if (t.closest('[data-send]')) {
        const tx = $('#rv-t', g), em = $('#rv-e', g); if (tx.value.trim().length < 15) return bad(tx.parentNode); if (!/^\S+@\S+\.\S+$/.test(em.value.trim())) return bad(em.parentNode);
        await cover('Sending your request', async () => { const r = await api.requestReview({ note: tx.value.trim(), email: em.value.trim(), phone: $('#rv-p', g).value.trim() }); S.account = { status: 'review', ticket: r.ticket, at: Date.now() }; save(); notify('account', 'Review requested', `We’re reviewing your account. Reference ${r.ticket}.`); render(); }); K.fx('ok');
      }
    });
    const A2 = { agree: false };
    const render = () => { if (S.account.status === 'active') { g.remove(); document.body.classList.remove('pm-open'); toast('Your account is active again'); return; } S.account.status === 'suspended' ? suspended() : review(); };
    render();
  }

  /* ===== Strap AI import (write, snap a photo, or upload a file) ===== */
  const parseText = txt => txt.split(/\n|;/).map(l => l.trim()).filter(Boolean).map(l => {
    const price = (l.match(/(?:[₦$€£]|ngn|usd)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b(?!\s*(?:pcs|x|units))/gi) || []).map(x => x), q = l.match(/(?:x|qty|quantity|stock)\s*[:\-]?\s*(\d+)|(\d+)\s*(?:pcs|pieces|units|x)\b/i);
    const nums = [...l.matchAll(/(\d[\d,]*(?:\.\d+)?)(k)?/gi)].filter(m => !q || !q[0].includes(m[1]) || m[1] !== (q[1] || q[2])); const pr = nums.length ? (+nums[nums.length - 1][1].replace(/,/g, '')) * (nums[nums.length - 1][2] ? 1000 : 1) : 0;
    const title = l.replace(/[₦$€£]/g, ' ').replace(/(?:x|qty|quantity|stock)\s*[:\-]?\s*\d+|\d+\s*(?:pcs|pieces|units)\b/ig, ' ').replace(/(?:ngn|usd)?\s*\d[\d,]*(?:\.\d+)?k?/ig, ' ').replace(/[-–|,:@]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { title: title || l, price: pr, qty: q ? +(q[1] || q[2]) : 1 }; }).filter(p => p.title);
  function useImport() { if (S.imports.m !== mkey()) S.imports = { m: mkey(), n: 0 }; if (S.imports.n >= lim().imports) { gate(`The free plan includes ${LIM.free.imports} imports a month. Upgrade for unlimited imports.`); return false; } S.imports.n++; save(); return true; }
  function aiImport(onAdd) {
    if (S.imports.m === mkey() && S.imports.n >= lim().imports) return gate(`The free plan includes ${LIM.free.imports} imports a month. Upgrade for unlimited imports.`);
    cover('Opening Strap AI', () => screen('', s => {
      let mode = 'write', list = [];
      const intro = () => s.set(head('Add with Strap AI') + `<span class="fx-ai">${ic('flash', 14, 2.2)} Powered by Strap</span><h2 class="fx-h">Add products the easy way</h2><p class="fx-p">Type them in, snap a photo of a price list, or upload a file. Strap reads it and builds your products.</p>
        <div class="fx-chips">${[['write', 'Write'], ['photo', 'Take photo'], ['file', 'Upload file']].map(([k, l]) => `<button class="fx-chip${mode === k ? ' on' : ''}" data-m="${k}">${l}</button>`).join('')}</div>
        ${mode === 'write' ? `<textarea class="fx-t" id="tx" placeholder="One product per line, for example:\nAnkara tote bag - 9800 - 12 pcs\nLinen pillow, 7600, qty 5"></textarea><button class="fx-btn" data-read>Read my products</button>` :
          `<label class="fx-drop" style="display:block">${ic(mode === 'photo' ? 'image' : 'upload', 30, 1.8)}<br>${mode === 'photo' ? 'Tap to take or choose a photo' : 'Tap to upload a .csv, .txt or PDF'}<input id="fl" type="file" hidden accept="${mode === 'photo' ? 'image/*' : '.csv,.txt,.pdf,image/*'}" ${mode === 'photo' ? 'capture="environment"' : ''}></label>`}`);
      const review = () => s.set(head('Review', false) + `<h2 class="fx-h">${list.length} product${list.length === 1 ? '' : 's'} found</h2><p class="fx-p">Remove anything that’s wrong, then import.</p><div class="fx-card">${list.map((p, i) => `<div class="fx-row"><div><b>${esc(p.title)}</b><small>${ctx.money(p.price)} · ${p.qty} in stock</small></div><button class="pg-x" data-rm="${i}">${ic('trash', 18, 1.8)}</button></div>`).join('')}</div><button class="fx-btn" data-imp ${list.length ? '' : 'disabled'}>Import ${list.length}</button><button class="fx-btn o" data-x>Cancel</button>`);
      async function run(src) {
        s.set(`<div class="fx-soon"><div class="fx-spin"><i></i><b></b><span></span></div><h2>Strap is reading</h2><p class="fx-p">Finding your products…</p></div>`);
        let r = null; try { r = await api.aiExtract(src); } catch (e) {}
        if (!r && src.text) r = parseText(src.text); if (!r || !r.length) { s.set(head('Strap AI') + `<div class="fx-soon"><h2>We couldn’t find products</h2><p class="fx-p">${src.file && !src.text ? 'Reading photos and PDFs is rolling out soon. For now, type your products or upload a .csv or .txt file.' : 'Try one product per line with its price and quantity.'}</p><button class="fx-btn" data-again>Try again</button></div>`); return; } list = r; review();
      }
      intro();
      s.el.addEventListener('click', e => {
        const t = e.target, m = t.closest('[data-m]'); if (m) { mode = m.dataset.m; intro(); }
        if (t.closest('[data-read]')) { const v = $('#tx', s.el).value.trim(); v ? run({ text: v }) : bad($('#tx', s.el)); }
        if (t.closest('[data-again]')) intro();
        const rm = t.closest('[data-rm]'); if (rm) { list.splice(+rm.dataset.rm, 1); review(); }
        if (t.closest('[data-imp]')) { const room = lim().products - items().length; if (list.length > room) return gate(`The free plan allows up to 30 products. You can add ${Math.max(0, room)} more.`); if (!useImport()) return;
          const out = list.map((p, i) => ({ id: 'p' + Date.now().toString(36) + i, title: p.title, price: p.price, qty: p.qty, status: 'active', tracked: true })); K.fx('ok'); s.close('Adding products').then(() => { onAdd(out); toast(`${out.length} product${out.length === 1 ? '' : 's'} added`); }); }
      });
      s.el.addEventListener('change', async e => { const f = e.target.files && e.target.files[0]; if (!f) return; const txt = /text|csv|plain/.test(f.type) || /\.(csv|txt)$/i.test(f.name) ? await f.text() : ''; run({ file: f, text: txt }); });
    }));
  }

  /* ===== product limits + per-branch persistence ===== */
  function wrapProducts() {
    const P = StrapProducts.api, cap = n => { if (items().length + n > lim().products) { gate(`The free plan allows up to 30 products. Upgrade to Premium for unlimited products.`); throw new Error('limit'); } };
    P.getProducts = async () => { await sleep(350); return items(); };
    const sv = P.saveProduct, dl = P.deleteProduct, ic1 = P.importCsv, is1 = P.importFromSite;
    P.saveProduct = async p => { const l = items(); const isNew = !p.id || !l.some(x => x.id === p.id); if (isNew) cap(1); const r = await sv(p); const i = l.findIndex(x => x.id === r.id); i < 0 ? l.unshift(r) : (l[i] = r); setItems(l); return r; };
    P.deleteProduct = async id => { const r = await dl(id); setItems(items().filter(x => x.id !== id)); return r; };
    const imp = fn => async (...a) => { if (!useImport()) throw new Error('limit'); const r = await fn(...a); cap(r.length); setItems([...r, ...items()]); return r; };
    P.importCsv = imp(ic1); P.importFromSite = imp(is1);
  }
  wrapProducts();

  /* ===== dashboard: real numbers, get-started cards ===== */
  const stats = () => { const l = items(), ds = StrapStore.dayStats(), rev = StrapStore.earned(1), y = StrapStore.earned(2) - rev;
    const hourly = Array.from({ length: 12 }, (_, i) => StrapStore.state.payments.filter(p => StrapStore.dayKey(p.ts) === StrapStore.dayKey() && Math.floor(new Date(p.ts).getHours() / 2) <= i).reduce((a, p) => a + p.amount, 0));
    return { revenue: rev, deltaPct: y > 0 ? Math.round((rev - y) / y * 1000) / 10 : null, hourly, sold: ds.items, orders: ds.count, customers: 0, stock: l.reduce((a, p) => a + (+p.qty || 0), 0), products: l.length, low: l.filter(p => p.tracked && (+p.qty || 0) <= 5).length }; };
  const GS = [['product', 'Add your first product', 'Start your catalogue by hand or by import.', 'tag', () => items().length > 0, 'addp'], ['pin', 'Set your activity PIN', 'Protect closing sales and important actions.', 'shield', () => StrapStore.hasPin(), 'pin'],
    ['sale', 'Make your first sale', 'Open the sales desk and ring up a sale.', 'receipt', () => StrapStore.state.sales.length > 0, 'new-sale'], ['staff', 'Add a staff member', 'Give your team their own login.', 'users', () => S.staff.length > 0, 'staff'],
    ['2fa', 'Turn on 2FA', 'Add a second step to keep your account safe.', 'lock', () => S.twofa.on, 'security']];
  function mountHome(c, home) {
    ctx = c; bellEl = $('.bell', c.dashEl || document); const anchor = $('.sec', home), box = document.createElement('div'); box.className = 'fx-gs in'; box.style.setProperty('--i', 2);
    const draw = () => { const todo = GS.filter(g => !g[4]() && !S.dismissed.includes(g[0])); box.innerHTML = todo.length ? `<h2 class="sec" style="margin:6px 0">Get started<small>${GS.filter(g => g[4]()).length} of ${GS.length} done</small></h2><div class="fx-bar"><i style="width:${GS.filter(g => g[4]()).length / GS.length * 100}%"></i></div>` +
      todo.slice(0, 3).map(g => `<article class="fx-card" data-gs="${g[5]}"><span class="ic">${ic(g[3], 24, 1.8)}</span><div><b>${g[1]}</b><small>${g[2]}</small></div><button class="x" data-dis="${g[0]}" aria-label="Dismiss">${ic('close', 16, 2.2)}</button></article>`).join('') : ''; };
    seedNotifs(); refreshBell(); accountGate(); draw(); anchor.before(box); home.addEventListener('click', e => {
      const d = e.target.closest('[data-dis]'); if (d) { e.stopPropagation(); S.dismissed.push(d.dataset.dis); save(); return draw(); }
      const g = e.target.closest('[data-gs]'); if (!g) return; const k = g.dataset.gs;
      if (k === 'addp') { c.go('products'); setTimeout(() => ctx.products() && ctx.products().openAdd(), 500); } else if (k === 'pin' || k === 'new-sale') c.go(k === 'pin' ? 'settings' : k); else open(k);
    });
  }
  function bind(prod) { if (prod && prod.onChange) prod.onChange(() => setItems(prod.items())); }

  // Staff management is paused while the feature is rebuilt.
  const FLOWS = { branchsw: branchFlow, branches: branchFlow };
  function open(key) {
    if (key === 'premium') { cover('Opening Premium', () => screen('', PAGES.premium)); return true; }
    if (['branches','branchsw','transfers'].includes(key) && S.plan !== 'premium') { gate('This business feature is included with Strap Premium.'); return true; }
    if (FLOWS[key]) { FLOWS[key](); return true; }
    if (!PAGES[key]) return false;
    cover(key === 'delete' ? 'One moment' : 'Opening', () => screen('', PAGES[key])); return true;
  }
  document.addEventListener('click', e => { const f = e.target.closest('[data-fx]'); if (f && ctx) { e.stopPropagation(); open(f.dataset.fx); } }, true);

  return { api, state: S, waitForPlan: () => planVerified ? Promise.resolve({ verified: true, plan: S.plan }) : refreshPlan(), notify, showPendingPremiumWelcome, has: k => !!PAGES[k] || !!FLOWS[k], branchName: () => branch().name, open, mountHome, bind, stats, aiImport, items, setItems, init: c => { ctx = c; refreshPlan().then(async () => { const qs=new URLSearchParams(location.search); if(qs.get('payment')==='flutterwave') { const tx_ref=qs.get('tx_ref')||'', transaction_id=qs.get('transaction_id')||''; if(tx_ref&&/^\\d+$/.test(transaction_id)) { try { const v=await StrapAPI.call('POST','premium/verify',{tx_ref,transaction_id}); await refreshPlan(); if(v.ok&&S.plan==='premium') { toast('Payment verified. Strap Premium is now active.'); showPremiumActivationSuccess(); } else toast(v.msg||'Payment is not confirmed yet.'); } catch(err) { console.error('[Strap Premium] Return verification failed:',err); toast('Payment verification is still pending. Check Billing before trying again.'); } } else toast('Flutterwave returned without a transaction ID. If you were charged, contact support before retrying.'); for(const k of ['payment','status','tx_ref','transaction_id']) qs.delete(k); history.replaceState(history.state,'',location.pathname+(qs.toString()?'?'+qs.toString():'')+location.hash); } }); } };
})();
