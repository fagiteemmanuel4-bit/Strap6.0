/* Strap backend (one Vercel function). Neon Auth handles accounts, passwords and the emailed codes.
   Neon Postgres stores app data + images. Only the "pg" package is needed. */
const { Pool } = require('pg');
const GiftRules = require('../gift-card-rules');
const crypto = require('crypto');
const createMcp = require('../mcp-server');
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
function currentStaffSalesOpen(state, staff) {
  const shift=(state.staffShifts||{})[staff.id]||{mode:'closed'}, mode=shift.mode||'closed';
  if(mode==='open') return true;
  if(mode!=='auto') return false;
  const valid=t=>/^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(t||''));
  if(!valid(shift.from)||!valid(shift.to)||shift.from===shift.to) return false;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const now=Number(parts.find(x=>x.type==='hour').value)*60+Number(parts.find(x=>x.type==='minute').value);
  const [oh,om]=shift.from.split(':').map(Number),[ch,cm]=shift.to.split(':').map(Number),start=oh*60+om,end=ch*60+cm;
  return start<end?(now>=start&&now<end):(now>=start||now<end);
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
H['neon-auth'] = async (req, res) => {
  const route = String(req.__strap_route || ''), prefix = 'neon-auth/';
  const authPath = route.startsWith(prefix) ? route.slice(prefix.length) : '';
  const allowed = new Set(['get-session','sign-in/email','sign-in/social','sign-out','oauth2/continue','oauth2/public-client','oauth2/public-client-prelogin','oauth2/consent']);
  if (!allowed.has(authPath)) { res.statusCode=404; return res.end('Not found'); }
  const base=String(E.NEON_AUTH_BASE_URL||'').replace(/\/$/,'');
  if(!base){res.statusCode=503;return res.end('Authentication is unavailable.');}
  const params=new URLSearchParams(String(req.url||'').split('?')[1]||'');params.delete('__strap_route');
  for(const [key,value] of Object.entries(req.query||{})){if(key==='__strap_route'||params.has(key)||value==null)continue;for(const item of Array.isArray(value)?value:[value])params.append(key,String(item));}
  const query=params.toString(), cookie=upCookie(req);
  try {
    const upstream=await fetch(base+'/'+authPath+(query?'?'+query:''),{
      method:req.method,
      headers:{'Content-Type':'application/json','Accept':req.headers.accept||'application/json',Origin:origin(req),...(cookie?{Cookie:cookie}:{})},
      body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body||{}),
      redirect:'manual'
    });
    const raw=await upstream.text(), setCookies=typeof upstream.headers.getSetCookie==='function'?upstream.headers.getSetCookie():[];
    if(setCookies.length){
      const jar=new Map(cookie.split(';').map(x=>x.trim()).filter(Boolean).map(x=>[x.slice(0,x.indexOf('=')),x]));
      for(const item of setCookies){const pair=item.split(';')[0],at=pair.indexOf('=');if(at<1)continue;const name=pair.slice(0,at),value=pair.slice(at+1);if(!value||/Max-Age=0/i.test(item))jar.delete(name);else jar.set(name,pair);}
      if(jar.size)mine(res,[...jar.values()]);else clearMine(res);
    }
    res.statusCode=upstream.status;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json; charset=utf-8');
    const location=upstream.headers.get('location');
    if(location){
      let target=location;
      try{
        if(location.startsWith('//')) target=new URL(base).protocol+location;
        else if(/^https?:\/\//i.test(location)) target=new URL(location).toString();
        else {
          const authBase=new URL(base), basePath=authBase.pathname.replace(/\/+$/,'');
          if(location.startsWith('/')){
            target=authBase.origin+(basePath&&(location===basePath||location.startsWith(basePath+'/'))?location:basePath+location);
          } else if(location.startsWith('?')||location.startsWith('#')) target=base+location;
          else target=base.replace(/\/+$/,'')+'/'+location.replace(/^\/+/, '');
        }
      }catch(_){}
      res.setHeader('Location',target);
    }
    res.end(raw);
  } catch(error) { console.error('Neon Auth OAuth proxy failed:',error.message);res.statusCode=502;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:'Could not reach Strap authentication.'})); }
};

/* OAuth 2.1 protected-resource metadata for MCP clients (RFC 9728). */
H['mcp/resource-metadata'] = async () => {
  const issuer = String(E.NEON_AUTH_BASE_URL || '').replace(/\/$/, '');
  if (!issuer) return [503, { error: 'authorization_server_unavailable' }];
  return [200, {
    resource: 'https://strap60.vercel.app/api/mcp',
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://strap60.vercel.app/MCP_SETUP.md'
  }];
};

const strapMcp = createMcp({ pool, premiumActive });
H['mcp'] = async (req, res) => { await strapMcp.handle(req, res); return null; };
H['mcp/keys'] = async (req, res, user) => { await strapMcp.manage(req, res, user); return null; };
H['mcp/approve'] = async (req, res, user) => { await strapMcp.approve(req, res, user); return null; };
/* ---- Premium access + Flutterwave (live/test mode selected by Vercel env) ---- */
let premiumSchemaReady;
async function ensurePremiumSchema() {
  if (!premiumSchemaReady) premiumSchemaReady=(async()=>{
    await q(`create table if not exists strap_subscriptions (
      user_id text primary key, status text not null default 'inactive',
      customer_email text not null, amount numeric(14,2) not null,
      currency text not null default 'NGN', tx_ref text,
      started_at timestamptz, expires_at timestamptz,
      updated_at timestamptz not null default now()
    )`);
    await q(`create table if not exists strap_payments (
      tx_ref text primary key, user_id text not null, amount numeric(14,2) not null,
      currency text not null default 'NGN', status text not null default 'pending',
      transaction_id text unique, created_at timestamptz not null default now(),
      verified_at timestamptz
    )`);
    await q('create index if not exists strap_payments_user_idx on strap_payments(user_id,created_at desc)');
    await q("alter table strap_subscriptions add column if not exists cancel_at_period_end boolean not null default false");
    await q("alter table strap_subscriptions add column if not exists cancelled_at timestamptz");
    await q("alter table strap_subscriptions add column if not exists welcome_seen boolean not null default false");
    await q(`create table if not exists strap_billing_preferences (
      user_id text primary key, email_enabled boolean not null default true,
      payment_success boolean not null default true, payment_failed boolean not null default true,
      renewal_reminders boolean not null default true, renewal_reminder_days integer[] not null default array[7,3,1],
      updated_at timestamptz not null default now()
    )`);
    await q(`create table if not exists strap_billing_email_log (
      id bigserial primary key, user_id text not null, event_key text not null unique,
      event_type text not null, recipient text not null, status text not null,
      provider_response text, created_at timestamptz not null default now()
    )`);
    await q(`create table if not exists strap_payment_reconciliation (
      id bigserial primary key, user_id text not null, tx_ref text not null,
      action text not null, outcome text not null, details jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )`);
    await q('create index if not exists strap_reconcile_user_idx on strap_payment_reconciliation(user_id,created_at desc)');
  })().catch(e=>{premiumSchemaReady=null;throw e;});
  return premiumSchemaReady;
}
const flwMode=()=>String(E.FLW_MODE||'test').toLowerCase();
const flwSecret=()=>String(E.FLW_SECRET_KEY||'').trim();
const flwPublicKey=()=>String(E.FLW_PUBLIC_KEY||'').trim();
const flwReady=()=>{const mode=flwMode(),key=flwSecret();return (mode==='live'&&key.startsWith('FLWSECK_LIVE-'))||(mode==='test'&&key.startsWith('FLWSECK_TEST-'));};
const flwPublicReady=()=>{const mode=flwMode(),key=flwPublicKey();return (mode==='live'&&key.startsWith('FLWPUBK_LIVE-'))||(mode==='test'&&key.startsWith('FLWPUBK_TEST-'));};
const premiumAmount=()=>{const n=Number(E.FLW_PREMIUM_AMOUNT_NGN);return Number.isFinite(n)&&n>0?Math.round(n*100)/100:0;};
const premiumStandardAmount=()=>{const n=Number(E.FLW_PREMIUM_STANDARD_AMOUNT_NGN||6000);return Number.isFinite(n)&&n>0?Math.round(n*100)/100:6000;};
async function premiumCheckoutAmount(userId) {
  const rows=await q("select count(*)::int as cycles from strap_payments where user_id=$1 and status='successful'",[String(userId)]);
  return Number(rows[0]&&rows[0].cycles||0)<3?premiumAmount():premiumStandardAmount();
}
async function premiumActive(userId) {
  await ensurePremiumSchema();
  const row=(await q("select 1 from strap_subscriptions where user_id=$1 and status='active' and expires_at>now() limit 1",[String(userId)]))[0];
  return !!row;
}
async function flwVerify(id) {
  const key=flwSecret();
  if(!flwReady()) throw new Error('Flutterwave credentials do not match the configured payment mode.');
  const response=await fetch('https://api.flutterwave.com/v3/transactions/'+encodeURIComponent(String(id))+'/verify',{headers:{Authorization:'Bearer '+key,Accept:'application/json'}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok || !body || body.status!=='success' || !body.data) throw new Error('Flutterwave could not verify this transaction.');
  return body.data;
}
async function activatePremium(payment, tx) {
  const amount=Number(payment.amount), paid=Number(tx.amount);
  if(String(tx.tx_ref)!==String(payment.tx_ref) || String(tx.status).toLowerCase()!=='successful' ||
     String(tx.currency).toUpperCase()!=='NGN' || String(payment.currency).toUpperCase()!=='NGN' ||
     !Number.isFinite(paid) || paid<amount) throw new Error('Payment details did not match the expected transaction.');
  await q("update strap_payments set status='successful',transaction_id=$2,verified_at=now() where tx_ref=$1",[payment.tx_ref,String(tx.id)]);
  await q(`insert into strap_subscriptions(user_id,status,customer_email,amount,currency,tx_ref,started_at,expires_at,updated_at,cancel_at_period_end,cancelled_at)
    values($1,'active',$2,$3,'NGN',$4,now(),now()+interval '30 days',now(),false,null)
    on conflict(user_id) do update set status='active',customer_email=excluded.customer_email,amount=excluded.amount,
    currency='NGN',tx_ref=excluded.tx_ref,
    started_at=case when strap_subscriptions.status='active' and strap_subscriptions.expires_at>now() then strap_subscriptions.started_at else now() end,
    expires_at=greatest(coalesce(strap_subscriptions.expires_at,now()),now())+interval '30 days',
    updated_at=now(),cancel_at_period_end=false,cancelled_at=null`,
    [payment.user_id,payment.customer_email||'',amount,payment.tx_ref]);
  const subscription=(await q('select expires_at from strap_subscriptions where user_id=$1',[payment.user_id]))[0];
  await billingPrefs(payment.user_id).catch(e=>console.error('Billing preferences initialization failed:',e.message));
  if(payment.customer_email) await sendBillingEmail(payment.user_id,'payment_success',{
    subject:'Your Strap Premium payment was successful',
    message:'Your Premium payment has been verified and your subscription is active.',
    amount,currency:'NGN',tx_ref:payment.tx_ref,paid_on:new Date().toISOString(),expires_at:subscription&&subscription.expires_at
  }).catch(e=>console.error('Billing confirmation email failed:',e.message));
}

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
  if (!first || !first.done) await sendWelcomeEmail(user.email,profile).catch(e=>console.error('Welcome email failed:',e.message));
  return [200, { ok: true }];
};


