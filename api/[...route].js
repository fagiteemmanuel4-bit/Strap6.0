/* Strap backend (one Vercel function). Neon Auth handles accounts, passwords and the emailed codes.
   Neon Postgres stores app data + images. Only the "pg" package is needed. */
const { Pool } = require('pg');
const crypto = require('crypto');
const E = process.env;
const pool = global.__sp || (global.__sp = new Pool({ connectionString: E.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } }));
const q = async (t, p) => (await pool.query(t, p)).rows;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const APP = E.APP_NAME || 'Strap';
const lower = s => String(s || '').trim().toLowerCase();

/* ---- talk to Neon Auth (managed Better Auth) ---- */
const origin = req => (E.SITE_URL || 'https://strap60.vercel.app').replace(/\/$/, '');
async function na(req, method, path, body, cookie) {
  const base = String(E.NEON_AUTH_BASE_URL || '').replace(/\/$/, '');
  if (!base) return { ok: false, status: 500, j: { message: 'NEON_AUTH_BASE_URL is not set.' }, cookies: [] };
  try {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Origin: origin(req), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const raw = await r.text(); let j = null; try { j = JSON.parse(raw); } catch (e) {} if (!r.ok) console.log('NEON AUTH', method, path, r.status, raw.slice(0, 300));
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    return { ok: r.ok, status: r.status, j, raw, cookies: sc.map(c => c.split(';')[0]).filter(c => /=./.test(c)) };
  } catch (e) { return { ok: false, status: 502, j: { message: 'Could not reach Neon Auth.' }, cookies: [] }; }
}
const errMsg = r => (r.j && (r.j.message || (r.j.error && r.j.error.message))) || ('Error ' + r.status + ': ' + String(r.raw || '').slice(0, 120));
const mine = (res, cookies) => { if (cookies.length) res.setHeader('Set-Cookie', `strap_auth=${Buffer.from(cookies.join('; ')).toString('base64url')}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`); };
const clearMine = res => res.setHeader('Set-Cookie', 'strap_auth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
const upCookie = req => { const m = /(?:^|;\s*)strap_auth=([\w-]+)/.exec(req.headers.cookie || ''); return m ? Buffer.from(m[1], 'base64url').toString() : ''; };
const cache = global.__sc || (global.__sc = new Map());

/* Persistent login throttling: counters live in Neon so they survive Vercel cold starts. */
function loginLimitKeys(req, email) {
  const forwarded = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded && forwarded.length <= 80 ? forwarded : 'unknown';
  return [
    { key: sha('strap-login-email:' + lower(email)), threshold: 5 },
    { key: sha('strap-login-ip:' + ip), threshold: 20 }
  ];
}
async function loginIsBlocked(keys) {
  const hashes = keys.map(x => x.key);
  const rows = await q('select key_hash, blocked_until from auth_login_limits where key_hash = any($1::text[]) and blocked_until > now()', [hashes]);
  return rows.length > 0;
}
async function recordLoginFailures(keys) {
  for (const item of keys) {
    await q(`insert into auth_login_limits(key_hash, failures, window_started_at, blocked_until, updated_at)
      values($1, 1, now(), null, now())
      on conflict(key_hash) do update set
        failures = case when auth_login_limits.window_started_at < now() - interval '24 hours' then 1 else auth_login_limits.failures + 1 end,
        window_started_at = case when auth_login_limits.window_started_at < now() - interval '24 hours' then now() else auth_login_limits.window_started_at end,
        blocked_until = case
          when (case when auth_login_limits.window_started_at < now() - interval '24 hours' then 1 else auth_login_limits.failures + 1 end) >= $2 + 7 then now() + interval '24 hours'
          when (case when auth_login_limits.window_started_at < now() - interval '24 hours' then 1 else auth_login_limits.failures + 1 end) >= $2 + 3 then now() + interval '1 hour'
          when (case when auth_login_limits.window_started_at < now() - interval '24 hours' then 1 else auth_login_limits.failures + 1 end) >= $2 then now() + interval '15 minutes'
          else null end,
        updated_at = now()`, [item.key, item.threshold]);
  }
}
async function clearLoginFailures(email) {
  await q('delete from auth_login_limits where key_hash = $1', [sha('strap-login-email:' + lower(email))]);
}
async function me(req) {
  const c = upCookie(req); if (!c) return null;
  const k = sha(c), hit = cache.get(k); if (hit && hit.t > Date.now()) return hit.u;
  const r = await na(req, 'GET', '/get-session', null, c);
  const u = r.ok && r.j && r.j.user && r.j.user.emailVerified !== false ? { id: String(r.j.user.id), email: lower(r.j.user.email), name: r.j.user.name } : null;
  if (u) { await q('insert into app_users(id,email) values($1,$2) on conflict(id) do nothing', [u.id, u.email]); cache.set(k, { u, t: Date.now() + 30000 }); }
  return u;
}

/* ---- optional extra emails (welcome + support) through Resend. Neon Auth itself sends the codes. ---- */
async function mail(to, subject, html) {
  if (!E.RESEND_API_KEY || !E.MAIL_FROM) return false;
  try { const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + E.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: E.MAIL_FROM, to, subject, html, reply_to: E.SUPPORT_EMAIL || undefined }) }); return r.ok; } catch (e) { return false; }
}
const wrap = (t, b) => `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px"><h2>${t}</h2>${b}<p style="color:#888;font-size:12px;margin-top:28px">${esc(APP)}</p></div>`;

