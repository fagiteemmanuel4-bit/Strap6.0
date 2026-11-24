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

const staffToken = req => { const m = /(?:^|;\s*)strap_staff=([\w-]+)/.exec(req.headers.cookie || ''); return m ? m[1] : ''; };
const setStaffCookie = (res, token) => res.setHeader('Set-Cookie', ['strap_auth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0', 'strap_staff=' + token + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200']);
const clearStaffCookie = res => res.setHeader('Set-Cookie', [
  'strap_staff=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
  'strap_auth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
]);
const staffAccess = role => ({
  'Cashier': { defaultRoute: 'new-sale', allowedRoutes: ['new-sale','sales-today','sales-history'] },
  'Stock keeper': { defaultRoute: 'products', allowedRoutes: ['products','inventory','transfers'] }
}[role] || { defaultRoute: '', allowedRoutes: [] });
function staffLookupKeys(req,email) {
  const forwarded=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'').split(',')[0].trim();
  const ip=forwarded&&forwarded.length<=80?forwarded:'unknown';
  return [{key:sha('strap-staff-lookup-email:'+lower(email)),threshold:100,email:true},
    {key:sha('strap-staff-lookup-ip:'+ip),threshold:500,email:false}];
}
function staffLoginKeys(req, email) {
  const forwarded = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded && forwarded.length <= 80 ? forwarded : 'unknown';
  return [{ key: sha('strap-staff-email:' + lower(email)), threshold: 5, email: true },
    { key: sha('strap-staff-ip:' + ip), threshold: 20, email: false }];
}
async function recordStaffFailure(keys) {
  for (const item of keys) await q(`insert into auth_login_limits(bucket_key,attempt_count,window_started_at,blocked_until,lock_level,updated_at)
    values($1,1,now(),null,0,now()) on conflict(bucket_key) do update set
    attempt_count=case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end,
    window_started_at=case when auth_login_limits.window_started_at < now()-interval '24 hours' then now() else auth_login_limits.window_started_at end,
    blocked_until=case
      when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2+6 then now()+interval '24 hours'
      when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2+4 then now()+interval '6 hours'
      when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2+2 then now()+interval '1 hour'
      when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2 then now()+interval '15 minutes'
      else null end,
    lock_level=least(4,auth_login_limits.lock_level+1),updated_at=now()`, [item.key,item.threshold]);
}
async function clearStaffFailures(keys) { await q('delete from auth_login_limits where bucket_key=any($1::text[])',[keys.map(x=>x.key)]); }
async function migrateLegacyStaffForOwner(ownerId) {
  const row=(await q('select blob from user_data where user_id=$1',[ownerId]))[0];
  if(!row || !row.blob || typeof row.blob['ls:strap.f1']!=='string') return;
  let state={}; try { state=JSON.parse(row.blob['ls:strap.f1']); } catch (_) { return; }
  const list=Array.isArray(state.staff)?state.staff:[];
  for(const x of list) {
    const email=lower(x.email), role=String(x.role||'');
    if(!emailRe.test(email) || !staffAccess(role).allowedRoutes.length || !/^[a-f0-9]{64}$/i.test(String(x.pin||'')) || !String(x.salt||'').length) continue;
    await q(`insert into staff_accounts(owner_id,name,role,branch_id,email,pin_salt,pin_hash,pin_algo)
      values($1,$2,$3,$4,$5,$6,$7,'legacy-sha256-v1') on conflict do nothing`,
      [ownerId,String(x.name||'Staff').slice(0,80),role,x.branch||null,email,String(x.salt).slice(0,120),String(x.pin).toLowerCase()]);
  }
  const safe=await safeStaffRows(ownerId), clean={...(row.blob||{})};
  state.staff=safe.map(x=>({id:x.id,name:x.name,role:x.role,branch:x.branch,email:x.email,at:Number(x.at)}));
  clean['ls:strap.f1']=JSON.stringify(state);
  await q('update user_data set blob=$2,updated_at=now() where user_id=$1',[ownerId,clean]);
}
async function migrateLegacyStaffByEmail(email) {
  const rows=await q(`select u.user_id,u.blob from user_data u join app_users a on a.id=u.user_id
    where a.deleted_at is null and u.blob ? 'ls:strap.f1'
    and exists (select 1 from jsonb_array_elements(case when jsonb_typeof((u.blob->>'ls:strap.f1')::jsonb->'staff')='array' then (u.blob->>'ls:strap.f1')::jsonb->'staff' else '[]'::jsonb end) x
      where lower(x->>'email')=$1) limit 3`,[lower(email)]);
  for(const row of rows) {
    const list=JSON.parse(row.blob['ls:strap.f1']||'{}').staff||[];
    const found=list.some(x=>lower(x.email)===lower(email));
    if(found) await migrateLegacyStaffForOwner(row.user_id);
  }
}
async function safeStaffRows(ownerId, branchId=null) {
  return q(`select id::text as id,name,role,branch_id as branch,email,
    (extract(epoch from created_at)*1000)::bigint as at
    from staff_accounts where owner_id=$1 and status='active' and role in ('Cashier','Stock keeper')
      and ($2::text is null or branch_id=$2 or branch_id is null) order by created_at desc`,[ownerId,branchId]);
}
function parseStored(raw, fallback={}) { try { return typeof raw==='string' ? JSON.parse(raw) : (raw||fallback); } catch (_) { return fallback; } }

function appendOnlyRows(existing,incoming,prepend=false) {
  const old=Array.isArray(existing)?existing:[], next=Array.isArray(incoming)?incoming:[];
  const ids=new Set(old.map(x=>String(x&&(x.id||x.no)||JSON.stringify(x))));
  const added=next.filter(x=>{const id=String(x&&(x.id||x.no)||JSON.stringify(x));if(ids.has(id))return false;ids.add(id);return true;});
  return prepend?[...added,...old]:[...old,...added];
}
function mergeCreditPayments(existing,incoming) {
  const old=Array.isArray(existing)?existing:[], next=Array.isArray(incoming)?incoming:[];
  const oldIds=new Set(old.map(x=>String(x.id)));
  const merged=old.map(item=>{
    const fresh=next.find(x=>String(x.id)===String(item.id)); if(!fresh)return item;
    const payments=Array.isArray(item.payments)?item.payments:[], keys=new Set(payments.map(p=>String(p&&p.ts)+':'+String(p&&p.amount)));
    const additions=(Array.isArray(fresh.payments)?fresh.payments:[]).filter(p=>p&&!keys.has(String(p.ts)+':'+String(p.amount)));
    return additions.length?{...item,payments:[...payments,...additions]}:item;
  });
  const added=next.filter(x=>!oldIds.has(String(x.id)));
  return [...added,...merged];
}

async function safeOwnerBlob(ownerId, blob) {
  const out={...(blob||{})}, rows=await safeStaffRows(ownerId);
  const f1=parseStored(out['ls:strap.f1'],{});
  f1.staff=rows.map(x=>({id:x.id,name:x.name,role:x.role,branch:x.branch,email:x.email,at:Number(x.at)}));
  out['ls:strap.f1']=JSON.stringify(f1);
  return out;
}
async function staffSession(req) {
  const token=staffToken(req); if(!token) return null;
  const tokenHash=sha(token);
  const row=(await q(`select s.id::text as id,s.owner_id,s.name,s.role,s.branch_id,s.email,
      a.profile,a.email as owner_email,ss.last_seen_at
    from staff_sessions ss join staff_accounts s on s.id=ss.staff_id
    join app_users a on a.id=s.owner_id
    where ss.token_hash=$1 and ss.expires_at>now() and s.status='active' and s.role in ('Cashier','Stock keeper') and a.deleted_at is null limit 1`,[tokenHash]))[0];
  if(!row || await accountSuspension(row.owner_email)) {
    await q('delete from staff_sessions where token_hash=$1',[tokenHash]).catch(()=>[]);
    return null;
  }
  if(!row.last_seen_at || Date.now()-new Date(row.last_seen_at).getTime()>300000)
    await q('update staff_sessions set last_seen_at=now() where token_hash=$1',[tokenHash]);
  return {...row, access:staffAccess(row.role)};
}
function staffAllowedBranches(staff, state) {
  const all=Array.isArray(state.branches)&&state.branches.length?state.branches:[{id:'b0',name:'Main branch'}];
  return staff.branch_id ? all.filter(b=>String(b.id)===String(staff.branch_id)) : all;
}
function staffReadBlob(blob, staff) {
  const role=staff.role, state=parseStored(blob['ls:strap.f1'],{}), branches=staffAllowedBranches(staff,state);
  const active=branches.some(b=>String(b.id)===String(state.active))?state.active:(branches[0]&&branches[0].id)||'b0';
  const f1={plan:'free',branches,active,imports:{m:new Date().toISOString().slice(0,7),n:0},theme:state.theme||'light',
    staff:[],twofa:{on:false,secret:''},backup:{email:'',phone:''},mcp:[],transfers:role==='Stock keeper'?(state.transfers||[]):[],dismissed:[]};
  const out={'ls:strap.f1':JSON.stringify(f1)};
  const profile=staff.profile||{};
  out['ss:strap.session']=JSON.stringify({name:staff.name,bizname:profile.bizname||'My Store',currency:profile.currency||'NGN',photoUrl:profile.photoUrl||''});
  for(const [key,value] of Object.entries(blob||{})) {
    if(!key.startsWith('ls:strap.f1.items.')) continue;
    const branchId=key.slice('ls:strap.f1.items.'.length);
    if(branches.some(b=>String(b.id)===branchId)) out[key]=value;
  }
  if(role==='Cashier') {
    const v=parseStored(blob['ls:strap.v1'],{});
    const data={sales:v.sales||[],payments:v.payments||[],held:v.held||[],credits:v.credits||[],seq:v.seq||0,closed:v.closed||null,staffSalesOpen:v.staffSalesOpen===true};
    out['ls:strap.v1']=JSON.stringify(data);
  }
  return out;
}
async function staffWriteBlob(ownerId, staff, incoming) {
  const row=(await q('select blob from user_data where user_id=$1',[ownerId]))[0], blob={...(row&&row.blob||{})};
  const role=staff.role, state=parseStored(blob['ls:strap.f1'],{}), allowed=staffAllowedBranches(staff,state), branchIds=new Set(allowed.map(b=>String(b.id)));
  const incomingF1=parseStored(incoming['ls:strap.f1'],{});
  if(incomingF1.active && branchIds.has(String(incomingF1.active))) state.active=incomingF1.active;
  if(role==='Stock keeper' && Array.isArray(incomingF1.transfers)) state.transfers=incomingF1.transfers.slice(0,500);
  state.staff=Array.isArray(state.staff)?state.staff:[];
  blob['ls:strap.f1']=JSON.stringify(state);
  for(const [key,value] of Object.entries(incoming||{})) {
    if(!key.startsWith('ls:strap.f1.items.')) continue;
    const branchId=key.slice('ls:strap.f1.items.'.length);
    if(!branchIds.has(branchId)) continue;
    let next; try { next=JSON.parse(value); } catch (_) { continue; }
    if(!Array.isArray(next)) continue;
    if(role==='Stock keeper') blob[key]=JSON.stringify(next.slice(0,10000));
    else if(role==='Cashier') {
      const current=parseStored(blob[key],[]), map=new Map(next.filter(x=>x&&x.id).map(x=>[String(x.id),x]));
      blob[key]=JSON.stringify(current.map(p=>{const n=map.get(String(p.id));return n&&Number.isFinite(+n.qty)?{...p,qty:Math.max(0,Math.min(Number(p.qty)||0,+n.qty))}:p;}));
    }
  }
  if(role==='Cashier') {
    const next=parseStored(incoming['ls:strap.v1'],{}), current=parseStored(blob['ls:strap.v1'],{});
    current.sales=appendOnlyRows(current.sales,next.sales,true);
    current.payments=appendOnlyRows(current.payments,next.payments,false);
    current.credits=mergeCreditPayments(current.credits,next.credits);
    if(Array.isArray(next.held)) current.held=next.held.slice(0,500);
    current.seq=Math.max(Number(current.seq)||0,Number(next.seq)||0);
    // Cashiers cannot change the closed-day flag, order book, receipt settings or owner preferences.
    blob['ls:strap.v1']=JSON.stringify(current);
  }
  await q('insert into user_data(user_id,blob,updated_at) values($1,$2,now()) on conflict(user_id) do update set blob=$2,updated_at=now()',[ownerId,blob]);
}


/* Persistent abuse controls. All counters are stored in Neon and shared across Vercel instances. */
function loginLimitKeys(req, email) {
  const forwarded = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded && forwarded.length <= 80 ? forwarded : 'unknown';
  return [{ key: sha('strap-login-email:' + lower(email)), threshold: 5, email: true },
    { key: sha('strap-login-ip:' + ip), threshold: 20, email: false }];
}
async function loginIsBlocked(keys) {
  const rows = await q('select bucket_key, blocked_until from auth_login_limits where bucket_key = any($1::text[]) and blocked_until > now()', [keys.map(x => x.key)]);
  return rows.length ? rows[0].blocked_until : null;
}
async function suspendEmail(email, reason) {
  const e = lower(email);
  const u = (await q('select id::text as id from neon_auth."user" where lower(email)=$1 limit 1', [e]))[0];
  if (!u) return;
  await q(`insert into auth_account_security(email,user_id,suspended_at,suspension_reason,updated_at)
    values($1,$2,now(),$3,now()) on conflict(email) do update set
    user_id=coalesce(auth_account_security.user_id,excluded.user_id),
    suspended_at=coalesce(auth_account_security.suspended_at,now()),
    suspension_reason=excluded.suspension_reason, updated_at=now()`, [e,u && u.id,reason]);
}
async function accountSuspension(email) {
  return (await q('select suspended_at, review_status from auth_account_security where email=$1 and suspended_at is not null', [lower(email)]))[0] || null;
}
async function recordLoginFailures(keys, email) {
  let emailCount = 0;
  for (const item of keys) {
    const rows = await q(`insert into auth_login_limits(bucket_key,attempt_count,window_started_at,blocked_until,lock_level,updated_at)
      values($1,1,now(),null,0,now())
      on conflict(bucket_key) do update set
        attempt_count=case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end,
        window_started_at=case when auth_login_limits.window_started_at < now()-interval '24 hours' then now() else auth_login_limits.window_started_at end,
        blocked_until=case
          when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2+6 then now()+interval '24 hours'
          when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2+4 then now()+interval '6 hours'
          when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2+2 then now()+interval '1 hour'
          when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2 then now()+interval '15 minutes'
          else null end,
        lock_level=case
          when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2+6 then 4
          when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2+4 then 3
          when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2+2 then 2
          when (case when auth_login_limits.window_started_at < now()-interval '24 hours' then 1 else auth_login_limits.attempt_count+1 end) >= $2 then 1
          else 0 end, updated_at=now()
      returning attempt_count`, [item.key,item.threshold]);
    if (item.email) emailCount=Number(rows[0].attempt_count);
  }
  if (emailCount >= 11) await suspendEmail(email,'Repeated incorrect password attempts triggered the 24-hour security threshold.');
}
async function clearLoginFailures(email) {
  await q('delete from auth_login_limits where bucket_key=$1', [sha('strap-login-email:' + lower(email))]);
}
function actionKeys(req,email,action) {
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'unknown').split(',')[0].trim();
  return [{key:sha('strap-action-email:'+action+':'+lower(email)),account:true},
    {key:sha('strap-action-ip:'+action+':'+ip),account:false}];
}
async function actionBlocked(req,email,action) {
  const keys=actionKeys(req,email,action).map(x=>x.key);
  const row=(await q('select blocked_until from auth_action_limits where bucket_key=any($1::text[]) and blocked_until>now() limit 1',[keys]))[0];
  return row && row.blocked_until;
}
async function recordAction(req,email,action) {
  const keys=actionKeys(req,email,action);
  for(const item of keys) {
    const rows=await q(`insert into auth_action_limits(bucket_key,attempt_count,window_started_at,blocked_until,lock_level,updated_at)
      values($1,1,now(),now()+interval '30 seconds',0,now())
      on conflict(bucket_key) do update set
        attempt_count=case when auth_action_limits.window_started_at<now()-interval '24 hours' then 1 else auth_action_limits.attempt_count+1 end,
        window_started_at=case when auth_action_limits.window_started_at<now()-interval '24 hours' then now() else auth_action_limits.window_started_at end,
        lock_level=case when auth_action_limits.window_started_at<now()-interval '24 hours' then 0 else least(6,auth_action_limits.lock_level+1) end,
        blocked_until=now()+case least(6,case when auth_action_limits.window_started_at<now()-interval '24 hours' then 0 else auth_action_limits.lock_level+1 end)
          when 0 then interval '30 seconds' when 1 then interval '1 minute' when 2 then interval '5 minutes'
          when 3 then interval '15 minutes' when 4 then interval '1 hour' when 5 then interval '6 hours' else interval '24 hours' end,
        updated_at=now() returning lock_level`,[item.key]);
    if(item.account && Number(rows[0].lock_level)>=6 && (action==='otp-send'||action==='otp-verify'))
      await suspendEmail(email,'Repeated verification-code abuse triggered the security threshold.');
  }
}
async function clearAction(req,email,action) { const keys=actionKeys(req,email,action).map(x=>x.key); await q('delete from auth_action_limits where bucket_key=any($1::text[])',[keys]); }
async function me(req) {
  if (staffToken(req)) return null;
  const c = upCookie(req); if (!c) return null;
  const k = sha(c), hit = cache.get(k); if (hit && hit.t > Date.now()) { if (await accountSuspension(hit.u.email)) { cache.delete(k); return null; } return hit.u; }
  const r = await na(req, 'GET', '/get-session', null, c);
  const u = r.ok && r.j && r.j.user && r.j.user.emailVerified !== false ? { id: String(r.j.user.id), email: lower(r.j.user.email), name: r.j.user.name } : null;
  if (u) { if (await accountSuspension(u.email)) return null; await q('insert into app_users(id,email) values($1,$2) on conflict(id) do nothing', [u.id, u.email]); cache.set(k, { u, t: Date.now() + 30000 }); }
  return u;
}