/* ---- staff accounts: owner-managed PIN identities and isolated staff sessions ---- */
H['staff/list'] = async (req,res,user,staff) => {
  if(!user || staff) return [403,{ok:false,msg:'Only the business owner can manage staff.'}];
  const ownerId=user.id;
  await migrateLegacyStaffForOwner(ownerId);
  const rows=await safeStaffRows(ownerId,null), stateRow=(await q('select blob from user_data where user_id=$1',[ownerId]))[0], state=parseStored(stateRow&&stateRow.blob&&stateRow.blob['ls:strap.v1'],{}), shifts=state.staffShifts||{}; return [200,{ok:true,staff:rows.map(x=>({...x,shift:shifts[x.id]||{mode:'closed',from:'',to:''}}))}];
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
H['staff/shift'] = async (req,res,user,staff) => {
  if(!user || staff) return [403,{ok:false,msg:'Only the business owner can manage staff sales hours.'}];
  const id=String(req.body.id||''), shift=req.body.shift||{};
  const target=(await q("select id::text as id,role from staff_accounts where id=$1::uuid and owner_id=$2 and status='active' limit 1",[id,user.id]))[0];
  if(!target) return [404,{ok:false,msg:'Staff account not found.'}];
  if(target.role!=='Cashier') return [400,{ok:false,msg:'Sales hours are only available for cashiers.'}];
  if(!['open','closed','auto'].includes(shift.mode)) return [400,{ok:false,msg:'Choose open, closed or automatic hours.'}];
  const valid=t=>typeof t==='string'&&/^([01]\\d|2[0-3]):[0-5]\\d$/.test(t);
  if(shift.mode==='auto'&&(!valid(shift.from)||!valid(shift.to)||shift.from===shift.to)) return [400,{ok:false,msg:'Choose valid, different opening and closing times.'}];
  const row=(await q('select blob from user_data where user_id=$1',[user.id]))[0], blob={...(row&&row.blob||{})}, state=parseStored(blob['ls:strap.v1'],{});
  state.staffShifts={...(state.staffShifts||{}),[id]:{mode:shift.mode,from:shift.from||'',to:shift.to||'',updatedAt:new Date().toISOString()}};
  blob['ls:strap.v1']=JSON.stringify(state);
  await q('insert into user_data(user_id,blob,updated_at) values($1,$2,now()) on conflict(user_id) do update set blob=$2,updated_at=now()',[user.id,blob]);
  return [200,{ok:true,shift:state.staffShifts[id]}];
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
  if(user && !await premiumActive(user.id)) return [403,{ok:false,code:'PREMIUM_REQUIRED',msg:'Sales require Strap Premium.'}];
  if(!user||staff)return [403,{ok:false,msg:'Only the business owner can manage cashier sales.'}];
  const applied=await applyStaffSalesSchedule(user.id);let {blob,state}=applied;
  if(req.method==='POST'){
    if(req.body.schedule&&typeof req.body.schedule==='object'){const sc=req.body.schedule,open=String(sc.open||''),close=String(sc.close||'');if(typeof sc.enabled!=='boolean'||(sc.enabled&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(open)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(close)||open===close)))return [400,{ok:false,msg:'Choose valid opening and closing times.'}];state.staffSalesSchedule={enabled:sc.enabled,open,close,timeZone:'Africa/Lagos'};}
    else{if(typeof req.body.open!=='boolean')return [400,{ok:false,msg:'Choose whether cashier sales should be open or closed.'}];state.staffSalesOpen=req.body.open;state.staffSalesOpenedAt=req.body.open?new Date().toISOString():null;if(req.body.open)state.closed=null;}
    blob['ls:strap.v1']=JSON.stringify(state);await q('insert into user_data(user_id,blob,updated_at) values($1,$2,now()) on conflict(user_id) do update set blob=$2,updated_at=now()',[user.id,blob]);
  }
  return [200,{ok:true,open:state.staffSalesOpen===true,schedule:state.staffSalesSchedule||{enabled:false,open:'08:00',close:'20:00',timeZone:'Africa/Lagos'}}];
};


/* Gift card redemption: lock the owner's blob row so simultaneous checkouts cannot spend the same balance. */
H['gift/redeem'] = async (req, res, user, staff) => {
  if(user && !await premiumActive(user.id)) return [403,{ok:false,code:'PREMIUM_REQUIRED',msg:'Gift cards require Strap Premium.'}];
  if(staff && !await premiumActive(staff.owner_id)) return [403,{ok:false,code:'PREMIUM_REQUIRED',msg:'Gift cards require Strap Premium.'}];
  if (!user && !(staff && staff.role === 'Cashier')) return [403, { ok:false, msg:'Only the store owner or a cashier can redeem gift cards.' }];
  const ownerId = staff ? staff.owner_id : user.id;
  if (staff) {
    const row = (await q('select blob from user_data where user_id=$1',[ownerId]))[0];
    const state = parseStored(row && row.blob && row.blob['ls:strap.v1'], {});
    if (!currentStaffSalesOpen(state, staff)) return [423,{ok:false,code:'SALES_SESSION_CLOSED',msg:'Your sales session is closed.'}];
  }
  const body=req.body||{}, cardId=String(body.cardId||''), code=String(body.code||'').trim().toUpperCase();
  const saleId=String(body.saleId||'').trim(), subtotal=Number(body.subtotal);
  if (!cardId || !code || !saleId || !Number.isFinite(subtotal) || subtotal<=0) return [400,{ok:false,code:'INVALID_REQUEST',msg:'The gift-card redemption details are incomplete.'}];
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const locked=await client.query('select blob from user_data where user_id=$1 for update',[ownerId]);
    if (!locked.rows.length) { await client.query('ROLLBACK'); return [404,{ok:false,code:'STORE_NOT_FOUND',msg:'Store data could not be found.'}]; }
    const blob=locked.rows[0].blob||{}, state=parseStored(blob['ls:strap.v1'],{}), gifts=Array.isArray(state.gift)?state.gift:[];
    const card=gifts.find(g=>String(g.id||'')===cardId && String(g.code||'').toUpperCase()===code);
    if (!card) { await client.query('ROLLBACK'); return [404,{ok:false,code:'NOT_FOUND',msg:'This gift card does not belong to this store.'}]; }
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const today=parts.find(x=>x.type==='year').value+'-'+parts.find(x=>x.type==='month').value+'-'+parts.find(x=>x.type==='day').value;
    const result=GiftRules.redeem(card,subtotal,saleId,today,Date.now());
    if (result.ok && body.method==='credit' && (Number(body.paidNow)||0)>=result.total) {
      await client.query('ROLLBACK');
      return [400,{ok:false,code:'CREDIT_PAID_IN_FULL',msg:'If they have paid in full, choose Cash, Card or Transfer instead.'}];
    }
    if (!result.ok) {
      if (result.code==='EXPIRED') {
        card.status='expired'; state.gift=gifts;
        blob['ls:strap.v1']=JSON.stringify(state);
        await client.query('update user_data set blob=$2::jsonb,updated_at=now() where user_id=$1',[ownerId,JSON.stringify(blob)]);
        await client.query('COMMIT');
      } else await client.query('ROLLBACK');
      return [result.code==='EXPIRED'?410:409,{ok:false,code:result.code,msg:result.message}];
    }
    if (!result.alreadyProcessed) {
      const index=gifts.findIndex(g=>String(g.id||'')===cardId);
      gifts[index]=result.card; state.gift=gifts;
      blob['ls:strap.v1']=JSON.stringify(state);
      await client.query('update user_data set blob=$2::jsonb,updated_at=now() where user_id=$1',[ownerId,JSON.stringify(blob)]);
    }
    await client.query('COMMIT');
    return [200,{ok:true,discount:result.discount,total:result.total,alreadyProcessed:!!result.alreadyProcessed,card:result.card}];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { client.release(); }
};