const H = {};
H['health'] = async (req) => {
  const out = { db: false, auth: false };
  try { await q('select 1'); out.db = true; } catch (e) { out.dbError = e.message; }
  const r = await na(req, 'GET', '/get-session'); out.auth = r.status < 500 && r.status !== 404; out.authStatus = r.status;
  return [200, out];
};

/* sign up step 1: Neon Auth sends the verification OTP automatically because Verify at Sign-up is enabled with the OTP method. */
H['auth/signup-start'] = async (req) => {
  const email = lower(req.body.email), password = String(req.body.password || '');
  if (!emailRe.test(email) || password.length < 8) return [400, { ok: false, msg: 'Check your email and password.' }];

  // Check Neon Managed Auth directly. Never attempt a sign-in with the password
  // supplied on the create-account screen to detect an existing identity.
  const existing = await q('select 1 from neon_auth."user" where lower(email)=$1 limit 1', [email]);
  if (existing.length) return [409, { ok: false, code: 'ACCOUNT_EXISTS', msg: 'An account with this email already exists. Sign in with your password.' }];

  const r = await na(req, 'POST', '/sign-up/email', { email, password, name: email.split('@')[0] });
  if (!r.ok) {
    // Covers a signup race: another request may have created the same email
    // after the existence check but before Neon processed this request.
    const appeared = await q('select 1 from neon_auth."user" where lower(email)=$1 limit 1', [email]).catch(() => []);
    if (appeared.length || /already exists|user exists|email.*taken/i.test(errMsg(r))) {
      return [409, { ok: false, code: 'ACCOUNT_EXISTS', msg: 'An account with this email already exists. Sign in with your password.' }];
    }
    return [r.status === 429 ? 429 : r.status >= 500 ? 502 : 400, { ok: false, msg: errMsg(r) }];
  }
  // Managed Auth sends the initial verification code during /sign-up/email.
  return [200, { ok: true }];
};
H['auth/send-code'] = async (req) => {
  const email = lower(req.body.email), type = req.body.type === 'forget-password' ? 'forget-password' : 'email-verification';
  if (!emailRe.test(email)) return [400, { ok: false, msg: 'Enter a valid email.' }];
  const r = type === 'forget-password' ? await na(req, 'POST', '/forget-password/email-otp', { email }) : await na(req, 'POST', '/email-otp/send-verification-otp', { email, type });
  return r.ok ? [200, { ok: true }] : [r.status === 429 ? 429 : 400, { ok: false, msg: errMsg(r) }];
};
/* sign up step 2: verify the code, which signs the user in */
H['auth/verify-email'] = async (req, res) => {
  const email = lower(req.body.email), otp = String(req.body.otp || '').trim();
  if (!emailRe.test(email) || !/^\d{6}$/.test(otp)) return [400, { ok: false, msg: 'Enter the complete 6-digit verification code.' }];
  const r = await na(req, 'POST', '/email-otp/verify-email', { email, otp });
  if (!r.ok) return [r.status === 429 ? 429 : r.status >= 500 ? 502 : 400, { ok: false, msg: errMsg(r) }];
  let cookies = r.cookies;
  if (!cookies.length && req.body.password) { const s = await na(req, 'POST', '/sign-in/email', { email, password: String(req.body.password) }); if (s.ok) cookies = s.cookies; }
  if (!cookies.length) return [200, { ok: false, msg: 'Verified, but sign in failed. Please sign in.' }];
  mine(res, cookies); return [200, { ok: true }];
};
/* forgot password: check the code without using it up (if Neon supports it) */
H['auth/check-code'] = async (req) => {
  const r = await na(req, 'POST', '/email-otp/check-verification-otp', { email: lower(req.body.email), type: 'forget-password', otp: String(req.body.code || '').trim() });
  if (r.status === 404) return [200, { ok: true }]; // not available: the code is checked when the new password is saved
  return [200, { ok: r.ok }];
};
H['auth/reset'] = async (req) => {
  const pw = String(req.body.password || ''); if (pw.length < 8) return [400, { ok: false, msg: 'Use at least 8 characters.' }];
  const r = await na(req, 'POST', '/email-otp/reset-password', { email: lower(req.body.email), otp: String(req.body.code || '').trim(), password: pw });
  return r.ok ? [200, { ok: true }] : [400, { ok: false, msg: 'That code is wrong or expired.' }];
};
H['auth/signin'] = async (req, res) => {
  const email = lower(req.body.email), password = String(req.body.password || '');
  if (!emailRe.test(email) || !password) return [400, { ok: false, msg: 'Enter your email and password.' }];
  const keys = loginLimitKeys(req, email);
  if (await loginIsBlocked(keys)) return [429, { ok: false, msg: 'Too many incorrect attempts. Please wait before trying again.' }];
  const r = await na(req, 'POST', '/sign-in/email', { email, password });
  if (r.status === 403) {
    const resend = await na(req, 'POST', '/email-otp/send-verification-otp', { email, type: 'email-verification' });
    return resend.ok
      ? [403, { ok: false, code: 'EMAIL_VERIFICATION_REQUIRED', msg: 'Your email is not verified. We sent you a new 6-digit code.' }]
      : [resend.status === 429 ? 429 : 502, { ok: false, msg: 'Your email needs verification, but we could not send a new code. ' + errMsg(resend) }];
  }
  if (!r.ok || !r.cookies.length) {
    if (r.status === 401 || r.status === 400 || r.status === 403) await recordLoginFailures(keys);
    return [r.status === 429 ? 429 : 401, { ok: false, msg: r.status === 429 ? 'Too many attempts. Try again later.' : 'Email or password is incorrect.' }];
  }
  await clearLoginFailures(email);
  mine(res, r.cookies); return [200, { ok: true }];
};
H['auth/signout'] = async (req, res) => { const c = upCookie(req); if (c) await na(req, 'POST', '/sign-out', {}, c); clearMine(res); return [200, { ok: true }]; };
H['auth/change-password'] = async (req, res, user) => {
  if (!user) return [401, { ok: false }];
  if (String(req.body.next || '').length < 8) return [400, { ok: false, msg: 'Use at least 8 characters.' }];
  const r = await na(req, 'POST', '/change-password', { currentPassword: String(req.body.current || ''), newPassword: req.body.next, revokeOtherSessions: false }, upCookie(req));
  return r.ok ? [200, { ok: true }] : [400, { ok: false, msg: 'Your current password is not right.' }];
};
H['me'] = async (req, res, user) => {
  if (!user) return [401, { ok: false }];
  const p = (await q('select profile from app_users where id=$1 and deleted_at is null', [user.id]))[0];
  return p && p.profile && p.profile.bizname ? [200, { ok: true, email: user.email }] : [401, { ok: false }];
};
/* sign up step 3: save the business details the user entered, then welcome email */
H['auth/signup'] = async (req, res, user) => {
  if (!user) return [401, { ok: false, msg: 'Please verify your email first.' }];
  const { password, photo, lpw, fgpw, fgpw2, fgcode, ...profile } = req.body.data || {};
  const first = (await q('select (profile ? \'bizname\') as done from app_users where id=$1', [user.id]))[0];
  await q('update app_users set profile=$2, deleted_at=null where id=$1', [user.id, profile]);
  await q('insert into user_data(user_id,blob) values($1,$2) on conflict(user_id) do nothing', [user.id, { 'ss:strap.session': JSON.stringify(profile) }]);
  if (profile.name) na(req, 'POST', '/update-user', { name: String(profile.name).slice(0, 80) }, upCookie(req));
  if (!first || !first.done) await mail(user.email, `Welcome to ${APP}`, wrap(`Welcome, ${esc(String(profile.name || '').split(' ')[0] || 'there')}!`, `<p>Your ${esc(APP)} account for <b>${esc(profile.bizname || 'your business')}</b> is ready.</p><p>Need help? Reply to this email.</p>`));
  return [200, { ok: true }];
};