/* FormSubmit handles optional welcome messages and support submissions. Neon Auth still sends security codes. */
const formInbox = () => lower(E.FORMSUBMIT_EMAIL || E.SUPPORT_EMAIL || '');
async function mail(to, subject, html) {
  const inbox = formInbox();
  if (!inbox || !emailRe.test(inbox) || !emailRe.test(lower(to))) return false;
  const plain = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const form = new URLSearchParams({ name: APP, email: lower(to), _subject: subject, message: plain.slice(0, 4000), _autoresponse: plain.slice(0, 4000), _template: 'table', _url: (E.SITE_URL || 'https://strap60.vercel.app') + '/dashboard.html' });
  try {
    const r = await fetch('https://formsubmit.co/' + encodeURIComponent(inbox), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: form.toString(), redirect: 'manual' });
    return r.ok || (r.status >= 300 && r.status < 400);
  } catch (e) { console.error('FormSubmit welcome email failed:', e); return false; }
}
async function formSubmitSupport(fields) {
  const inbox = formInbox();
  if (!inbox || !emailRe.test(inbox)) return false;
  try {
    const r = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(inbox), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ...fields, _template: 'table', _subject: '[Strap Support] ' + fields.category }) });
    const raw = await r.text(); let data = {}; try { data = JSON.parse(raw); } catch (e) {}
    return r.ok && (data.success === true || data.success === 'true');
  } catch (e) { console.error('FormSubmit support submission failed:', e); return false; }
}
const wrap = (t, b) => `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px"><h2>${t}</h2>${b}<p style="color:#888;font-size:12px;margin-top:28px">${esc(APP)}</p></div>`;

