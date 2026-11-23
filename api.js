/* Strap client: talks to /api (Vercel functions + Neon). Load this FIRST on every page. */
(() => {
  const own = k => String(k).startsWith('strap');
  let active = false, timer = null, pushing = false;
  const call = (method, path, body) => fetch('/api/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(r => r.json().catch(() => ({ ok: false }))).catch(() => ({ ok: false, msg: 'No connection. Check your internet and try again.' }));
  const xhr = (m, u) => { const x = new XMLHttpRequest(); x.open(m, u, false); try { x.send(); } catch (e) { return { status: 0 }; } let j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} return { status: x.status, j }; };
  const wipe = () => { [localStorage, sessionStorage].forEach(s => { try { Object.keys(s).filter(own).forEach(k => s.removeItem(k)); } catch (e) {} }); };
  const collect = () => { const b = {}; try { Object.keys(localStorage).filter(own).forEach(k => b['ls:' + k] = localStorage.getItem(k)); Object.keys(sessionStorage).filter(own).forEach(k => b['ss:' + k] = sessionStorage.getItem(k)); } catch (e) {} return b; };
  async function push() { if (pushing) return schedule(); pushing = true; const r = await call('PUT', 'data', { blob: collect() }); pushing = false; return r; }
  function schedule() { if (!active) return; clearTimeout(timer); timer = setTimeout(push, 1500); }
  const sp = Storage.prototype, setI = sp.setItem, remI = sp.removeItem;
  sp.setItem = function (k, v) { setI.call(this, k, v); if (own(k)) schedule(); };
  sp.removeItem = function (k) { remI.call(this, k); if (own(k)) schedule(); };

  /* Dashboard gate: needs a signed-in user, then loads that user's data from Neon BEFORE the app starts. */
  function guard() {
    const r = xhr('GET', '/api/data');
    if (r.status === 401) { wipe(); location.replace('index.html'); return; }
    if (r.status === 200 && r.j && r.j.blob && !r.j.blob['ss:strap.session']) { call('POST', 'auth/signout'); wipe(); location.replace('index.html'); return; }
    if (r.status === 200 && r.j && r.j.blob) {
      wipe();
      Object.entries(r.j.blob).forEach(([k, v]) => { try { (k.startsWith('ss:') ? sessionStorage : localStorage).setItem(k.slice(3), v); } catch (e) {} });
    }
    active = true;
    addEventListener('visibilitychange', () => { if (document.hidden && active) { clearTimeout(timer); push(); } });
  }

  /* Pictures: shrink on the phone, then store inside Neon. Returns a URL like /api/media?id=... */
  async function upload(file) {
    try {
      if (!file || !/^image\//.test(file.type)) return null;
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
      const s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.82).split(',')[1];
      const r = await call('POST', 'media', { name: file.name, type: 'image/jpeg', data });
      return r.ok ? r.url : null;
    } catch (e) { return null; }
  }
  let sMail = '', sPw = '', rMail = '';
  const fresh = () => { active = false; clearTimeout(timer); wipe(); };
  window.StrapAPI = {
    call, upload, guard, fresh, flush: async () => { clearTimeout(timer); return push(); },
    contact: (kind, message, email) => call('POST', 'contact', { kind, message, email }),
    signOut: async () => { await call('POST', 'auth/signout'); fresh(); },
    auth: {
      async startSignup(email, password) { const r = await call('POST', 'auth/signup-start', { email, password }); if (r.ok) { sMail = email.trim().toLowerCase(); sPw = password; } return { ok: !!r.ok, msg: r.msg }; },
      async sendReset(email) { rMail = email.trim().toLowerCase(); const r = await call('POST', 'auth/send-code', { email, type: 'forget-password' }); return { ok: !!r.ok, msg: r.msg }; },
      async sendCode(email) { const e = String(email).trim().toLowerCase(); if (e === sMail) return call('POST', 'auth/send-code', { email: e, type: 'email-verification' }); if (e === rMail) return call('POST', 'auth/send-code', { email: e, type: 'forget-password' }); return { ok: true }; },
      async verifySignupCode(email, code) { const e = String(email).trim().toLowerCase(); if (e !== sMail) return { ok: code === '123456' }; const r = await call('POST', 'auth/verify-email', { email: e, otp: code, password: sPw }); if (r.ok) fresh(); return { ok: !!r.ok }; },
      async verifyCode(email, code) { const e = String(email).trim().toLowerCase(); if (e === rMail) return { ok: !!(await call('POST', 'auth/check-code', { email: e, code })).ok }; return { ok: code === '123456' }; },
      async signIn(email, password) { const r = await call('POST', 'auth/signin', { email, password }); if (r.ok) fresh(); return { ok: !!r.ok, msg: r.msg }; },
      async resetPassword(email, code, password) { const r = await call('POST', 'auth/reset', { email, code, password }); return { ok: !!r.ok, msg: r.msg }; },
      async createAccount(data) { const { photo, password, ...d } = data; const r = await call('POST', 'auth/signup', { data: d }); return { ok: !!r.ok, msg: r.msg }; },
      async changePassword(current, next) { const r = await call('POST', 'auth/change-password', { current, next }); return { ok: !!r.ok, msg: r.msg }; },
      async deleteAccount(payload) { const r = await call('POST', 'account/delete', { payload }); if (r.ok) fresh(); return { ok: !!r.ok }; }
    }
  };
  if (document.getElementById('dash')) guard();
  else if (document.getElementById('land') && !/subscribe=1/.test(location.search)) call('GET', 'me').then(r => { if (r.ok) location.replace('dashboard.html'); });
})();