/* ---- app data: the whole dashboard state as one JSON per user ---- */

H['premium/status'] = async (req,res,user) => {
  if(!user) return [401,{ok:false,msg:'Please sign in again.'}];
  await ensurePremiumSchema();
  const row=(await q("select status,expires_at,amount,currency,tx_ref,welcome_seen from strap_subscriptions where user_id=$1 limit 1",[user.id]))[0];
  const active=!!(row&&row.status==='active'&&new Date(row.expires_at).getTime()>Date.now());
  // MCP reads subscription status from the same database; no separate sync helper is needed.
  const nextAmount=await premiumCheckoutAmount(user.id);
  const readiness={mode:flwMode(),secretConfigured:!!flwSecret(),secretModeMatch:flwReady(),publicKeyConfigured:!!flwPublicKey(),publicKeyModeMatch:flwPublicReady(),introductoryAmount:premiumAmount(),nextAmount};
  console.info('[premium-status] checkout readiness:',JSON.stringify(readiness));
  return [200,{ok:true,active,expiresAt:active?row.expires_at:null,welcomePending:active&&row.welcome_seen!==true,checkoutReady:readiness.secretModeMatch&&readiness.publicKeyModeMatch&&nextAmount>0,amount:nextAmount,introductoryAmount:premiumAmount(),standardAmount:premiumStandardAmount(),mode:flwMode()}];
};
H['premium/welcome-seen'] = async (req,res,user) => {
  if(!user) return [401,{ok:false,msg:'Please sign in again.'}];
  await ensurePremiumSchema();
  await q("update strap_subscriptions set welcome_seen=true,updated_at=now() where user_id=$1",[user.id]);
  return [200,{ok:true}];
};
H['premium/checkout'] = async (req,res,user) => {
  if(!user) return [401,{ok:false,msg:'Please sign in again.'}];
  if(!flwReady()||!flwPublicReady()) return [503,{ok:false,msg:'Flutterwave test credentials are incomplete. Check FLW_MODE, FLW_SECRET_KEY and FLW_PUBLIC_KEY.'}];
  await ensurePremiumSchema();
  const amount=await premiumCheckoutAmount(user.id);
  if(!amount) return [503,{ok:false,msg:'Premium pricing is currently paused. Set the introductory Premium amount when you are ready to charge.'}];
  const active=await premiumActive(user.id);
  if(active) return [409,{ok:false,msg:'Your Premium subscription is already active.'}];
  const txRef='STRAP-'+(flwMode()==='live'?'LIVE':'TEST')+'-'+crypto.randomBytes(12).toString('hex').toUpperCase();
  await q("insert into strap_payments (tx_ref,user_id,amount,currency,status) values ($1,$2,$3,'NGN','pending')",[txRef,user.id,amount]);
  console.info('[premium-checkout] Inline session prepared:',JSON.stringify({mode:flwMode(),amount,currency:'NGN',txRef,publicKeyConfigured:flwPublicReady()}));
  return [200,{ok:true,method:'inline',public_key:flwPublicKey(),tx_ref:txRef,amount,currency:'NGN',
    customer:{email:user.email,name:user.name||'Strap customer'}}];
};
H['premium/verify'] = async (req,res,user) => {
  if(!user) return [401,{ok:false,msg:'Please sign in again.'}];
  const txRef=String(req.body.tx_ref||'').trim(), id=String(req.body.transaction_id||'').trim();
  if(!txRef||!/^\d+$/.test(id)) return [400,{ok:false,msg:'The payment reference is incomplete.'}];
  await ensurePremiumSchema();
  const payment=(await q("select tx_ref,user_id,amount,currency,status from strap_payments where tx_ref=$1 and user_id=$2 limit 1",[txRef,user.id]))[0];
  if(!payment) return [404,{ok:false,msg:'We could not find this payment.'}];
  if(payment.status==='successful') {
    const active=await premiumActive(user.id),sub=(await q('select expires_at from strap_subscriptions where user_id=$1',[user.id]))[0]||{};
    const account=(await q('select email,profile from app_users where id=$1',[user.id]))[0]||{};
    const receiptNo='STR-'+String(txRef).replace(/[^a-zA-Z0-9]/g,'').slice(-14).toUpperCase();
    return [200,{ok:true,active,alreadyProcessed:true,receipt:{receipt_no:receiptNo,amount:Number(payment.amount),currency:'NGN',paid_on:payment.verified_at||new Date().toISOString(),next_billing_date:sub.expires_at||null,tx_ref:txRef,user_name:String(account.profile&&(account.profile.name||account.profile.full_name)||'Thank you'),store_name:String(account.profile&&account.profile.bizname||'your business'),to_email:String(account.email||'')}}];
  }
  try {
    const tx=await flwVerify(id);
    await activatePremium({...payment,customer_email:user.email},tx);
    const sub=(await q('select expires_at from strap_subscriptions where user_id=$1',[user.id]))[0]||{};
    const receiptNo='STR-'+String(txRef).replace(/[^a-zA-Z0-9]/g,'').slice(-14).toUpperCase();
    const account=(await q('select email,profile from app_users where id=$1',[user.id]))[0]||{};
    return [200,{ok:true,active:true,receipt:{receipt_no:receiptNo,amount:Number(payment.amount),currency:'NGN',paid_on:new Date().toISOString(),next_billing_date:sub.expires_at||null,tx_ref:txRef,user_name:String(account.profile&&(account.profile.name||account.profile.full_name)||'Thank you'),store_name:String(account.profile&&account.profile.bizname||'your business'),to_email:String(account.email||'')}}];
  } catch(e) { console.error('Premium verification failed:',e.message); return [402,{ok:false,msg:'Payment is not confirmed yet. If you were charged, wait a moment and refresh this page.'}]; }
};
H['flutterwave/webhook'] = async (req,res) => {
  const expected=String(E.FLW_WEBHOOK_SECRET_HASH||''), received=String(req.headers['verif-hash']||'');
  if(!expected||!received||Buffer.byteLength(expected)!==Buffer.byteLength(received)||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(received))) return [401,{ok:false}];
  const event=req.body&&req.body.event, id=req.body&&req.body.data&&req.body.data.id;
  if(event!=='charge.completed'||!id) return [200,{ok:true,ignored:true}];
  try {
    await ensurePremiumSchema();
    const tx=await flwVerify(id), txRef=String(tx.tx_ref||'');
    let payment=(await q('select tx_ref,user_id,amount,currency,status from strap_payments where tx_ref=$1 limit 1',[txRef]))[0];
    if(!payment && tx.customer && tx.customer.email) {
      const owner=(await q('select id,email from app_users where lower(email)=lower($1) and deleted_at is null limit 1',[String(tx.customer.email)]))[0];
      if(owner) {
        const sub=(await q("select amount,currency from strap_subscriptions where user_id=$1 and status='active' limit 1",[owner.id]))[0];
        if(sub && Number(sub.amount)===Number(tx.amount) && String(tx.currency).toUpperCase()==='NGN') {
          await q("insert into strap_payments(tx_ref,user_id,amount,currency,status) values($1,$2,$3,'NGN','pending') on conflict(tx_ref) do nothing",[txRef,owner.id,Number(tx.amount)]);
          payment={tx_ref:txRef,user_id:owner.id,amount:sub.amount,currency:sub.currency,status:'pending'};
        }
      }
    }
    if(payment && payment.status!=='successful') {
      const u=(await q('select email from app_users where id=$1 and deleted_at is null',[payment.user_id]))[0];
      await activatePremium({...payment,customer_email:u&&u.email||''},tx);
    }
    return [200,{ok:true}];
  } catch(e) { console.error('Flutterwave webhook processing failed:',e.message); return [500,{ok:false}]; }
};