const H = {};
H['health'] = async (req) => {
  const out = { db: false, auth: false };
  try { await q('select 1'); out.db = true; } catch (e) { out.dbError = e.message; }
  const r = await na(req, 'GET', '/get-session'); out.auth = r.status < 500 && r.status !== 404; out.authStatus = r.status;
  return [200, out];
};

/* Check an email before asking the visitor to create a password. */
H['auth/email-status'] = async (req) => {
  const email = lower(req.body.email);
  if (!emailRe.test(email)) return [400, { ok: false, msg: 'Enter a valid email address.' }];
  let staffExists=await q('select 1 from staff_accounts where lower(email)=$1 and status=\'active\' limit 1',[email]);
  if(!staffExists.length) {
    const ownerExists=await q('select 1 from neon_auth.\"user\" where lower(email)=$1 limit 1',[email]);
    if(!ownerExists.length) { await migrateLegacyStaffByEmail(email); staffExists=await q('select 1 from staff_accounts where lower(email)=$1 and status=\'active\' limit 1',[email]); }
  }
  if(staffExists.length) return [409,{ok:false,code:'STAFF_EMAIL',msg:'This email belongs to a Strap staff account. Sign in using your 6-digit staff PIN.'}];
  const existing = await q('select 1 from auth_email_registry where lower(email)=$1 union all select 1 from neon_auth."user" where lower(email)=$1 limit 1', [email]);
  return existing.length
    ? [409, { ok: false, code: 'ACCOUNT_EXISTS', msg: 'An account with this email already exists. Sign in with your password.' }]
    : [200, { ok: true }];
};

