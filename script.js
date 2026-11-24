(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ===== Real authentication: use the same-origin Neon backend from api.js ===== */
  const auth = window.StrapAPI && window.StrapAPI.auth;
  const authUnavailable = () => ({ ok: false, msg: 'The authentication service is not available. Please refresh and try again.' });
  const api = {
    signIn: (email, password) => auth && auth.signIn ? auth.signIn(email, password) : Promise.resolve(authUnavailable()),
    startSignup: (email, password) => auth && auth.startSignup ? auth.startSignup(email, password) : Promise.resolve(authUnavailable()),
    sendCode: email => auth && auth.sendCode ? auth.sendCode(email) : Promise.resolve(authUnavailable()),
    sendReset: email => auth && auth.sendReset ? auth.sendReset(email) : Promise.resolve(authUnavailable()),
    verifyCode: (email, code) => auth && auth.verifyCode ? auth.verifyCode(email, code) : Promise.resolve(authUnavailable()),
    verifySignupCode: (email, code) => auth && auth.verifySignupCode ? auth.verifySignupCode(email, code) : Promise.resolve(authUnavailable()),
    verifyLoginCode: (email, code) => auth && auth.verifyLoginCode ? auth.verifyLoginCode(email, code) : Promise.resolve(authUnavailable()),
    resetPassword: (email, code, password) => auth && auth.resetPassword ? auth.resetPassword(email, code, password) : Promise.resolve(authUnavailable()),
    createAccount: data => auth && auth.createAccount ? auth.createAccount(data) : Promise.resolve(authUnavailable()),
    requestReview: (email,message) => auth && auth.requestReview ? auth.requestReview(email,message) : Promise.resolve(authUnavailable()),
  };

  /* ===== helpers ===== */
  const toast = msg => {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove('on'), 2600);
  };
  const emailError = v => !v.trim() ? 'Enter your email address.' :
    !emailRe.test(v.trim()) ? 'That email doesn’t look right. Use a format like name@example.com.' : '';
  /* ===== SIGN-UP / BUSINESS SETUP FLOW ===== */
  const flow = $('#flow'), land = $('#land');
  const D = {}; let hist = [], tmr, tmr2;
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const ARROW = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
  const COUNTRIES = [['Nigeria','NGN'],['Ghana','GHS'],['Kenya','KES'],['South Africa','ZAR'],['Egypt','EGP'],['Uganda','UGX'],['Tanzania','TZS'],['Rwanda','RWF'],['Senegal','XOF'],['Côte d’Ivoire','XOF'],['Cameroon','XAF'],['United Kingdom','GBP'],['United States','USD'],['Canada','CAD'],['United Arab Emirates','AED'],['India','INR']];
  const CC = Object.fromEntries(COUNTRIES), COUNTRY_OPTS = [...COUNTRIES.map(c => c[0]), 'Other'];
  const CURS = [['NGN','Nigerian naira (NGN)'],['GHS','Ghanaian cedi (GHS)'],['KES','Kenyan shilling (KES)'],['ZAR','South African rand (ZAR)'],['EGP','Egyptian pound (EGP)'],['UGX','Ugandan shilling (UGX)'],['TZS','Tanzanian shilling (TZS)'],['RWF','Rwandan franc (RWF)'],['XOF','West African CFA franc (XOF)'],['XAF','Central African CFA franc (XAF)'],['GBP','British pound (GBP)'],['USD','US dollar (USD)'],['EUR','Euro (EUR)'],['CAD','Canadian dollar (CAD)'],['AED','UAE dirham (AED)'],['INR','Indian rupee (INR)']];
  const first = () => (D.name || '').split(/\s+/)[0];
  const sel = m => v => v ? '' : m;
  const txt = (m, n = 2) => v => v.trim().length >= n ? '' : m;
  const score = p => (p.length >= 8) + (/[a-z]/i.test(p) && /\d/.test(p)) + (p.length >= 12) + (/[^A-Za-z0-9]/.test(p) && /[A-Z]/.test(p));
  const pwErr = p => p.length < 8 ? 'Use at least 8 characters.' : (!/[a-z]/i.test(p) || !/\d/.test(p)) ? 'Include a letter and a number.' : '';
  const dobErr = v => {
    if (!v) return 'Enter your date of birth.';
    const [y, m, d] = v.split('-').map(Number), n = new Date();
    let a = n.getFullYear() - y; if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d)) a--;
    return y < 1900 || a < 0 ? 'Enter a valid date.' : a < 18 ? 'You must be 18 or older.' : '';
  };
  const urlErr = v => /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(v.trim()) ? '' : 'Enter a valid website, like www.mybusiness.com.';

  const STEPS = {
    /* ---- log in: same look and motion as creating an account ---- */
    lemail: { t: 'Welcome back', s: 'Enter your email address to sign in.', f: [{ key: 'lemail', type: 'email', ph: 'example@email.com', ac: 'email', v: emailError, link: ['Forgot password?', 'fgemail'] }], btn: 'Continue',
      act: async () => ({ ok: true }),
      note: 'New to Strap? <a href="#" data-flow="email">Create an account</a>', next: 'lpass' },
    lpass: { t: 'Enter your password', s: () => `Signing in as ${D.lemail}`, f: [{ key: 'lpw', type: 'password', ph: 'Password', ac: 'current-password', v: v => v ? '' : 'Enter your password.' }], btn: 'Sign in',
      act: async () => { const r = await api.signIn(D.lemail, D.lpw); if (!r.ok) r.msg = r.msg || 'Email or password is incorrect.'; return r; }, next: 'lok' },
    'login-code': { k: 'code', len: 6, wait: 30, mail: 'lemail', verify: (m, c) => api.verifyLoginCode(m, c), t: 'Verify your email', s: () => `We sent a 6-digit code to ${D.lemail}.`, next: 'lok' },
    lok: { k: 'success', noBack: 1, t: 'You’re signed in', s: 'Welcome back to Strap.', label: 'Open dashboard', auto: 2200, go: () => { location.href = 'dashboard.html'; } },
    suspended: { k: 'suspended', noBack: 1, t: 'Account temporarily suspended', s: 'We noticed unusual activity on this account. Your data is safe. Request a review and our team will check it.' },
    fgemail: { t: 'Reset your password', s: 'Enter your account email and we’ll send you a 6 digit code.', f: [{ key: 'fgemail', type: 'email', ph: 'example@email.com', ac: 'email', def: () => D.lemail, v: emailError }], btn: 'Send code',
      act: () => api.sendReset(D.fgemail), next: 'fgcode' },
    fgcode: { k: 'code', len: 6, wait: 30, mail: 'fgemail', save: 'fgcode', verify: (m, c) => api.verifyCode(m, c), t: 'Enter the code', s: () => `We sent a 6 digit code to ${D.fgemail}.`, next: 'fgnew' },
    fgnew: { t: 'Create a new password', s: 'Use at least 8 characters with a letter and a number.', f: [
      { key: 'fgpw', type: 'password', ph: 'New password', ac: 'new-password', meter: 1, v: pwErr },
      { key: 'fgpw2', type: 'password', ph: 'Confirm password', ac: 'new-password', v: v => v === D.fgpw ? '' : 'Passwords don’t match.' }], btn: 'Update password',
      act: () => api.resetPassword(D.fgemail, D.fgcode, D.fgpw), next: 'fgdone' },
    fgdone: { k: 'success', noBack: 1, t: 'Password updated', s: 'You can now sign in with your new password.', label: 'Back to sign in', go: () => { hist = []; D.fgpw = D.fgpw2 = D.lpw = ''; go('lemail'); } },
    email: { t: 'Enter your email address', s: 'We’ll send you a verification code', f: [{ key: 'email', type: 'email', ph: 'example@email.com', ac: 'email', v: emailError }], btn: 'Continue',
      act: () => api.checkEmail(D.email),
      note: 'Already have an account? <a href="#" data-flow="lemail">Sign in</a><br>By continuing, you agree to receive transactional messaging about your account. <a href="#" data-legal="privacy">Privacy Policy</a> &amp; <a href="#" data-legal="terms">Terms</a>', next: 'password' },
    password: { t: 'Set Password', s: 'You’ll verify your email next', f: [{ key: 'password', type: 'password', ph: 'Create a password', ac: 'new-password', meter: 1, v: pwErr }], btn: 'Continue',
      act: () => api.startSignup(D.email, D.password), next: 'code' },
    code: { k: 'code', t: 'Code sent to your Email', s: 'If you can’t find the mail, check spam before you resend the code.', next: 'verified' },
    verified: { k: 'verified', mid: 1, noBack: 1, t: 'Verified', s: 'Ready to set up your business?', next: 'name' },
    name: { t: 'What’s your name?', noBack: 1, f: [{ key: 'name', ph: 'Your full name', ac: 'name', v: v => v.trim().split(/\s+/).filter(Boolean).length < 2 ? 'Enter your first and last name.' : '' }], btn: 'Continue', next: 'dob' },
    dob: { t: 'When were you born?', s: 'You must be 18 or older to set up a business.', f: [{ key: 'dob', type: 'date', ph: '', ac: 'bday', v: dobErr }], btn: 'Continue', next: 'country' },
    country: { t: 'Which country are you in?', f: [{ key: 'country', opts: COUNTRY_OPTS, ph: 'Select', v: sel('Select your country.'), sync: v => { D.currency = CC[v] || 'USD'; } }], btn: 'Continue', next: 'currency' },
    currency: { t: 'Which currency do you sell in?', s: 'Your prices and reports will show in this currency.', f: [{ key: 'currency', opts: CURS, ph: 'Select', v: sel('Select a currency.') }], btn: 'Continue', next: 'bizname' },
    bizname: { t: 'What’s your business name?', f: [{ key: 'bizname', ph: () => (first() ? first() + '’s Business' : 'Your business name'), v: txt('Enter your business name.') }], btn: 'Continue', next: 'registered' },
    registered: { k: 'choice', t: 'Is this a registered business?', key: 'registered', o: [['Yes', 'yes'], ['No', 'no']],
      note: 'If your business is registered you might be asked to enter your business registration number', next: v => v === 'yes' ? 'regno' : 'mode' },
    regno: { t: 'Business registration number', s: 'You can skip this and add it later.', f: [{ key: 'regno', ph: 'e.g. RC1234567', v: txt('Enter a valid registration number.', 4) }], btn: 'Continue', skip: 'mode', next: 'mode' },
    mode: { t: 'Select business mode?', s: 'Choosing the right business mode helps us give you the best experience for your business on Strap.',
      f: [{ key: 'mode', opts: ['Shop or supermarket', 'Food service', 'Fashion or electronics', 'Online store only', 'Growing brand', 'Other'], ph: 'Select', v: sel('Select a business mode.') }], btn: 'Continue', next: 'branches' },
    branches: { t: 'How many branches do you run?', f: [{ key: 'branches', opts: ['1 (single shop)', '2 to 5', '6 to 20', 'More than 20'], ph: 'Select', v: sel('Select an option.') }], btn: 'Continue', next: 'location' },
    location: { t: 'Where is your business located?', f: [
      { key: 'bcountry', opts: COUNTRY_OPTS, ph: 'Country', def: () => D.country, v: sel('Select a country.') },
      { key: 'state', ph: 'State or region', ac: 'address-level1', v: txt('Enter a state or region.') },
      { key: 'city', ph: 'City or town', ac: 'address-level2', v: txt('Enter a city or town.') }], btn: 'Continue', next: 'address' },
    address: { t: 'What’s the full business address?', s: 'This is where customers and deliveries can find you.', f: [
      { key: 'street', ph: 'Street address', ac: 'street-address', v: txt('Enter the street address.', 4) },
      { key: 'landmark', ph: 'Landmark or nearby area (optional)' },
      { key: 'postcode', ph: 'Postal code (optional)', ac: 'postal-code' }], btn: 'Continue', next: 'hasSite' },
    hasSite: { k: 'choice', t: 'Does your business have a website?', key: 'hasSite', o: [['Yes', 'yes'], ['No', 'no']], next: v => v === 'yes' ? 'siteUrl' : 'siteLater' },
    siteUrl: { t: 'What’s your website?', f: [{ key: 'site', type: 'url', ph: 'www.mybusiness.com', v: urlErr }], btn: 'Continue', next: 'photo' },
    siteLater: { k: 'choice', t: 'Want Strap to get you one later?', s: 'We can help you set up an online storefront when you’re ready.', key: 'wantSite', o: [['Yes, set one up later', 'yes'], ['No, not now', 'no']], next: 'photo' },
    photo: { k: 'image', t: 'Set business profile picture', next: 'done' },
    done: { k: 'final', noBack: 1, mid: 1, t: 'You’re all set' }
  };

  let rid = 0;
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function startFlow(first = 'email') {
    hist = [];
    land.hidden = true; flow.hidden = false; go(first);
  }
  function closeFlow() {
    clearInterval(tmr); hist = []; rid++;
    const fin = () => { flow.hidden = true; flow.replaceChildren(); land.hidden = false; };
    const old = flow.firstElementChild;
    if (old && !reduced()) { old.classList.add('leave', 'bk'); setTimeout(fin, 190); } else fin();
  }
  function go(id) { if (id === 'verified') hist = []; hist.push(id); render(id, 1); }
  function back() { hist.pop(); hist.length ? render(hist[hist.length - 1], -1) : SUB ? (location.href = 'dashboard.html') : closeFlow(); }
  const pill = (label, cls = '') => { const b = el('button', 'pill ' + cls, label); b.type = 'button'; return b; };
  const nxt = st => typeof st.next === 'function' ? st.next(D) : st.next;
  const lock = (b, on, l) => { if (on) { b.dataset.l = b.textContent; b.textContent = l || 'Please wait…'; } else if (b.dataset.l) b.textContent = b.dataset.l; b.disabled = on; };

  // old page slides/fades out, then the new page is built and its rows rise in one by one
  function render(id, dir = 1) {
    clearInterval(tmr); clearTimeout(tmr2);
    const my = ++rid, old = flow.firstElementChild;
    if (old && !flow.hidden && !reduced()) {
      old.classList.add('leave', dir < 0 ? 'bk' : 'fwd');
      setTimeout(() => { if (my === rid) build(id, dir); }, 190);
    } else build(id, dir);
  }
  function build(id, dir) {
    const st = STEPS[id], box = el('form', 'step enter' + (dir < 0 ? ' bk' : '') + (st.mid ? ' mid' : '') + (st.k === 'success' ? ' okw' : ''));
    box.noValidate = true; box.addEventListener('submit', e => e.preventDefault());
    const top = el('div', 'top');
    if (st.noBack) top.append(el('div', 'back-ic'));
    else { const b = el('button', 'back-ic'); b.type = 'button'; b.innerHTML = ARROW; b.setAttribute('aria-label', 'Back'); b.onclick = back; top.append(b); }
    if (st.skipTop) { const s = el('button', 'skip-top', 'Skip'); s.type = 'button'; s.onclick = () => { if (st.onSkip) st.onSkip(); go(st.skipTop); }; top.append(s); }
    box.append(top);
    const body = el('div', 'body'), foot = el('div', 'foot');
    body.append(el('h2', 'st', st.t));
    if (st.s) body.append(el('p', 'ss', typeof st.s === 'function' ? st.s() : st.s));
    ({ code: kCode, verified: kVerified, choice: kChoice, image: kImage, success: kSuccess, final: kFinal, suspended: kSuspended }[st.k] || kForm)(st, body, foot);
    box.append(body, el('div', 'sp'), foot);
    $$('.st,.ss,.fg,.acc,.paycard,.avatar,.tl,.okm,.foot > *,.skip-top', box).forEach((n, k) => { n.classList.add('rise'); n.style.setProperty('--i', Math.min(k, 8)); });
    flow.replaceChildren(box); window.scrollTo(0, 0);
    const i = box.querySelector('input:not([type=file])'); if (i && !st.k) i.focus();
  }

  function kForm(st, body, foot) {
    const wrap = el('div', 'fields'), rows = [], gerr = el('p', 'ferr'); gerr.setAttribute('role', 'alert');
    const btn = pill(st.btn); btn.type = 'submit';
    st.f.forEach(f => {
      const g = el('div', 'fg'), err = el('p', 'ferr'); err.setAttribute('role', 'alert'); let i;
      if (f.opts) {
        i = el('select', 'fi fs'); i.dataset.dd = f.key; i.append(new Option(f.ph || 'Select', ''));
        f.opts.forEach(o => i.append(Array.isArray(o) ? new Option(o[1], o[0]) : new Option(o, o)));
      } else {
        i = el('input', 'fi'); i.type = f.type || 'text'; if (f.type === 'date') i.dataset.dd = f.key;
        i.placeholder = typeof f.ph === 'function' ? f.ph() : f.ph;
        if (f.max) i.maxLength = f.max;
        if (f.mode) i.inputMode = f.mode;
        if (f.type === 'date') i.max = new Date().toISOString().slice(0, 10);
        if (f.digits) i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, f.max || 6); });
        if (f.ac) i.autocomplete = f.ac;
      }
      i.setAttribute('aria-label', f.ph && typeof f.ph === 'string' ? f.ph : f.key);
      const pre = D[f.key] || (f.def && f.def()); if (pre) i.value = pre;
      g.append(i);
      if (f.type === 'password') {
        i.classList.add('pwi'); const e = el('button', 'eye2', 'Show'); e.type = 'button';
        e.onclick = () => { const h = i.type === 'password'; i.type = h ? 'text' : 'password'; e.textContent = h ? 'Hide' : 'Show'; }; g.append(e);
        if (f.meter) { const m = el('div', 'meter'); m.append(el('i'), el('i'), el('i'), el('i')); g.append(m); f.m = m; }
      }
      g.append(err);
      if (f.link) { const a = el('button', 'flink', f.link[0]); a.type = 'button'; a.onclick = () => go(f.link[1]); g.append(a); }
      wrap.append(g); rows.push([f, i, err]);
    });
    const invalid = () => rows.some(([f, i]) => f.v && f.v(i.value));
    const upd = () => { btn.disabled = invalid(); };
    rows.forEach(([f, i, err]) => {
      const on = () => {
        D[f.key] = i.value.trim(); if (f.sync) f.sync(i.value); err.textContent = ''; gerr.textContent = ''; i.removeAttribute('aria-invalid');
        if (f.m) f.m.dataset.s = i.value ? Math.max(1, score(i.value)) : 0; upd();
      };
      i.addEventListener('input', on); i.addEventListener('change', on);
      i.addEventListener('blur', () => { const m = f.v ? f.v(i.value) : ''; if (i.value.trim() && m) { err.textContent = m; i.setAttribute('aria-invalid', 'true'); } });
    });
    upd(); body.append(wrap, gerr);
    btn.onclick = async () => {
      if (btn.disabled) return;
      rows.forEach(([f, i]) => D[f.key] = i.value.trim());
      if (st.act) {
        lock(btn, true);
        try {
          const r = await st.act();
          lock(btn, false);
          if (!r || !r.ok) {
            if (r && r.code === 'ACCOUNT_SUSPENDED') { D.reviewEmail = D.lemail || D.email || ''; go('suspended'); return; }
            if (r && r.code === 'STAFF_EMAIL') { D.lemail=String(D.email||'').trim().toLowerCase(); D.staffFound=true; D.staffPin=''; toast('This is a staff login. Enter your staff PIN.'); go('staff-pin'); return; }
            if (r && r.code === 'ACCOUNT_EXISTS') {
              D.lemail = String(D.email || '').trim().toLowerCase(); D.lpw = '';
              toast('Account already exists. Enter your login password.');
              go('lpass'); return;
            }
            if (r && r.code === 'EMAIL_VERIFICATION_REQUIRED') {
              toast('Email verification required. Enter the code we sent.');
              go('login-code'); return;
            }
            gerr.textContent = (r && r.msg) || 'We could not complete that step. Please try again.'; return;
          }
        } catch (error) {
          console.error('Strap form action failed:', error);
          lock(btn, false);
          gerr.textContent = 'We could not connect to Strap. Check your internet and try again.';
          return;
        }
      }
      go(nxt(st));
    };
    foot.append(btn);
    if (st.skip) { const s = pill('Skip for now', 'alt'); s.onclick = () => go(st.skip); foot.append(s); }
    if (st.note) { const n = el('p', 'note'); n.innerHTML = st.note; $$('a[data-flow]', n).forEach(a => a.onclick = e => { e.preventDefault(); hist = []; go(a.dataset.flow); }); foot.append(n); }
  }

  function kChoice(st, body, foot) {
    st.o.forEach(([label, val]) => { const b = pill(label); b.onclick = () => { D[st.key] = val; go(nxt2(st, val)); }; foot.append(b); });
    if (st.note) { const n = el('p', 'note', st.note); foot.append(n); }
  }
  const nxt2 = (st, v) => typeof st.next === 'function' ? st.next(v) : st.next;

  function kVerified(st, body, foot) { const b = pill('Get Started'); b.onclick = () => go(st.next); foot.append(b); }

  function kCode(st, body, foot) {
    const N = st.len || 6, mail = () => D[st.mail || 'email'];
    const g = el('div', 'fg fields'), i = el('input', 'fi code8'), err = el('p', 'ferr'); err.setAttribute('role', 'alert');
    i.inputMode = 'numeric'; i.maxLength = N; i.autocomplete = 'one-time-code'; i.placeholder = `Enter the ${N} digit code`; i.setAttribute('aria-label', `${N} digit code`);
    const tl = el('div', 'tl'), note = el('span'), rs = el('button', '', 'Resend'); rs.type = 'button';
    tl.append(note, rs); g.append(i, err); body.append(g, tl);
    const btn = pill('Verify'); btn.type = 'submit'; btn.disabled = true; foot.append(btn);
    const start = () => {
      let s = st.wait || 180; rs.disabled = true; clearInterval(tmr);
      const tick = () => { note.textContent = s > 0 ? `Try again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}s` : 'Didn’t get the code?'; if (s-- <= 0) { clearInterval(tmr); rs.disabled = false; } };
      tick(); tmr = setInterval(tick, 1000);
    };
    start();
    rs.onclick = async () => { rs.disabled = true; const r = await api.sendCode(mail()); if (!r.ok) { err.textContent = r.msg || 'We could not send a new code. Please try again.'; rs.disabled = false; return; } i.value = ''; btn.disabled = true; err.textContent = ''; start(); toast('New code sent'); };
    i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, N); err.textContent = ''; btn.disabled = i.value.length < N; if (i.value.length === N) btn.click(); });
    btn.onclick = async () => {
      if (btn.disabled) return; lock(btn, true, 'Verifying…');
      const r = await (st.verify || api.verifySignupCode)(mail(), i.value); lock(btn, false);
      if (!r.ok) { err.textContent = r.msg || 'That code isn’t right or has expired. Check it and try again.'; i.value = ''; btn.disabled = true; i.focus(); return; }
      if (st.save) D[st.save] = i.value;
      clearInterval(tmr); go(st.next);
    };
    i.focus();
  }

  function kImage(st, body, foot) {
    const av = el('div', 'avatar'); av.innerHTML = '<svg viewBox="0 0 200 200" fill="none" stroke="#0a0a0a" stroke-width="3" aria-hidden="true"><circle cx="100" cy="100" r="96"/><circle cx="100" cy="80" r="30"/><path d="M42 168c8-30 32-46 58-46s50 16 58 46"/></svg>';
    const err = el('p', 'ferr'); err.style.textAlign = 'center';
    const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    const btn = pill('Choose Media'), alt = pill('Skip for now', 'alt');
    let chosen = false;
    btn.onclick = () => chosen ? go(st.next) : file.click();
    alt.onclick = () => { D.photo = null; go(st.next); };
    file.onchange = () => {
      const f = file.files[0]; if (!f) return;
      if (!f.type.startsWith('image/')) { err.textContent = 'Choose an image file (JPG, PNG or WebP).'; return; }
      if (f.size > 5 * 1024 * 1024) { err.textContent = 'That image is over 5 MB. Choose a smaller one.'; return; }
      err.textContent = ''; D.photo = f; chosen = true;
      const img = el('img'); img.alt = 'Business profile picture preview'; img.src = URL.createObjectURL(f); av.replaceChildren(img);
      btn.textContent = 'Continue'; alt.textContent = 'Choose another'; alt.onclick = () => file.click();
    };
    body.append(av, err); foot.append(btn, alt, file);
  }

  // animated success: ring and tick draw themselves, sparks burst, then we move on (button or automatically)
  function kSuccess(st, body, foot) {
    if (st.before) st.before();
    const m = el('div', 'okm');
    m.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="okr" cx="60" cy="60" r="54" pathLength="1"/><circle class="okd" cx="60" cy="60" r="44"/><path class="okt" d="M41 62l14 14 26-31" pathLength="1"/></svg><i></i><i></i><i></i>';
    body.prepend(m);
    const b = pill(st.label || 'Continue'); let done = false; const run = () => { if (done) return; done = true; clearTimeout(tmr2); st.go(); };
    b.onclick = run; foot.append(b);
    clearTimeout(tmr2); if (st.auto) tmr2 = setTimeout(run, reduced() ? 600 : st.auto);
  }
  function kSuspended(st, body, foot) {
    const art=el('div','suspend-art');
    art.innerHTML='<svg viewBox="0 0 260 220" role="img" aria-label="A protected account illustration" fill="none"><circle cx="130" cy="105" r="83" fill="#e6f53a"/><rect x="76" y="42" width="108" height="132" rx="18" fill="#fff" stroke="#0a0a0a" stroke-width="4"/><path d="M98 42V30a32 32 0 0 1 64 0v12" stroke="#0a0a0a" stroke-width="8" stroke-linecap="round"/><rect x="94" y="80" width="72" height="60" rx="12" fill="#0a0a0a"/><path d="M130 96v17m0 10v1" stroke="#e6f53a" stroke-width="7" stroke-linecap="round"/><circle cx="202" cy="151" r="28" fill="#fff" stroke="#0a0a0a" stroke-width="4"/><path d="M202 137v17m0 8v1" stroke="#0a0a0a" stroke-width="4" stroke-linecap="round"/></svg>';
    const email=el('p','note',D.reviewEmail||D.lemail||'');
    const msg=el('textarea','suspend-message'); msg.rows=3; msg.maxLength=1500; msg.placeholder='Add a short message for the review team (optional).';
    const err=el('p','ferr'); err.setAttribute('role','alert');
    const btn=pill('Request account review');
    btn.onclick=async()=>{ lock(btn,true,'Submitting…'); const r=await api.requestReview(D.reviewEmail||D.lemail||'',msg.value); lock(btn,false); if(!r.ok){err.textContent=r.msg||'We could not submit your request. Please try again.';return;} err.textContent=''; msg.value=''; btn.textContent='Review request submitted'; btn.disabled=true; email.textContent='Your request is with the Strap review team. We’ll follow up by email.'; };
    const back=pill('Back to sign in','alt'); back.onclick=()=>{hist=[];D.lpw='';go('lemail');};
    body.append(art,el('p','ss','Sign-in is paused while we protect your account. You can request a review below.'),email,msg,err);
    foot.append(btn,back);
  }

  function kFinal(st, body, foot) {
    body.append(el('p', 'ss', `${D.bizname || 'Your business'} is ready to set up on Strap.`));
    const b = pill('Open my workspace');
    b.onclick = () => launch(b);
    foot.append(b);
  }

  /* ===== hand off to the dashboard page (dashboard.html) ===== */
  const loader = $('#loader');
  function readPhoto(f) {
    return new Promise(res => {
      if (!f) return res(null);
      StrapAPI.upload(f).then(u => { if (u) return res(u); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
    });
  }
  async function launch(btn) {
    lock(btn, true, 'Setting up…');
    document.body.classList.add('lock'); loader.hidden = false; void loader.offsetWidth; loader.classList.add('on');
    const t0 = Date.now(); let acc;
    try { acc = await api.createAccount(D); } catch (e) { acc = { ok: false }; }
    if (!acc.ok) {
      loader.classList.remove('on'); setTimeout(() => { loader.hidden = true; document.body.classList.remove('lock'); }, 300);
      lock(btn, false); toast('We couldn’t finish setup. Try again.'); return;
    }
    await sleep(Math.max(0, 900 - (Date.now() - t0)));
    const { photo, password, lpw, fgpw, fgpw2, fgcode, ...rest } = D;
    const photoUrl = await readPhoto(photo);
    try { sessionStorage.setItem('strap.session', JSON.stringify({ ...rest, photoUrl })); }
    catch (e) { try { sessionStorage.setItem('strap.session', JSON.stringify(rest)); } catch (e2) {} }
    await StrapAPI.flush();
    location.href = 'dashboard.html';
  }

  Object.assign(api, StrapAPI.auth); // real backend

  /* ===== landing: create account or log in ===== */
  $('#l-signup').addEventListener('click', () => startFlow('email'));
  $('#l-login').addEventListener('click', () => startFlow('lemail'));

  /* Legal and support pages */
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-legal]'); if (!a) return;
    e.preventDefault();
    const dest = a.dataset.legal === 'support' ? 'support.html' : 'legal.html?doc=' + encodeURIComponent(a.dataset.legal);
    location.href = dest;
  });
})();