/* ---- Billing, receipts, subscription management and EmailJS notifications ---- */
async function billingPrefs(userId) {
  await ensurePremiumSchema();
  const rows=await q('select * from strap_billing_preferences where user_id=$1',[userId]);
  if(rows[0]) return rows[0];
  return (await q(`insert into strap_billing_preferences(user_id) values($1)
    on conflict(user_id) do update set user_id=excluded.user_id returning *`,[userId]))[0];
}
async function sendWelcomeEmail(to,profile={}) {
  const templateId=String(E.EMAILJS_WELCOME_TEMPLATE_ID||'').trim();
  if(!templateId) return mail(to,`Welcome to ${APP}`,wrap(`Welcome, ${esc(String(profile.name||'').split(' ')[0]||'there')}!`,`<p>Your ${esc(APP)} account for <b>${esc(profile.bizname||'your business')}</b> is ready.</p><p>Need help? Reply to this email.</p>`));
  const name=String(profile.name||'Strap customer');
  const response=await fetch('https://api.emailjs.com/api/v1.0/email/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service_id:String(E.EMAILJS_SERVICE_ID||'').trim(),template_id:templateId,user_id:String(E.EMAILJS_PUBLIC_KEY||'').trim(),template_params:{to_email:to,to_name:name,user_name:name,store_name:String(profile.bizname||'your business'),business_name:String(profile.bizname||'your business'),dashboard_url:'https://strap60.vercel.app/dashboard.html',subject:'Welcome to Strap'}})});
  const body=await response.text();
  if(!response.ok) throw new Error('EmailJS welcome email failed ('+response.status+'): '+body.slice(0,300));
  return true;
}
function emailJsReady() {
  return !!(String(E.EMAILJS_SERVICE_ID||'').trim() && String(E.EMAILJS_TEMPLATE_ID||'').trim() && String(E.EMAILJS_PUBLIC_KEY||'').trim());
}
function receiptPdfBase64(data={}) {
  const clean=v=>String(v==null?'—':v).normalize('NFKD').replace(/[^\x20-\x7E]/g,'').slice(0,110);
  const escPdf=v=>clean(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const lines=[
    ['STRAP',22],['PAYMENT RECEIPT',13],['',10],
    ['Receipt number: '+clean(data.receipt_no),11],
    ['Customer: '+clean(data.user_name),11],
    ['Business: '+clean(data.store_name),11],
    ['Plan: Strap Premium',11],
    ['Amount paid: NGN '+Number(data.amount||0).toLocaleString('en-NG'),14],
    ['Paid on: '+clean(data.paid_on),11],
    ['Next billing: '+clean(data.next_billing_date),11],
    ['Transaction reference: '+clean(data.tx_ref),9],
    ['',10],['Payment verified by Strap',11],
    ['Keep this receipt for your records.',9]
  ];
  let y=750, stream='0.04 0.04 0.04 rg\n';
  for(const [line,size] of lines){if(!line){y-=14;continue;}stream+='BT /F1 '+size+' Tf 48 '+y+' Td ('+escPdf(line)+') Tj ET\n';y-=size+18;}
  stream+='0.90 0.96 0.23 rg 48 700 90 4 re f\n';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length '+Buffer.byteLength(stream,'ascii')+' >>\nstream\n'+stream+'endstream'
  ];
  let pdf='%PDF-1.4\n', offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,'ascii'));pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
  const xref=Buffer.byteLength(pdf,'ascii');
  pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  return Buffer.from(pdf,'ascii').toString('base64');
}
async function sendBillingEmail(userId,eventType,payload={},options={}) {
  if(!emailJsReady()) return {ok:false,skipped:true,reason:'EmailJS is not configured'};
  const prefs=await billingPrefs(userId);
  if(!options.force && !prefs.email_enabled) return {ok:false,skipped:true,reason:'Email notifications are disabled'};
  if(!options.force && eventType==='payment_success' && !prefs.payment_success) return {ok:false,skipped:true,reason:'Payment confirmations are disabled'};
  if(!options.force && eventType==='payment_failed' && !prefs.payment_failed) return {ok:false,skipped:true,reason:'Payment failure alerts are disabled'};
  const user=(await q('select email,profile from app_users where id=$1 and deleted_at is null',[userId]))[0];
  if(!user||!user.email) return {ok:false,skipped:true,reason:'No account email'};
  const profile=user.profile||{}, name=String(profile.name||profile.full_name||'Strap customer');
  const eventKey=String(options.eventKey||eventType+':'+(payload.tx_ref||payload.expires_at||Date.now()));
  const claimed=await q(`insert into strap_billing_email_log(user_id,event_key,event_type,recipient,status)
    values($1,$2,$3,$4,'sending') on conflict(event_key) do nothing returning id`,[userId,eventKey,eventType,user.email]);
  if(!claimed.length) {
    const log=(await q('select status from strap_billing_email_log where event_key=$1',[eventKey]))[0];
    if(log&&(log.status==='sent'||log.status==='sending')) return {ok:log.status==='sent',alreadySent:log.status==='sent',inProgress:log.status==='sending'};
    await q("update strap_billing_email_log set status='sending',provider_response=null where event_key=$1",[eventKey]);
  }
  const paidAt=payload.paid_on?new Date(payload.paid_on):new Date();
  const receiptNo=String(payload.receipt_no||('STR-'+String(payload.tx_ref||eventKey).replace(/[^a-zA-Z0-9]/g,'').slice(-14).toUpperCase()));
  const expiry=payload.expires_at?new Date(payload.expires_at):null;
  const params={
    to_email:user.email,to_name:name,user_name:name,subject:String(payload.subject||'A billing update from Strap'),
    message:String(payload.message||''),event_type:eventType,amount:'₦'+Number(payload.amount||0).toLocaleString('en-NG'),
    currency:String(payload.currency||'NGN'),tx_ref:String(payload.tx_ref||''),receipt_no:receiptNo,
    paid_on:paidAt.toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'}),
    plan_name:'Strap Premium',next_billing_date:expiry?expiry.toLocaleDateString('en-NG',{dateStyle:'medium'}):'See your Billing overview',
    receipt_filename:receiptNo+'.pdf',receipt_pdf:receiptPdfBase64({receipt_no:receiptNo,user_name:name,store_name:profile.bizname||'your business',amount:payload.amount,currency:payload.currency,paid_on:paidAt.toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'}),next_billing_date:expiry?expiry.toLocaleDateString('en-NG',{dateStyle:'medium'}):'See your Billing overview',tx_ref:payload.tx_ref}),store_name:String(profile.bizname||'your business'),
    support_email:String(E.SUPPORT_EMAIL||'support@strap60.vercel.app'),
    dashboard_url:'https://strap60.vercel.app/#billing-overview',
    expires_at:expiry?expiry.toLocaleString('en-NG',{dateStyle:'medium'}):'',
    business_name:String(profile.bizname||'Your Strap business'),
    action_url:'https://strap60.vercel.app/#billing-overview'
  };
  const templateId=eventType==='payment_success'
    ? String(E.EMAILJS_PREMIUM_RECEIPT_TEMPLATE_ID||E.EMAILJS_TEMPLATE_ID||'').trim()
    : String(E.EMAILJS_TEMPLATE_ID||'').trim();
  try {
    const response=await fetch('https://api.emailjs.com/api/v1.0/email/send',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({service_id:String(E.EMAILJS_SERVICE_ID).trim(),template_id:templateId,user_id:String(E.EMAILJS_PUBLIC_KEY).trim(),template_params:params})
    });
    const body=await response.text();
    await q('update strap_billing_email_log set status=$2,provider_response=$3 where event_key=$1',[eventKey,response.ok?'sent':'failed',body.slice(0,1200)]);
    if(!response.ok) throw new Error('EmailJS rejected the email ('+response.status+').');
    return {ok:true};
  } catch(error) {
    await q('update strap_billing_email_log set status=\'failed\',provider_response=$2 where event_key=$1',[eventKey,String(error.message||error).slice(0,1200)]).catch(()=>[]);
    throw error;
  }
}
function paymentRow(row) {
  return {tx_ref:row.tx_ref,amount:Number(row.amount),currency:row.currency,status:row.status,transaction_id:row.transaction_id||null,created_at:row.created_at,verified_at:row.verified_at||null};
}
H['billing/overview'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  await ensurePremiumSchema();
  const sub=(await q('select status,amount,currency,tx_ref,started_at,expires_at,cancel_at_period_end,cancelled_at from strap_subscriptions where user_id=$1',[user.id]))[0]||null;
  const totals=(await q(`select count(*)::int as total,
    count(*) filter(where status='successful')::int as successful,
    count(*) filter(where status='pending')::int as pending,
    count(*) filter(where status='failed')::int as failed,
    coalesce(sum(amount) filter(where status='successful'),0)::numeric as paid
    from strap_payments where user_id=$1`,[user.id]))[0]||{};
  const next=await premiumCheckoutAmount(user.id),prefs=await billingPrefs(user.id);
  return [200,{ok:true,subscription:sub,totals:{total:Number(totals.total||0),successful:Number(totals.successful||0),pending:Number(totals.pending||0),failed:Number(totals.failed||0),paid:Number(totals.paid||0)},nextAmount:next,emailConfigured:emailJsReady(),preferences:{email_enabled:prefs.email_enabled,renewal_reminders:prefs.renewal_reminders,renewal_reminder_days:prefs.renewal_reminder_days}}];
};
H['billing/payments'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  await ensurePremiumSchema();
  const status=String(req.query.status||'').toLowerCase(),limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
  const rows=await q(`select tx_ref,amount,currency,status,transaction_id,created_at,verified_at
    from strap_payments where user_id=$1 and ($2='' or status=$2)
    order by created_at desc limit $3`,[user.id,status,limit]);
  return [200,{ok:true,payments:rows.map(paymentRow)}];
};
H['billing/payment'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  await ensurePremiumSchema();
  const ref=String(req.query.tx_ref||req.body.tx_ref||'').trim();
  if(!ref) return [400,{ok:false,msg:'Payment reference is required.'}];
  const row=(await q('select tx_ref,amount,currency,status,transaction_id,created_at,verified_at from strap_payments where user_id=$1 and tx_ref=$2',[user.id,ref]))[0];
  if(!row) return [404,{ok:false,msg:'Payment receipt not found.'}];
  return [200,{ok:true,payment:paymentRow(row)}];
};
H['billing/subscription'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  await ensurePremiumSchema();
  if(req.method==='PUT') {
    const cancel=!!req.body.cancel_at_period_end;
    const row=(await q(`update strap_subscriptions set cancel_at_period_end=$2,
      cancelled_at=case when $2 then coalesce(cancelled_at,now()) else null end,updated_at=now()
      where user_id=$1 returning status,amount,currency,tx_ref,started_at,expires_at,cancel_at_period_end,cancelled_at`,[user.id,cancel]))[0];
    if(!row) return [404,{ok:false,msg:'No Premium subscription was found.'}];
    return [200,{ok:true,subscription:row}];
  }
  const row=(await q('select status,amount,currency,tx_ref,started_at,expires_at,cancel_at_period_end,cancelled_at from strap_subscriptions where user_id=$1',[user.id]))[0]||null;
  return [200,{ok:true,subscription:row,renewal:'manual'}];
};
H['billing/renew'] = async (req,res,user) => {
  if(!user) return [401,{ok:false,msg:'Please sign in again.'}];
  if(!flwReady()||!flwPublicReady()) return [503,{ok:false,msg:'Secure payment is unavailable. Check Flutterwave test credentials.'}];
  await ensurePremiumSchema();
  const amount=await premiumCheckoutAmount(user.id);
  if(!amount) return [503,{ok:false,msg:'Premium pricing is currently paused.'}];
  const txRef='STRAP-'+(flwMode()==='live'?'LIVE':'TEST')+'-RENEW-'+crypto.randomBytes(10).toString('hex').toUpperCase();
  await q("insert into strap_payments(tx_ref,user_id,amount,currency,status) values($1,$2,$3,'NGN','pending')",[txRef,user.id,amount]);
  return [200,{ok:true,method:'inline',public_key:flwPublicKey(),tx_ref:txRef,amount,currency:'NGN',customer:{email:user.email,name:user.name||'Strap customer'}}];
};
H['billing/notifications'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  const prefs=await billingPrefs(user.id);
  if(req.method==='PUT') {
    const days=Array.isArray(req.body.renewal_reminder_days)?[...new Set(req.body.renewal_reminder_days.map(Number).filter(n=>[1,3,7,14].includes(n)))]:prefs.renewal_reminder_days;
    const row=(await q(`insert into strap_billing_preferences(user_id,email_enabled,payment_success,payment_failed,renewal_reminders,renewal_reminder_days,updated_at)
      values($1,$2,$3,$4,$5,$6,now()) on conflict(user_id) do update set
      email_enabled=excluded.email_enabled,payment_success=excluded.payment_success,payment_failed=excluded.payment_failed,
      renewal_reminders=excluded.renewal_reminders,renewal_reminder_days=excluded.renewal_reminder_days,updated_at=now() returning *`,
      [user.id,req.body.email_enabled!==false,req.body.payment_success!==false,req.body.payment_failed!==false,req.body.renewal_reminders!==false,days]))[0];
    return [200,{ok:true,preferences:row,emailConfigured:emailJsReady()}];
  }
  const recentEmails=await q('select event_type,status,recipient,created_at,provider_response from strap_billing_email_log where user_id=$1 order by created_at desc limit 20',[user.id]);
  return [200,{ok:true,preferences:prefs,emailConfigured:emailJsReady(),recentEmails}];
};
H['billing/email-test'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  if(!emailJsReady()) return [503,{ok:false,msg:'EmailJS is not configured. Add the EmailJS service, template and public key in Vercel.'}];
  try { await sendBillingEmail(user.id,'test',{subject:'Your Strap billing email is ready',message:'This is a test of your Strap billing email notifications.'},{force:true,eventKey:'test:'+user.id+':'+Date.now()}); return [200,{ok:true,msg:'Test email sent. Check your inbox.'}]; }
  catch(e) { return [502,{ok:false,msg:e.message||'EmailJS could not send the test email.'}]; }
};
H['billing/payment-failed'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  await ensurePremiumSchema();
  const ref=String(req.body.tx_ref||'').trim(),reason=String(req.body.reason||'Payment was not completed.').slice(0,180);
  if(!ref) return [400,{ok:false}];
  const payment=(await q('select tx_ref,amount,currency,status from strap_payments where tx_ref=$1 and user_id=$2',[ref,user.id]))[0];
  if(!payment) return [404,{ok:false}];
  if(payment.status==='successful') return [200,{ok:true,alreadySuccessful:true}];
  await q("update strap_payments set status='failed' where tx_ref=$1 and user_id=$2 and status='pending'",[ref,user.id]);
  await q("insert into strap_payment_reconciliation(user_id,tx_ref,action,outcome,details) values($1,$2,'checkout_callback','failed',$3::jsonb)",[user.id,ref,JSON.stringify({reason})]);
  await sendBillingEmail(user.id,'payment_failed',{subject:'Your Strap Premium payment was not completed',message:'Your checkout was not completed. No Premium access was added. You can safely try again from Billing.',amount:Number(payment.amount),currency:payment.currency,tx_ref:ref}).catch(e=>console.error('Payment failure email failed:',e.message));
  return [200,{ok:true}];
};
H['billing/reconcile'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  await ensurePremiumSchema();
  if(req.method==='POST') {
    const ref=String(req.body.tx_ref||'').trim(),id=String(req.body.transaction_id||'').trim();
    if(!ref||!/^[0-9]+$/.test(id)) return [400,{ok:false,msg:'Enter the payment reference and Flutterwave transaction ID.'}];
    const payment=(await q('select tx_ref,user_id,amount,currency,status from strap_payments where tx_ref=$1 and user_id=$2',[ref,user.id]))[0];
    if(!payment) return [404,{ok:false,msg:'Payment reference was not found in your account.'}];
    if(payment.status==='successful') return [200,{ok:true,msg:'This payment is already verified.'}];
    try {
      const tx=await flwVerify(id);
      await activatePremium({...payment,customer_email:user.email},tx);
      await q("insert into strap_payment_reconciliation(user_id,tx_ref,action,outcome,details) values($1,$2,'manual_verify','successful',$3::jsonb)",[user.id,ref,JSON.stringify({transaction_id:id})]);
      return [200,{ok:true,msg:'Payment verified successfully. Your Premium access has been updated.'}];
    } catch(e) {
      await q("insert into strap_payment_reconciliation(user_id,tx_ref,action,outcome,details) values($1,$2,'manual_verify','not_verified',$3::jsonb)",[user.id,ref,JSON.stringify({transaction_id:id,reason:String(e.message||e).slice(0,200)})]);
      return [402,{ok:false,msg:'Flutterwave could not confirm this transaction. Check the ID and try again.'}];
    }
  }
  const rows=await q(`select tx_ref,amount,currency,status,transaction_id,created_at,verified_at
    from strap_payments where user_id=$1 order by created_at desc limit 100`,[user.id]);
  const audits=await q('select tx_ref,action,outcome,created_at from strap_payment_reconciliation where user_id=$1 order by created_at desc limit 30',[user.id]);
  return [200,{ok:true,payments:rows.map(paymentRow),events:audits}];
};
H['billing/cron'] = async (req,res) => {
  const secret=String(E.CRON_SECRET||'').trim(),auth=String(req.headers.authorization||'');
  if(!secret||auth!=='Bearer '+secret) return [401,{ok:false}];
  if(!emailJsReady()) return [200,{ok:true,skipped:true,reason:'EmailJS is not configured yet.'}];
  await ensurePremiumSchema();
  const due=await q(`select s.user_id,s.customer_email,s.amount,s.currency,s.tx_ref,s.expires_at,
    p.renewal_reminder_days,p.renewal_reminders,p.email_enabled
    from strap_subscriptions s join strap_billing_preferences p on p.user_id=s.user_id
    where s.status='active' and s.expires_at::date between current_date and current_date+14
      and p.email_enabled=true and p.renewal_reminders=true
      and (s.expires_at::date-current_date)=any(p.renewal_reminder_days)`);
  let sent=0,failed=0;
  for(let index=0;index<due.length;index++) {
    const row=due[index];
    if(index) await new Promise(resolve=>setTimeout(resolve,1100)); // EmailJS allows one request per second.
    try {
      const days=Math.max(0,Math.ceil((new Date(row.expires_at).getTime()-Date.now())/86400000));
      await sendBillingEmail(row.user_id,'renewal_reminder',{subject:days?'Your Strap Premium renews soon':'Your Strap Premium expires today',
        message:days?'Your Premium access expires in '+days+' day(s). Renew before expiry to keep using all Premium tools.':'Your Strap Premium access expires today. Renew to keep your Premium tools available.',
        amount:Number(row.amount),currency:row.currency,tx_ref:row.tx_ref,expires_at:row.expires_at},
        {eventKey:'renewal:'+row.user_id+':'+new Date(row.expires_at).toISOString().slice(0,10)});
      sent++;
    } catch(e) { failed++; console.error('Billing reminder failed:',row.user_id,e.message); }
  }
  return [200,{ok:true,matched:due.length,sent,failed}];
};

H['data'] = async (req, res, user, staff) => {
  if (!user && !staff) return [401, { ok: false }];
  const ownerId=staff?staff.owner_id:user.id;
  if (req.method === 'PUT') {
    const b=req.body.blob; if(!b||typeof b!=='object') return [400,{ok:false}];
    if(staff) {
      if(!await premiumActive(ownerId)) return [403,{ok:false,code:'PREMIUM_REQUIRED',msg:'Staff business access requires Strap Premium.'}];
      if(staff.role==='Cashier') {
        const row=(await q('select blob from user_data where user_id=$1',[ownerId]))[0], state=parseStored(row&&row.blob&&row.blob['ls:strap.v1'],{});
        if(!currentStaffSalesOpen(state,staff))return [423,{ok:false,code:'SALES_SESSION_CLOSED',msg:'Your sales session is closed or outside your scheduled hours.'}];
      }
      await staffWriteBlob(ownerId,staff,b); return [200,{ok:true}];
    }

    await ensurePremiumSchema();
    const paid=await premiumActive(ownerId);
    const oldRow=(await q('select blob from user_data where user_id=$1',[ownerId]))[0], oldBlob=oldRow&&oldRow.blob||{};
    const nextState=parseStored(b['ls:strap.v1'],{}), oldState=parseStored(oldBlob['ls:strap.v1'],{});
    const count=(x)=>Array.isArray(x)?x.length:0;
    const hasNew=(nextRows,oldRows)=>{const key=x=>String(x&&(x.id||x.code||x.no||x.ref)||JSON.stringify(x));const seen=new Set((Array.isArray(oldRows)?oldRows:[]).map(key));return (Array.isArray(nextRows)?nextRows:[]).some(x=>{const k=key(x);if(seen.has(k))return false;seen.add(k);return true;});};
    if(!paid) {
      if(hasNew(nextState.sales,oldState.sales)||hasNew(nextState.payments,oldState.payments)||
         hasNew(nextState.gift,oldState.gift)||hasNew(nextState.collections,oldState.collections))
        return [403,{ok:false,code:'PREMIUM_REQUIRED',msg:'Sales, gift cards and collections require Strap Premium.'}];
      const nextF1=parseStored(b['ls:strap.f1'],{}), oldF1=parseStored(oldBlob['ls:strap.f1'],{});
      if(hasNew(nextF1.mcp,oldF1.mcp)||hasNew((nextF1.branches||[]).filter(x=>String(x&&x.id)!=='b0'),(oldF1.branches||[]).filter(x=>String(x&&x.id)!=='b0'))||hasNew(nextF1.staff,oldF1.staff))
        return [403,{ok:false,code:'PREMIUM_REQUIRED',msg:'MCP, branches and staff require Strap Premium.'}];
      const collectProducts=(blob)=>{const out=[];for(const [key,value] of Object.entries(blob||{}))if(key.startsWith('ls:strap.f1.items.'))out.push(...(Array.isArray(parseStored(value,[]))?parseStored(value,[]):[]));return out;};
      const oldProducts=collectProducts(oldBlob), nextProducts=collectProducts(b), oldIds=new Set(oldProducts.map(p=>String(p&&p.id||'')));
      const oldById=new Map(oldProducts.filter(p=>p&&p.id).map(p=>[String(p.id),p]));
      const addedProducts=nextProducts.filter(p=>p&&!oldIds.has(String(p.id||'')));
      if((oldProducts.length<=30&&nextProducts.length>30)||(oldProducts.length>30&&addedProducts.length>0))
        return [403,{ok:false,code:'PRODUCT_LIMIT',msg:'The free plan allows up to 30 products. Existing products are preserved; upgrade to Premium to add more.'}];
      const stockChanged=nextProducts.some(p=>{
        if(!p||!p.id||!oldById.has(String(p.id))) return false;
        const old=oldById.get(String(p.id));
        return Number(old.qty||0)!==Number(p.qty||0)||!!old.tracked!==!!p.tracked;
      });
      if(stockChanged) return [403,{ok:false,code:'PREMIUM_REQUIRED',msg:'Inventory and stock adjustments require Strap Premium.'}];
    }
    const clean=await safeOwnerBlob(ownerId,b);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('insert into user_data(user_id,blob,updated_at) values($1,$2::jsonb,now()) on conflict(user_id) do nothing',[ownerId,'{}']);
      const locked=await client.query('select blob from user_data where user_id=$1 for update',[ownerId]);
      const currentBlob=locked.rows[0]&&locked.rows[0].blob||{};
      if(!clean['ss:strap.session']&&currentBlob['ss:strap.session']) clean['ss:strap.session']=currentBlob['ss:strap.session'];
      const incomingState=parseStored(clean['ls:strap.v1'],{}), currentState=parseStored(currentBlob['ls:strap.v1'],{});
      if(Array.isArray(incomingState.gift)) {
        const previous=Array.isArray(currentState.gift)?currentState.gift:[];
        incomingState.gift=incomingState.gift.map(next=>{
          const old=previous.find(card=>String(card.id||'')===String(next.id||'')||String(card.code||'').toUpperCase()===String(next.code||'').toUpperCase());
          if(!old) return next;
          const merged={...old,...next};
          if((next.type||old.type||'value')==='value') {
            const before=Number(old.balance??old.value), after=Number(next.balance??next.value);
            if(Number.isFinite(before)&&Number.isFinite(after)) merged.balance=Math.min(before,after);
          }
          if(['redeemed','expired','revoked'].includes(String(old.status||'').toLowerCase())) merged.status=old.status;
          const seen=new Set(), redemptions=[];
          for(const entry of [...(Array.isArray(old.redemptions)?old.redemptions:[]),...(Array.isArray(next.redemptions)?next.redemptions:[])]) {
            const id=String(entry&&entry.saleId||''); if(!id||seen.has(id)) continue; seen.add(id); redemptions.push(entry);
          }
          merged.redemptions=redemptions.slice(-200);
          if(Number(old.lastRedeemedAt)>Number(next.lastRedeemedAt)) { merged.lastRedeemedAt=old.lastRedeemedAt; merged.lastSaleId=old.lastSaleId; }
          return merged;
        });
        clean['ls:strap.v1']=JSON.stringify(incomingState);
      }
      await client.query('update user_data set blob=$2::jsonb,updated_at=now() where user_id=$1',[ownerId,JSON.stringify(clean)]);
      await client.query('COMMIT');
    } catch(error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally { client.release(); }
    return [200,{ok:true}];
  }
  if(staff) {
    const row=(await q('select blob from user_data where user_id=$1',[ownerId]))[0],blob=row?row.blob:{},state=parseStored(blob['ls:strap.v1'],{});
    const visible=staffReadBlob(blob,staff);
    if(staff.role==='Cashier'){const v=parseStored(visible['ls:strap.v1'],{});v.staffSalesOpen=currentStaffSalesOpen(state,staff);visible['ls:strap.v1']=JSON.stringify(v);}
    return [200,{ok:true,blob:visible,staff:{id:staff.id,name:staff.name,role:staff.role,branchId:staff.branch_id,email:staff.email,defaultRoute:staff.access.defaultRoute,allowedRoutes:staff.access.allowedRoutes,bizname:(staff.profile||{}).bizname||'My Store',currency:(staff.profile||{}).currency||'NGN'}}];
  }
  await migrateLegacyStaffForOwner(ownerId);
  const r=await q('select blob from user_data where user_id=$1',[ownerId]);
  return [200,{ok:true,blob:await safeOwnerBlob(ownerId,r[0]?r[0].blob:{})}];
};

/* ---- storefront APIs: bank transfer proof is reviewed manually; no gateway or card processing ---- */
const storeSlugify = v => lower(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50);
const storeReserved = new Set(['api','admin','dashboard','login','signup','settings','orders','products','checkout','cart','store','support','legal','privacy','terms','mcp']);
const storeOwner = async id => (await q('select * from stores where owner_id=$1 limit 1',[id]))[0] || null;
const storePublic = async slug => (await q("select * from stores where slug=$1 and status='published' limit 1",[lower(slug)]))[0] || null;
const storeSettings = v => {
  const s=v&&typeof v==='object'&&!Array.isArray(v)?v:{}, b=s.bankTransfer&&typeof s.bankTransfer==='object'?s.bankTransfer:{};
  return {description:String(s.description||'').slice(0,500),logoUrl:String(s.logoUrl||'').slice(0,500),bannerUrl:String(s.bannerUrl||'').slice(0,500),
    phone:String(s.phone||'').slice(0,40),email:lower(s.email||'').slice(0,160),address:String(s.address||'').slice(0,300),
    announcement:String(s.announcement||'').slice(0,180),deliveryFee:Math.max(0,Math.min(1e8,Number(s.deliveryFee)||0)),
    bankTransfer:{bankName:String(b.bankName||'').trim().slice(0,100),accountNumber:String(b.accountNumber||'').replace(/\s/g,'').slice(0,30),
      accountName:String(b.accountName||'').trim().slice(0,120),instructions:String(b.instructions||'').trim().slice(0,500)},
    seoTitle:String(s.seoTitle||'').slice(0,120),seoDescription:String(s.seoDescription||'').slice(0,300),customDomainStatus:'coming_soon'};
};
H['storefront'] = async (req,res,user) => {
  if(!user) return [401,{ok:false,msg:'Sign in to manage your storefront.'}];
  const current=await storeOwner(user.id);
  if(req.method==='GET') return [200,{ok:true,store:current?{...current,settings:storeSettings(current.settings)}:null}];
  if(!['POST','PATCH'].includes(req.method)) return [405,{ok:false}];
  const b=req.body||{}, name=String(b.name||current&&current.name||'').trim().slice(0,100);
  const slug=storeSlugify(b.slug||current&&current.slug||name), currency=String(b.currency||current&&current.currency||'NGN').toUpperCase();
  if(name.length<2||slug.length<3||storeReserved.has(slug)||!/^[A-Z]{3}$/.test(currency)) return [400,{ok:false,msg:'Enter a valid store name, address and currency.'}];
  const settings=storeSettings(b.settings||current&&current.settings||{}), status=b.status==='published'?'published':b.status==='paused'?'paused':(current&&current.status==='published'?'published':'draft');
  try {
    const row=(await q("insert into stores(owner_id,slug,name,status,currency,settings) values($1,$2,$3,$4,$5,$6::jsonb) on conflict(owner_id) do update set slug=excluded.slug,name=excluded.name,status=excluded.status,currency=excluded.currency,settings=excluded.settings,updated_at=now() returning *",
      [user.id,slug,name,status,currency,JSON.stringify(settings)]))[0];
    return [200,{ok:true,store:{...row,settings:storeSettings(row.settings)}}];
  } catch(e) { if(e.code==='23505') return [409,{ok:false,msg:'That storefront address is already in use.'}]; throw e; }
};
H['storefront/products'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  const store=await storeOwner(user.id); if(!store) return [404,{ok:false,msg:'Set up your storefront first.'}];
  if(req.method==='GET') return [200,{ok:true,products:await q('select id,source_product_id,source_branch_id,slug,title,description,price,sku,category,image_url,visible,featured,sort_order from store_products where store_id=$1 order by sort_order,title',[store.id])}];
  if(req.method!=='POST') return [405,{ok:false}];
  const row=(await q('select blob from user_data where user_id=$1',[user.id]))[0], blob=row&&row.blob||{}, existing=await q('select source_product_id,source_branch_id,slug from store_products where store_id=$1',[store.id]);
  let synced=0;
  for(const [key,value] of Object.entries(blob)) if(key.startsWith('ls:strap.f1.items.')) {
    const branch=key.slice('ls:strap.f1.items.'.length), list=parseStored(value,[]);
    if(!Array.isArray(list)) continue;
    for(const p of list) {
      if(!p||!p.id||String(p.status||'active')==='archived') continue;
      const title=String(p.title||p.name||'Untitled product').trim().slice(0,180), prior=existing.find(x=>String(x.source_product_id)===String(p.id)&&x.source_branch_id===branch);
      let slug=prior?prior.slug:storeSlugify(p.title||p.name||p.id)||'product';
      if(!prior && existing.some(x=>x.slug===slug)) slug=slug+'-'+String(p.id).slice(-6);
      await q('insert into store_products(store_id,source_product_id,source_branch_id,slug,title,description,price,sku,category,image_url,product_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) on conflict(store_id,source_product_id,source_branch_id) do update set title=excluded.title,description=excluded.description,price=excluded.price,sku=excluded.sku,category=excluded.category,image_url=excluded.image_url,product_snapshot=excluded.product_snapshot,updated_at=now()',
        [store.id,String(p.id).slice(0,120),branch,slug,title,String(p.description||p.details||'').slice(0,4000),Math.max(0,Number(p.price)||0),String(p.sku||'').slice(0,100),String(p.category||'').slice(0,100),String(p.image||p.imageUrl||'').slice(0,1000),JSON.stringify({tracked:!!p.tracked,qty:Number(p.qty)||0,status:p.status||'active'})]);
      synced++;
    }
  }
  return [200,{ok:true,synced,products:await q('select id,source_product_id,source_branch_id,slug,title,price,visible,featured from store_products where store_id=$1 order by sort_order,title',[store.id])}];
};
H['storefront/products/update'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  const store=await storeOwner(user.id), b=req.body||{}; if(!store) return [404,{ok:false}];
  const rows=await q('update store_products set visible=coalesce($3,visible),featured=coalesce($4,featured),sort_order=coalesce($5,sort_order),updated_at=now() where id=$1 and store_id=$2 returning id,visible,featured,sort_order',
    [String(b.id||''),store.id,typeof b.visible==='boolean'?b.visible:null,typeof b.featured==='boolean'?b.featured:null,Number.isInteger(b.sort_order)?b.sort_order:null]);
  return rows.length?[200,{ok:true,product:rows[0]}]:[404,{ok:false,msg:'Product not found.'}];
};
H['storefront/public'] = async req => {
  const store=await storePublic(req.body.slug||req.query.slug); if(!store) return [404,{ok:false,msg:'This store is unavailable.'}];
  const products=await q('select id,slug,title,description,price,sku,category,image_url,featured from store_products where store_id=$1 and visible=true order by featured desc,sort_order,title',[store.id]);
  return [200,{ok:true,store:{id:store.id,slug:store.slug,name:store.name,currency:store.currency,settings:storeSettings(store.settings)},products}];
};
H['storefront/orders'] = async (req,res,user) => {
  if(!user) return [401,{ok:false,msg:'Sign in to view orders.'}];
  const store=await storeOwner(user.id); if(!store) return [404,{ok:false,msg:'Set up your storefront first.'}];
  const rows=await q('select id,order_number,payment_method,payment_status,fulfillment_status,buyer_name,buyer_email,buyer_phone,delivery_address,delivery_city,delivery_region,delivery_note,currency,subtotal,delivery_fee,total,proof_media_id,sender_name,transfer_reference,payment_note,seller_note,rejection_reason,items_snapshot,created_at,updated_at from store_orders where store_id=$1 order by created_at desc limit 250',[store.id]);
  return [200,{ok:true,orders:rows.map(o=>({...o,proof_url:o.proof_media_id?'/api/media?id='+o.proof_media_id:null}))}];
};
H['storefront/order/update'] = async (req,res,user) => {
  if(!user) return [401,{ok:false}];
  const store=await storeOwner(user.id), b=req.body||{}; if(!store) return [404,{ok:false}];
  const action=String(b.action||''); let payment=null, fulfillment=null, reason=String(b.reason||'').trim().slice(0,500);
  if(action==='verify') { payment='verified'; fulfillment='confirmed'; }
  else if(action==='reject'||action==='request_reupload') payment='rejected';
  else if(action==='confirm') fulfillment='confirmed';
  else {
    if(['pending','verified','rejected','not_required'].includes(b.payment_status)) payment=b.payment_status;
    if(['pending','confirmed','processing','shipped','delivered','cancelled'].includes(b.fulfillment_status)) fulfillment=b.fulfillment_status;
  }
  const rows=await q("update store_orders set payment_status=coalesce($3,payment_status),fulfillment_status=coalesce($4,fulfillment_status),seller_note=coalesce($5,seller_note),rejection_reason=case when $6<>'' then $6 when $3='verified' then '' else rejection_reason end,updated_at=now() where id=$1 and store_id=$2 returning id,order_number,payment_status,fulfillment_status,rejection_reason,seller_note",
    [String(b.id||''),store.id,payment,fulfillment,b.seller_note==null?null:String(b.seller_note).slice(0,1000),reason]);
  return rows.length?[200,{ok:true,order:rows[0]}]:[404,{ok:false,msg:'Order not found.'}];
};
H['storefront/order'] = async (req,res) => {
  if(req.method!=='POST') return [405,{ok:false}];
  const b=req.body||{}, store=await storePublic(b.slug); if(!store) return [404,{ok:false,msg:'This store is unavailable.'}];
  const name=String(b.buyer_name||'').trim().slice(0,120), phone=String(b.buyer_phone||'').trim().slice(0,40), email=lower(b.buyer_email||'').slice(0,160);
  const address=String(b.delivery_address||'').trim().slice(0,300), method=String(b.payment_method||'');
  if(name.length<2||phone.length<7||address.length<5||!['bank_transfer','pay_on_delivery'].includes(method)||(email&&!emailRe.test(email))) return [400,{ok:false,msg:'Enter your contact details, delivery address and payment option.'}];
  const cart=Array.isArray(b.items)?b.items.slice(0,50):[]; if(!cart.length) return [400,{ok:false,msg:'Your cart is empty.'}];
  const ids=[...new Set(cart.map(x=>String(x&&x.id||'')))];
  const products=await q('select id,title,slug,price,image_url,product_snapshot from store_products where store_id=$1 and visible=true and id=any($2::uuid[])',[store.id,ids]);
  if(products.length!==ids.length) return [409,{ok:false,msg:'A product in your cart is unavailable. Refresh and try again.'}];
  const lines=[]; let subtotal=0;
  for(const item of cart) {
    const p=products.find(x=>x.id===item.id), qty=Math.max(1,Math.min(99,Math.floor(Number(item.qty)||1))), snap=p.product_snapshot||{};
    if(snap.tracked&&Number(snap.qty)<qty) return [409,{ok:false,msg:'Not enough stock for '+p.title+'.'}];
    const price=Number(p.price)||0, line=Math.round(price*qty*100)/100; subtotal+=line;
    lines.push({product_id:p.id,title:p.title,slug:p.slug,price,quantity:qty,line_total:line,image_url:p.image_url});
  }
  const settings=storeSettings(store.settings), deliveryFee=settings.deliveryFee, total=Math.round((subtotal+deliveryFee)*100)/100;
  const proof=b.proof&&typeof b.proof==='object'?b.proof:null; let bytes=null,mime='',filename='';
  if(method==='bank_transfer') {
    if(proof&&typeof proof.data==='string') {
      mime=String(proof.type||'').toLowerCase();
      if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(mime)) return [400,{ok:false,msg:'Upload a JPG, PNG, WebP or PDF receipt.'}];
      bytes=Buffer.from(proof.data,'base64'); if(!bytes.length||bytes.length>3*1024*1024) return [413,{ok:false,msg:'Payment proof must be smaller than 3 MB.'}];
      filename=String(proof.name||'Payment proof').slice(0,120);
    }
    if(!settings.bankTransfer.bankName||!settings.bankTransfer.accountNumber||!settings.bankTransfer.accountName) return [409,{ok:false,msg:'The seller has not configured bank details yet.'}];
    if(!bytes&&!String(b.sender_name||'').trim()&&!String(b.transfer_reference||'').trim()) return [400,{ok:false,msg:'Upload your receipt or enter sender name or transfer reference.'}];
  } else if(proof&&proof.data) return [400,{ok:false,msg:'Pay on Delivery does not require payment proof.'}];
  const wait=await actionBlocked(req,email||phone,'store-order'); if(wait) return [429,{ok:false,msg:'Please wait before placing another order.'}];
  const client=await pool.connect();
  try {
    await client.query('BEGIN'); let mediaId=null;
    if(bytes) mediaId=(await client.query("insert into media(user_id,name,mime,data,visibility) values($1,$2,$3,$4,'private') returning id",[store.owner_id,filename,mime,bytes])).rows[0].id;
    const order=(await client.query("insert into store_orders(store_id,payment_method,payment_status,fulfillment_status,buyer_name,buyer_email,buyer_phone,delivery_address,delivery_city,delivery_region,delivery_note,currency,subtotal,delivery_fee,total,proof_media_id,sender_name,transfer_reference,payment_note,items_snapshot) values($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb) returning id,order_number,payment_status,fulfillment_status,created_at",
      [store.id,method,method==='pay_on_delivery'?'not_required':'pending',name,email,phone,address,String(b.delivery_city||'').slice(0,100),String(b.delivery_region||'').slice(0,100),String(b.delivery_note||'').slice(0,500),store.currency,subtotal,deliveryFee,total,mediaId,String(b.sender_name||'').trim().slice(0,120),String(b.transfer_reference||'').trim().slice(0,120),String(b.payment_note||'').trim().slice(0,500),JSON.stringify(lines)])).rows[0];
    await client.query("insert into store_analytics_events(store_id,event_type) values($1,'order_placed')",[store.id]); await client.query('COMMIT');
    await recordAction(req,email||phone,'store-order').catch(()=>{});
    return [201,{ok:true,order:{...order,total,currency:store.currency},message:'Your order has been sent to the seller.'}];
  } catch(e) { await client.query('ROLLBACK').catch(()=>{}); throw e; } finally { client.release(); }
};