/* sign up step 1: Neon Auth sends the verification OTP automatically because Verify at Sign-up is enabled with the OTP method. */
H['auth/signup-start'] = async (req) => {
  const email = lower(req.body.email), password = String(req.body.password || '');
  if (!emailRe.test(email) || password.length < 8) return [400, { ok: false, msg: 'Check your email and password.' }];
  let staffExists=await q('select 1 from staff_accounts where lower(email)=$1 and status=\'active\' limit 1',[email]);
  if(!staffExists.length) {
    const ownerExists=await q('select 1 from neon_auth.\"user\" where lower(email)=$1 limit 1',[email]);
    if(!ownerExists.length) { await migrateLegacyStaffByEmail(email); staffExists=await q('select 1 from staff_accounts where lower(email)=$1 and status=\'active\' limit 1',[email]); }
  }
  if(staffExists.length) return [409,{ok:false,code:'STAFF_EMAIL',msg:'This email belongs to a Strap staff account. Sign in using your 6-digit staff PIN.'}];

  // Check Neon Managed Auth directly. Never attempt a sign-in with the password
  // supplied on the create-account screen to detect an existing identity.
  const existing = await q('select 1 from auth_email_registry where email=$1 union all select 1 from neon_auth."user" where lower(email)=$1 limit 1', [email]);
  if (existing.length) return [409, { ok: false, code: 'ACCOUNT_EXISTS', msg: 'An account with this email already exists. Sign in with your password.' }];
  try { await q('insert into auth_email_registry(email) values($1)',[email]); }
  catch (e) { return [409, { ok:false, code:'ACCOUNT_EXISTS', msg:'An account with this email already exists. Sign in with your password.' }]; }
  const sendWait=await actionBlocked(req,email,'otp-send');
  if (sendWait) { await q('delete from auth_email_registry where email=$1',[email]); return [429,{ok:false,code:'RATE_LIMITED',msg:'Please wait before requesting another verification code.'}]; }
  await recordAction(req,email,'otp-send');
  const r = await na(req, 'POST', '/sign-up/email', { email, password, name: email.split('@')[0] });
  if (!r.ok) {
    // Covers a signup race: another request may have created the same email
    // after the existence check but before Neon processed this request.
    const appeared = await q('select 1 from neon_auth."user" where lower(email)=$1 limit 1', [email]).catch(() => []);
    if (appeared.length || /already exists|user exists|email.*taken/i.test(errMsg(r))) { await q('delete from auth_email_registry where email=$1',[email]);
      return [409, { ok: false, code: 'ACCOUNT_EXISTS', msg: 'An account with this email already exists. Sign in with your password.' }];
    }
    await q('delete from auth_email_registry where email=$1',[email]);
    return [r.status === 429 ? 429 : r.status >= 500 ? 502 : 400, { ok: false, msg: errMsg(r) }];
  }
  // Managed Auth sends the initial verification code during /sign-up/email.
  return [200, { ok: true }];
};
/* Activity PIN verification is bound to the signed-in account, not signup/reset in-memory state. */
H['auth/pin/send-code'] = async (req, res, user) => {
  if (!user) return [401, { ok: false, msg: 'Your session expired. Sign in again.' }];
  const email = lower(user.email), requested = lower(req.body.email);
  if (!email || (requested && requested !== email)) return [403, { ok: false, msg: 'The verification email must match your signed-in account.' }];
  if (await accountSuspension(email)) return [423, { ok: false, code: 'ACCOUNT_SUSPENDED', msg: 'This account is suspended. Request a review to restore access.' }];
  const wait = await actionBlocked(req, email, 'otp-send');
  if (wait) return [429, { ok: false, code: 'RATE_LIMITED', msg: 'Too many code requests. Please wait before trying again.' }];
  await recordAction(req, email, 'otp-send');
  const r = await na(req, 'POST', '/email-otp/send-verification-otp', { email, type: 'sign-in' });
  return r.ok ? [200, { ok: true }] : [r.status === 429 ? 429 : r.status >= 500 ? 502 : 400, { ok: false, msg: errMsg(r) }];
};
H['auth/pin/verify-code'] = async (req, res, user) => {
  if (!user) return [401, { ok: false, msg: 'Your session expired. Sign in again.' }];
  const email = lower(user.email), requested = lower(req.body.email), otp = String(req.body.otp || '').trim();
  if (!email || (requested && requested !== email) || !/^\d{6}$/.test(otp))
    return [400, { ok: false, msg: 'Enter the 6-digit code sent to your account email.' }];
  if (await accountSuspension(email)) return [423, { ok: false, code: 'ACCOUNT_SUSPENDED', msg: 'This account is suspended. Request a review to restore access.' }];
  const wait = await actionBlocked(req, email, 'otp-verify');
  if (wait) return [429, { ok: false, code: 'RATE_LIMITED', msg: 'Too many code attempts. Please wait before trying again.' }];
  await recordAction(req, email, 'otp-verify');
  const r = await na(req, 'POST', '/sign-in/email-otp', { email, otp });
  if (!r.ok) return [r.status === 429 ? 429 : r.status >= 500 ? 502 : 400, { ok: false, msg: errMsg(r) }];
  await clearAction(req, email, 'otp-verify');
  mine(res, r.cookies);
  return [200, { ok: true }];
};