/* ---- app data: the whole dashboard state as one JSON per user ---- */
H['data'] = async (req, res, user) => {
  if (!user) return [401, { ok: false }];
  if (req.method === 'PUT') {
    const b = req.body.blob; if (!b || typeof b !== 'object') return [400, { ok: false }];
    if (!b['ss:strap.session']) { const o = (await q('select blob from user_data where user_id=$1', [user.id]))[0]; if (o && o.blob && o.blob['ss:strap.session']) b['ss:strap.session'] = o.blob['ss:strap.session']; }
    await q('insert into user_data(user_id,blob,updated_at) values($1,$2,now()) on conflict(user_id) do update set blob=$2, updated_at=now()', [user.id, b]);
    return [200, { ok: true }];
  }
  const r = await q('select blob from user_data where user_id=$1', [user.id]);
  return [200, { ok: true, blob: r[0] ? r[0].blob : {} }];
};
/* ---- images stored inside Neon (bytea) ---- */
H['media'] = async (req, res, user) => {
  if (req.method === 'GET') {
    const r = (await q('select mime,data from media where id=$1', [String(req.query.id || '')]).catch(() => []))[0];
    if (!r) { res.statusCode = 404; res.end(); return null; }
    res.setHeader('Content-Type', r.mime); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); res.end(r.data); return null;
  }
  if (!user) return [401, { ok: false }];
  const { name, type, data } = req.body || {};
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type || '') || !data) return [400, { ok: false, msg: 'Only JPG, PNG, WEBP or GIF images.' }];
  const buf = Buffer.from(String(data), 'base64');
  if (buf.length > 3 * 1024 * 1024) return [413, { ok: false, msg: 'Image is too large.' }];
  const r = (await q('insert into media(user_id,name,mime,data) values($1,$2,$3,$4) returning id', [user.id, String(name || '').slice(0, 120), type, buf]))[0];
  return [200, { ok: true, url: '/api/media?id=' + r.id }];
};
/* ---- support / contact form ---- */
H['contact'] = async (req, res, user) => {
  const b = req.body || {}, email = lower(b.email || (user && user.email)), msg = String(b.message || '').trim().slice(0, 4000);
  if (!emailRe.test(email) || msg.length < 3) return [400, { ok: false, msg: 'Add your email and a message.' }];
  await q('insert into support_messages(user_id,email,kind,message) values($1,$2,$3,$4)', [user ? user.id : null, email, String(b.kind || 'support').slice(0, 30), msg]);
  if (E.SUPPORT_EMAIL) await mail(E.SUPPORT_EMAIL, `[${b.kind || 'support'}] from ${email}`, wrap('New message', `<p><b>${esc(email)}</b></p><p>${esc(msg).replace(/\n/g, '<br>')}</p>`));
  await mail(email, 'We got your message', wrap('Thanks for reaching out', `<p>${esc(APP)} support received your message and will reply soon.</p>`));
  return [200, { ok: true }];
};
/* ---- delete account ---- */
H['account/delete'] = async (req, res, user) => {
  if (!user) return [401, { ok: false }];
  await q('delete from user_data where user_id=$1', [user.id]); await q('delete from media where user_id=$1', [user.id]);
  await q("update app_users set deleted_at=now(), survey=$2 where id=$1", [user.id, req.body.payload || {}]);
  await na(req, 'POST', '/delete-user', {}, upCookie(req)); // works if account deletion is enabled in Neon Auth
  await na(req, 'POST', '/sign-out', {}, upCookie(req)); clearMine(res); return [200, { ok: true }];
};

module.exports = async (req, res) => {
  try {
    req.query = Object.assign({}, req.query || {}, Object.fromEntries(new URLSearchParams(String(req.url || '').split('?')[1] || '')));
    const route = String(req.query.__strap_route || req.url || '').split('?')[0].replace(/^\/api\//, '').replace(/^health\//, '').replace(/\/+$/, ''), h = H[route];
    if (!h) { res.statusCode = 404; return res.json({ ok: false }); }
    if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch (e) { req.body = {}; } }
    req.body = req.body || {};
    const out = await h(req, res, await me(req));
    if (out === null) return;
    res.statusCode = out[0]; res.setHeader('Cache-Control', 'no-store'); res.json(out[1]);
  } catch (e) { console.error(e); res.statusCode = 500; res.json({ ok: false, msg: 'Server error. Try again.' }); }
};