/* ---- images stored inside Neon (bytea) ---- */
H['media'] = async (req, res, user, staff) => {
  if (req.method === 'GET') {
    const r = (await q('select mime,data,visibility,user_id from media where id=$1', [String(req.query.id || '')]).catch(() => []))[0];
    if (!r || (r.visibility === 'private' && (!user || String(user.id) !== String(r.user_id)))) { res.statusCode = 404; res.end(); return null; }
    res.setHeader('Content-Type', r.mime); res.setHeader('Cache-Control', r.visibility === 'private' ? 'private, no-store' : 'public, max-age=31536000, immutable'); res.end(r.data); return null;
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
    const route = String(req.query.__strap_route || req.url || '').split('?')[0].replace(/^\/api\//, '').replace(/^health\//, '').replace(/\/+$/, ''); req.__strap_route=route; const h = H[route] || (route.startsWith('neon-auth/') ? H['neon-auth'] : null);
    if (!h) { res.statusCode = 404; return res.json({ ok: false }); }
    if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch (e) { req.body = {}; } }
    req.body = req.body || {};
    const user=await me(req), staff=user?null:await staffSession(req);
    const out = await h(req, res, user, staff);
    // Some streaming/binary handlers write directly to the response and return null.
    // Never attempt a second response after headers/body have already been sent.
    if (out === null || res.writableEnded || res.finished) return;
    // Every JSON handler must return [status, body]. Treat accidental undefined or
    // malformed results as a controlled server error instead of throwing at out[0].
    if (!Array.isArray(out) || out.length < 2 || !Number.isInteger(out[0])) {
      console.error('[Strap API] Invalid handler response:', route, out);
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: false, msg: 'This request could not be completed. Please try again.' });
    }
    res.statusCode = out[0];
    res.setHeader('Cache-Control', 'no-store');
    return res.json(out[1]);
  } catch (e) {
    console.error('[Strap API]', req.__strap_route || 'unknown route', e);
    // A media/download/stream handler may already have started its response.
    if (res.headersSent || res.writableEnded || res.finished) return;
    res.statusCode = 500;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: false, msg: 'Server error. Try again.' });
  }
};