H['auth/send-code'] = async (req) => {
  const email = lower(req.body.email), type = req.body.type === 'forget-password' ? 'forget-password' : 'email-verification';
  if (!emailRe.test(email)) return [400, { ok: false, msg: 'Enter a valid email.' }];
  const suspended=await accountSuspension(email); if(suspended) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}];
  const wait=await actionBlocked(req,email,'otp-send'); if(wait) return [429,{ok:false,code:'RATE_LIMITED',msg:'Too many code requests. Please wait before trying again.'}];
  await recordAction(req,email,'otp-send');
  if(await accountSuspension(email)) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}];
  const r = type === 'forget-password' ? await na(req, 'POST', '/forget-password/email-otp', { email }) : await na(req, 'POST', '/email-otp/send-verification-otp', { email, type });
  return r.ok ? [200, { ok: true }] : [r.status === 429 ? 429 : 400, { ok: false, msg: errMsg(r) }];
};
/* sign up step 2: verify the code, which signs the user in */
H['auth/verify-email'] = async (req, res) => {
  const email = lower(req.body.email), otp = String(req.body.otp || '').trim();
  if (!emailRe.test(email) || !/^\d{6}$/.test(otp)) return [400, { ok: false, msg: 'Enter the complete 6-digit verification code.' }];
  if(await accountSuspension(email)) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}];
  const wait=await actionBlocked(req,email,'otp-verify'); if(wait) return [429,{ok:false,code:'RATE_LIMITED',msg:'Too many incorrect code attempts. Please wait before trying again.'}];
  await recordAction(req,email,'otp-verify');
  if(await accountSuspension(email)) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}];
  const r = await na(req, 'POST', '/email-otp/verify-email', { email, otp });
  if (!r.ok) return [r.status === 429 ? 429 : r.status >= 500 ? 502 : 400, { ok: false, msg: errMsg(r) }];
  await clearAction(req,email,'otp-verify');
  let cookies = r.cookies;
  if (!cookies.length && req.body.password) { const s = await na(req, 'POST', '/sign-in/email', { email, password: String(req.body.password) }); if (s.ok) cookies = s.cookies; }
  if (!cookies.length) return [200, { ok: false, msg: 'Verified, but sign in failed. Please sign in.' }];
  const verifiedUser=(await q('select id::text as id from neon_auth.\"user\" where lower(email)=$1 limit 1',[email]))[0];
  if(verifiedUser) await q('insert into auth_email_registry(email,user_id) values($1,$2) on conflict(email) do update set user_id=excluded.user_id',[email,verifiedUser.id]);
  mine(res, cookies); return [200, { ok: true }];
};
/* forgot password: check the code without using it up (if Neon supports it) */
H['auth/check-code'] = async (req) => {
  const email=lower(req.body.email);
  if(await accountSuspension(email)) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}];
  const wait=await actionBlocked(req,email,'otp-verify'); if(wait) return [429,{ok:false,code:'RATE_LIMITED',msg:'Too many code attempts. Please wait before trying again.'}];
  await recordAction(req,email,'otp-verify');
  if(await accountSuspension(email)) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}];
  const r = await na(req, 'POST', '/email-otp/check-verification-otp', { email, type: 'forget-password', otp: String(req.body.code || '').trim() });
  if (r.ok || r.status === 404) await clearAction(req,email,'otp-verify');
  if (r.status === 404) return [200, { ok: true }]; // not available: the code is checked when the new password is saved
  return [200, { ok: r.ok }];
};
H['auth/reset'] = async (req) => {
  const email=lower(req.body.email), pw = String(req.body.password || ''); if (pw.length < 8) return [400, { ok: false, msg: 'Use at least 8 characters.' }];
  if(await accountSuspension(email)) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}];
  const wait=await actionBlocked(req,email,'otp-verify'); if(wait) return [429,{ok:false,code:'RATE_LIMITED',msg:'Too many code attempts. Please wait before trying again.'}];
  await recordAction(req,email,'otp-verify');
  if(await accountSuspension(email)) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}];
  const r = await na(req, 'POST', '/email-otp/reset-password', { email, otp: String(req.body.code || '').trim(), password: pw });
  if(r.ok) await clearAction(req,email,'otp-verify');
  return r.ok ? [200, { ok: true }] : [400, { ok: false, msg: 'That code is wrong or expired.' }];
};
H['auth/signin'] = async (req, res) => {
  const email = lower(req.body.email), password = String(req.body.password || '');
  if (!emailRe.test(email) || !password) return [400, { ok: false, msg: 'Enter your email and password.' }];
  if (await accountSuspension(email)) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}];
  const keys = loginLimitKeys(req, email);
  const blocked=await loginIsBlocked(keys); if (blocked) return [429, { ok: false, msg: 'Too many incorrect attempts. Please wait before trying again.' }];
  const r = await na(req, 'POST', '/sign-in/email', { email, password });
  if (r.status === 403) {
    const resend = await na(req, 'POST', '/email-otp/send-verification-otp', { email, type: 'email-verification' });
    return resend.ok
      ? [403, { ok: false, code: 'EMAIL_VERIFICATION_REQUIRED', msg: 'Your email is not verified. We sent you a new 6-digit code.' }]
      : [resend.status === 429 ? 429 : 502, { ok: false, msg: 'Your email needs verification, but we could not send a new code. ' + errMsg(resend) }];
  }
  if (!r.ok || !r.cookies.length) {
    if (r.status === 401 || r.status === 400 || r.status === 403) { await recordLoginFailures(keys,email); if(await accountSuspension(email)) return [423,{ok:false,code:'ACCOUNT_SUSPENDED',msg:'This account is suspended. Request a review to restore access.'}]; }
    return [r.status === 429 ? 429 : 401, { ok: false, msg: r.status === 429 ? 'Too many attempts. Try again later.' : 'Email or password is incorrect.' }];
  }
  await clearLoginFailures(email);
  mine(res, r.cookies); return [200, { ok: true }];
};
H['auth/request-review'] = async (req) => {
  const email=lower(req.body.email), message=String(req.body.message||'').trim().slice(0,1500);
  if(!emailRe.test(email)) return [400,{ok:false,msg:'Enter the email address on the suspended account.'}];
  if(await actionBlocked(req,email,'review-request')) return [429,{ok:false,msg:'A review request was recently submitted. Please wait before sending another.'}];
  await recordAction(req,email,'review-request');
  const row=await accountSuspension(email); if(!row) return [404,{ok:false,msg:'No suspended account was found for this email.'}];
  await q("update auth_account_security set review_status='pending',review_message=$2,review_requested_at=now(),updated_at=now() where email=$1",[email,message||'Please review my account suspension.']);
  await q("insert into support_messages(user_id,email,kind,message) values(null,$1,'account-review',$2)",[email,message||'Please review my account suspension.']);
  if(E.SUPPORT_EMAIL) await mail(E.SUPPORT_EMAIL,`[Account review] ${email}`,wrap('Account review requested',`<p><b>${esc(email)}</b></p><p>${esc(message||'Please review my account suspension.')}</p>`));
  return [200,{ok:true,msg:'Your review request has been submitted.'}];
};
H['auth/signout'] = async (req, res) => { const c = upCookie(req), st=staffToken(req); if (st) await q('delete from staff_sessions where token_hash=$1',[sha(st)]).catch(()=>[]); if (c) await na(req, 'POST', '/sign-out', {}, c); clearStaffCookie(res); return [200, { ok: true }]; };
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


/* ---- staff accounts: owner-managed PIN identities and isolated staff sessions ---- */
H['staff/list'] = async (req,res,user,staff) => {
  if(!user || staff) return [403,{ok:false,msg:'Only the business owner can manage staff.'}];
  const ownerId=user.id;
  await migrateLegacyStaffForOwner(ownerId);
  return [200,{ok:true,staff:await safeStaffRows(ownerId,staff?staff.branch_id:null)}];
};
H['staff/create'] = async (req,res,user,staff) => {
  if(!user || staff) return [403,{ok:false,msg:'Only the business owner can add staff.'}];
  const ownerId=user.id;
  const b=req.body||{}, name=String(b.name||'').trim().slice(0,80), role=String(b.role||''), email=lower(b.email), pin=String(b.pin||''), branchId=b.branch||null;
  if(!name||!staffAccess(role).allowedRoutes.length||!emailRe.test(email)||!/^[0-9]{6}$/.test(pin)) return [400,{ok:false,msg:'Check the staff name, role, email and 6-digit PIN.'}];
  if(/^(\d)\1{5}$/.test(pin)||'0123456789'.includes(pin)||'9876543210'.includes(pin)) return [400,{ok:false,msg:'Choose a less predictable 6-digit PIN.'}];
  const stateRow=(await q('select blob from user_data where user_id=$1',[ownerId]))[0], f1=parseStored(stateRow&&stateRow.blob&&stateRow.blob['ls:strap.f1'],{});
  const branches=Array.isArray(f1.branches)?f1.branches:[{id:'b0'}];
  const used=Number((await q('select count(*)::int as n from staff_accounts where owner_id=$1 and status=\'active\'',[ownerId]))[0].n||0);
  const savedPlan=parseStored(stateRow&&stateRow.blob&&stateRow.blob['ls:strap.plan'],{});
  const maxStaff=f1.plan==='premium'||savedPlan.status==='active'?50:3;
  if(used>=maxStaff) return [403,{ok:false,code:'STAFF_LIMIT',msg:`Your current plan allows ${maxStaff} staff accounts.`}];
  const availableBranches=branches;
  if(branchId&&!availableBranches.some(x=>String(x.id)===String(branchId))) return [400,{ok:false,msg:'Choose a valid branch for this staff member.'}];
  let collision=await q('select 1 from staff_accounts where lower(email)=$1 union all select 1 from neon_auth.\"user\" where lower(email)=$1 union all select 1 from auth_email_registry where lower(email)=$1 limit 1',[email]);
  if(!collision.length) { await migrateLegacyStaffByEmail(email); collision=await q('select 1 from staff_accounts where lower(email)=$1 union all select 1 from neon_auth.\"user\" where lower(email)=$1 union all select 1 from auth_email_registry where lower(email)=$1 limit 1',[email]); }
  if(collision.length) return [409,{ok:false,code:'STAFF_EMAIL_EXISTS',msg:'That email is already linked to an account or another business.'}];
  const salt=crypto.randomBytes(16).toString('hex'), hash=crypto.scryptSync(pin,salt,64).toString('hex');
  try {
    const row=(await q(`insert into staff_accounts(owner_id,name,role,branch_id,email,pin_salt,pin_hash,pin_algo)
      values($1,$2,$3,$4,$5,$6,$7,'scrypt-v1')
      returning id::text as id,name,role,branch_id as branch,email,(extract(epoch from created_at)*1000)::bigint as at`,
      [ownerId,name,role,branchId,email,salt,hash]))[0];
    return [200,{ok:true,staff:row}];
  } catch(e) { if(e.code==='23505') return [409,{ok:false,code:'STAFF_EMAIL_EXISTS',msg:'That email is already linked to an account or another business.'}]; throw e; }
};
H['staff/remove'] = async (req,res,user,staff) => {
  if(!user || staff) return [403,{ok:false,msg:'Only the business owner can remove staff.'}];
  const ownerId=user.id, id=String(req.body.id||'');
  if(staff && id===staff.id) return [403,{ok:false,msg:'You cannot remove your own staff login.'}];
  const rows=await q('delete from staff_accounts where id=$1::uuid and owner_id=$2 and ($3::text is null or branch_id=$3) returning id',[id,ownerId,staff?staff.branch_id:null]).catch(()=>[]);
  if(!rows.length) return [404,{ok:false,msg:'Staff account not found.'}];
  return [200,{ok:true}];
};
H['staff/lookup'] = async (req) => {
  const email=lower(req.body.email);
  if(!emailRe.test(email)) return [400,{ok:false,msg:'Enter a valid email address.'}];
  const lookupKeys=staffLookupKeys(req,email), blocked=await loginIsBlocked(lookupKeys);
  if(blocked) return [429,{ok:false,msg:'Too many staff email checks. Please wait before trying again.'}];
  await recordStaffFailure(lookupKeys);
  let found=await q(`select 1 from staff_accounts s join app_users a on a.id=s.owner_id
    where lower(s.email)=$1 and s.status='active' and s.role in ('Cashier','Stock keeper') and a.deleted_at is null limit 1`,[email]);
  if(!found.length) {
    const ownerExists=await q('select 1 from neon_auth.\"user\" where lower(email)=$1 limit 1',[email]);
    if(!ownerExists.length) { await migrateLegacyStaffByEmail(email); found=await q(`select 1 from staff_accounts s join app_users a on a.id=s.owner_id where lower(s.email)=$1 and s.status='active' and s.role in ('Cashier','Stock keeper') and a.deleted_at is null limit 1`,[email]); }
  }
  return [200,{ok:true,staff:!!found.length}];
};
H['staff/login'] = async (req,res) => {
  const email=lower(req.body.email), pin=String(req.body.pin||'');
  if(!emailRe.test(email)||!/^[0-9]{6}$/.test(pin)) return [401,{ok:false,msg:'Email or staff PIN is incorrect.'}];
  let staffRow=(await q('select 1 from staff_accounts where lower(email)=$1 and status=\'active\' limit 1',[email]))[0];
  if(!staffRow) { const ownerExists=await q('select 1 from neon_auth.\"user\" where lower(email)=$1 limit 1',[email]); if(!ownerExists.length) await migrateLegacyStaffByEmail(email); }
  const keys=staffLoginKeys(req,email), blocked=await loginIsBlocked(keys);
  if(blocked) return [429,{ok:false,msg:'Too many incorrect PIN attempts. Please wait before trying again.'}];
  const row=(await q(`select s.id::text as id,s.owner_id,s.name,s.role,s.branch_id,s.email,s.pin_salt,s.pin_hash,s.pin_algo,
      a.email as owner_email,a.profile
    from staff_accounts s join app_users a on a.id=s.owner_id
    where lower(s.email)=$1 and s.status='active' and s.role in ('Cashier','Stock keeper') and a.deleted_at is null limit 1`,[email]))[0];
  let valid=false;
  if(row && !await accountSuspension(row.owner_email)) {
    try {
      const actual=row.pin_algo==='legacy-sha256-v1'?sha(row.pin_salt+':'+pin):crypto.scryptSync(pin,row.pin_salt,64).toString('hex');
      const a=Buffer.from(actual,'hex'), b=Buffer.from(row.pin_hash,'hex');
      valid=a.length===b.length&&crypto.timingSafeEqual(a,b);
    } catch(_) { valid=false; }
  }
  if(!valid) { await recordStaffFailure(keys); return [401,{ok:false,msg:'Email or staff PIN is incorrect.'}]; }
  if(row.pin_algo==='legacy-sha256-v1') {
    const salt=crypto.randomBytes(16).toString('hex'), hash=crypto.scryptSync(pin,salt,64).toString('hex');
    await q("update staff_accounts set pin_salt=$2,pin_hash=$3,pin_algo='scrypt-v1',updated_at=now() where id=$1::uuid",[row.id,salt,hash]);
  }
  await clearStaffFailures(keys.filter(x=>x.email));
  const token=crypto.randomBytes(32).toString('base64url'), tokenHash=sha(token);
  await q('delete from staff_sessions where expires_at<=now()');
  await q('insert into staff_sessions(token_hash,staff_id,owner_id,expires_at) values($1,$2::uuid,$3,now()+interval \'12 hours\')',[tokenHash,row.id,row.owner_id]);
  clearMine(res); setStaffCookie(res,token);
  const profile=row.profile||{};
  const access=staffAccess(row.role);
  return [200,{ok:true,staff:{name:row.name,role:row.role,email:row.email,branchId:row.branch_id,defaultRoute:access.defaultRoute,allowedRoutes:access.allowedRoutes,bizname:profile.bizname||'My Store',currency:profile.currency||'NGN'}}];
};
H['staff/signout'] = async (req,res) => {
  const token=staffToken(req); if(token) await q('delete from staff_sessions where token_hash=$1',[sha(token)]).catch(()=>[]);
  clearStaffCookie(res); return [200,{ok:true}];
};


async function applyStaffSalesSchedule(ownerId) {
  const row=(await q('select blob from user_data where user_id=$1',[ownerId]))[0],blob={...(row&&row.blob||{})},state=parseStored(blob['ls:strap.v1'],{}),sc=state.staffSalesSchedule||{};
  if(!sc.enabled)return {blob,state};
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),now=Number(parts.find(x=>x.type==='hour').value)*60+Number(parts.find(x=>x.type==='minute').value),[oh,om]=String(sc.open||'08:00').split(':').map(Number),[ch,cm]=String(sc.close||'20:00').split(':').map(Number),start=oh*60+om,end=ch*60+cm,active=start<end?(now>=start&&now<end):(now>=start||now<end);
  if(state.staffSalesOpen!==active){state.staffSalesOpen=active;state.staffSalesOpenedAt=active?new Date().toISOString():null;if(active)state.closed=null;blob['ls:strap.v1']=JSON.stringify(state);await q('insert into user_data(user_id,blob,updated_at) values($1,$2,now()) on conflict(user_id) do update set blob=$2,updated_at=now()',[ownerId,blob]);}
  return {blob,state};
}
H['sales/session'] = async (req,res,user,staff) => {
  if(!user||staff)return [403,{ok:false,msg:'Only the business owner can manage cashier sales.'}];
  const applied=await applyStaffSalesSchedule(user.id);let {blob,state}=applied;
  if(req.method==='POST'){
    if(req.body.schedule&&typeof req.body.schedule==='object'){const sc=req.body.schedule,open=String(sc.open||''),close=String(sc.close||'');if(typeof sc.enabled!=='boolean'||(sc.enabled&&(!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(open)||!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(close)||open===close)))return [400,{ok:false,msg:'Choose valid opening and closing times.'}];state.staffSalesSchedule={enabled:sc.enabled,open,close,timeZone:'Africa/Lagos'};}
    else{if(typeof req.body.open!=='boolean')return [400,{ok:false,msg:'Choose whether cashier sales should be open or closed.'}];state.staffSalesOpen=req.body.open;state.staffSalesOpenedAt=req.body.open?new Date().toISOString():null;if(req.body.open)state.closed=null;}
    blob['ls:strap.v1']=JSON.stringify(state);await q('insert into user_data(user_id,blob,updated_at) values($1,$2,now()) on conflict(user_id) do update set blob=$2,updated_at=now()',[user.id,blob]);
  }
  return [200,{ok:true,open:state.staffSalesOpen===true,schedule:state.staffSalesSchedule||{enabled:false,open:'08:00',close:'20:00',timeZone:'Africa/Lagos'}}];
};

/* ---- app data: the whole dashboard state as one JSON per user ---- */
H['data'] = async (req, res, user, staff) => {
  if (!user && !staff) return [401, { ok: false }];
  const ownerId=staff?staff.owner_id:user.id;
  if (req.method === 'PUT') {
    const b=req.body.blob; if(!b||typeof b!=='object') return [400,{ok:false}];
    if(staff) {
      if(staff.role==='Cashier') {
        const scheduled=await applyStaffSalesSchedule(ownerId);
        if(scheduled.state.staffSalesOpen!==true)return [423,{ok:false,code:'SALES_SESSION_CLOSED',msg:'Sales are closed or outside scheduled sales hours.'}];
      }
      await staffWriteBlob(ownerId,staff,b); return [200,{ok:true}];
    }
    if(!b['ss:strap.session']) { const o=(await q('select blob from user_data where user_id=$1',[ownerId]))[0]; if(o&&o.blob&&o.blob['ss:strap.session']) b['ss:strap.session']=o.blob['ss:strap.session']; }
    const clean=await safeOwnerBlob(ownerId,b);
    await q('insert into user_data(user_id,blob,updated_at) values($1,$2,now()) on conflict(user_id) do update set blob=$2,updated_at=now()',[ownerId,clean]);
    return [200,{ok:true}];
  }
  if(staff) {
    const scheduled=await applyStaffSalesSchedule(ownerId),blob=scheduled.blob||{};
    return [200,{ok:true,blob:staffReadBlob(blob,staff),staff:{name:staff.name,role:staff.role,branchId:staff.branch_id,email:staff.email,defaultRoute:staff.access.defaultRoute,allowedRoutes:staff.access.allowedRoutes,bizname:(staff.profile||{}).bizname||'My Store',currency:(staff.profile||{}).currency||'NGN'}}];
  }
  await migrateLegacyStaffForOwner(ownerId);
  const r=await q('select blob from user_data where user_id=$1',[ownerId]);
  return [200,{ok:true,blob:await safeOwnerBlob(ownerId,r[0]?r[0].blob:{})}];
};
/* ---- images stored inside Neon (bytea) ---- */
H['media'] = async (req, res, user, staff) => {
  if (req.method === 'GET') {
    const r = (await q('select mime,data from media where id=$1', [String(req.query.id || '')]).catch(() => []))[0];
    if (!r) { res.statusCode = 404; res.end(); return null; }
    res.setHeader('Content-Type', r.mime); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); res.end(r.data); return null;
  }
  if (!user && !(staff && staff.role === 'Stock keeper')) return [403, { ok: false }];
  const { name, type, data } = req.body || {};
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type || '') || !data) return [400, { ok: false, msg: 'Only JPG, PNG, WEBP or GIF images.' }];
  const buf = Buffer.from(String(data), 'base64');
  if (buf.length > 3 * 1024 * 1024) return [413, { ok: false, msg: 'Image is too large.' }];
  const r = (await q('insert into media(user_id,name,mime,data) values($1,$2,$3,$4) returning id', [staff ? staff.owner_id : user.id, String(name || '').slice(0, 120), type, buf]))[0];
  return [200, { ok: true, url: '/api/media?id=' + r.id }];
};
/* ---- support / contact form: save locally, then forward to the verified FormSubmit inbox ---- */
H['contact'] = async (req, res, user) => {
  const b = req.body || {}, email = lower(b.email || (user && user.email));
  const msg = String(b.message || '').trim().slice(0, 4000);
  const category = String(b.kind || 'General support').trim().slice(0, 60);
  const name = String(b.name || (user && user.name) || 'Strap user').trim().slice(0, 100);
  if (!emailRe.test(email) || msg.length < 5) return [400, { ok: false, msg: 'Enter a valid email and a message of at least 5 characters.' }];
  if (!formInbox()) return [503, { ok: false, msg: 'Support email is not configured yet. Please try again later.' }];
  const wait = await actionBlocked(req, email, 'support');
  if (wait) return [429, { ok: false, msg: 'You have sent a message recently. Please wait before sending another.' }];
  await recordAction(req, email, 'support');
  const sent = await formSubmitSupport({ name, email, category, message: msg, _replyto: email, _url: (E.SITE_URL || 'https://strap60.vercel.app') + '/support.html' });
  if (!sent) return [502, { ok: false, msg: 'We could not send your message. Please try again shortly.' }];
  await q('insert into support_messages(user_id,email,kind,message) values($1,$2,$3,$4)', [user ? user.id : null, email, category, msg]);
  return [200, { ok: true, msg: 'Your message has been sent to Strap Support.' }];
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
    const user=await me(req), staff=user?null:await staffSession(req);
    const out = await h(req, res, user, staff);
    if (out === null) return;
    res.statusCode = out[0]; res.setHeader('Cache-Control', 'no-store'); res.json(out[1]);
  } catch (e) { console.error(e); res.statusCode = 500; res.json({ ok: false, msg: 'Server error. Try again.' }); }
};
