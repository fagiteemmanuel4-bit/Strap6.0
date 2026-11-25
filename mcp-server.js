'use strict';
const crypto = require('crypto');
const APP_URL = 'https://strap60.vercel.app';
const ICON_URL = APP_URL + '/favicon.svg';
const sha = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const json = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id == null ? null : id, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const parse = (value, fallback) => { try { return typeof value === 'string' ? JSON.parse(value) : (value == null ? fallback : value); } catch (_) { return fallback; } };
const safeText = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 180);
const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : (fallback || 0);

const readTools = [
 { name:'strap_whoami', description:'Identify the authenticated Strap store and connection permissions.', inputSchema:{type:'object',properties:{},additionalProperties:false} },
 { name:'strap_get_store_profile', description:'Read the connected Strap store profile.', inputSchema:{type:'object',properties:{},additionalProperties:false} },
 { name:'strap_list_branches', description:'List branches this connection is allowed to access.', inputSchema:{type:'object',properties:{},additionalProperties:false} },
 { name:'strap_search_products', description:'Search products in an allowed branch by title, SKU, barcode or category.', inputSchema:{type:'object',properties:{query:{type:'string'},branch_id:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false} },
 { name:'strap_get_low_stock', description:'Find products at or below a stock threshold in an allowed branch.', inputSchema:{type:'object',properties:{branch_id:{type:'string'},threshold:{type:'number',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false} },
 { name:'strap_get_sales', description:'Read recent sales records for the connected store. Date filters use ISO-8601.', inputSchema:{type:'object',properties:{from:{type:'string'},to:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false} },
 { name:'strap_search_customers', description:'Search customer records by name, email or phone.', inputSchema:{type:'object',properties:{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}},required:['query'],additionalProperties:false} }
];
const writeTools = [
 { name:'strap_create_product', description:'Create a product in an allowed branch. Requires write permission.', inputSchema:{type:'object',properties:{title:{type:'string',minLength:1,maxLength:160},price:{type:'number',minimum:0},qty:{type:'number',minimum:0},category:{type:'string',maxLength:100},sku:{type:'string',maxLength:80},barcode:{type:'string',maxLength:80},description:{type:'string',maxLength:2000},branch_id:{type:'string'}},required:['title','price'],additionalProperties:false} },
 { name:'strap_update_product', description:'Update allowed product fields. Requires write permission.', inputSchema:{type:'object',properties:{product_id:{type:'string'},branch_id:{type:'string'},title:{type:'string',maxLength:160},price:{type:'number',minimum:0},qty:{type:'number',minimum:0},category:{type:'string',maxLength:100},sku:{type:'string',maxLength:80},barcode:{type:'string',maxLength:80},description:{type:'string',maxLength:2000},tracked:{type:'boolean'},status:{type:'string',enum:['active','draft','archived']}},required:['product_id'],additionalProperties:false} },
 { name:'strap_set_branch_stock', description:'Set a product quantity in an allowed branch. Requires write permission.', inputSchema:{type:'object',properties:{product_id:{type:'string'},branch_id:{type:'string'},quantity:{type:'number',minimum:0}},required:['product_id','quantity'],additionalProperties:false} },
 { name:'strap_upload_product_image', description:'Upload a JPG, PNG, WEBP or GIF image (maximum 3 MB) to a product in an allowed branch. Supply raw base64 image data and MIME type. Requires write permission.', inputSchema:{type:'object',properties:{product_id:{type:'string'},branch_id:{type:'string'},file_name:{type:'string',maxLength:120},mime_type:{type:'string',enum:['image/jpeg','image/png','image/webp','image/gif']},image_base64:{type:'string',minLength:16,maxLength:4194304}},required:['product_id','mime_type','image_base64'],additionalProperties:false} }
];

module.exports = function createMcp(options) {
 const pool = options.pool, premiumActive = options.premiumActive;
 const q = async (sql, params) => (await pool.query(sql, params)).rows;
 let schemaReady, jwksCache=null;
 async function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
   await q("create table if not exists strap_mcp_tokens (id uuid primary key default gen_random_uuid(), user_id text not null references app_users(id) on delete cascade, token_hash text not null unique, token_prefix text not null, name text not null default 'AI connection', scopes text[] not null default array['store:read']::text[], branch_ids text[] not null default array['*']::text[], created_at timestamptz not null default now(), last_used_at timestamptz, revoked_at timestamptz)");
   await q('create index if not exists strap_mcp_tokens_user_idx on strap_mcp_tokens(user_id, created_at desc)');
   await q("create table if not exists strap_mcp_audit_log (id bigserial primary key, user_id text not null references app_users(id) on delete cascade, token_id uuid references strap_mcp_tokens(id) on delete set null, action text not null, branch_id text, resource_id text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now())");
   await q('create index if not exists strap_mcp_audit_user_idx on strap_mcp_audit_log(user_id, created_at desc)');
   await q("create table if not exists strap_mcp_oauth_grants (user_id text not null references app_users(id) on delete cascade, client_id text not null, client_name text not null default 'OAuth AI client', scopes text[] not null default array['store:read']::text[], branch_ids text[] not null default array['b0']::text[], created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revoked_at timestamptz, primary key(user_id,client_id))");
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
 }
 async function ownerContext(userId) {
  const rows = await q('select a.id,a.email,a.profile,u.blob from app_users a left join user_data u on u.user_id=a.id where a.id=$1 and a.deleted_at is null limit 1',[userId]);
  if (!rows[0]) throw new Error('The Strap store account is unavailable.');
  const row=rows[0], blob=row.blob||{}, settings=parse(blob['ls:strap.f1'],{}), operations=parse(blob['ls:strap.v1'],{});
  const branches=Array.isArray(settings.branches)&&settings.branches.length?settings.branches:[{id:'b0',name:'Main branch'}];
  return {row,blob,settings,operations,branches};
 }
 function allowedBranch(ctx, token, branchId) {
  const defaultBranch=token.branch_ids.includes('*')?(ctx.settings.active||'b0'):token.branch_ids[0];
  const requested=safeText(branchId||defaultBranch,100), branch=ctx.branches.find(item=>String(item.id)===requested);
  if(!branch) throw new Error('That branch does not exist in this store.');
  if(!token.branch_ids.includes('*')&&!token.branch_ids.includes(requested)) throw new Error('This AI connection is not allowed to access that branch.');
  return branch;
 }
 async function audit(token, action, branchId, resourceId, details) {
  await q('insert into strap_mcp_audit_log(user_id,token_id,action,branch_id,resource_id,details) values($1,$2,$3,$4,$5,$6::jsonb)',[token.user_id,token.id,action,branchId||null,resourceId||null,JSON.stringify(details||{})]);
 }
 async function callTool(name,args,token) {
  const ctx=await ownerContext(token.user_id), profile=ctx.row.profile||{};
  if(name==='strap_whoami') return {store:safeText(profile.bizname||'My Store'),email:ctx.row.email,permissions:token.scopes,allowed_branches:token.branch_ids};
  if(name==='strap_get_store_profile') return {business_name:profile.bizname||'My Store',owner_name:profile.name||'',email:ctx.row.email,currency:profile.currency||'NGN',phone:profile.phone||'',address:profile.address||'',website:profile.website||''};
  if(name==='strap_list_branches') return ctx.branches.filter(b=>token.branch_ids.includes('*')||token.branch_ids.includes(String(b.id))).map(b=>({id:String(b.id),name:safeText(b.name,100)}));
  if(name==='strap_search_products'||name==='strap_get_low_stock') {
   const branch=allowedBranch(ctx,token,args.branch_id), products=parse(ctx.blob['ls:strap.f1.items.'+branch.id],[]);
   if(!Array.isArray(products)) return [];
   const query=safeText(args.query,120).toLowerCase(), threshold=Math.max(0,number(args.threshold,5)), limit=Math.max(1,Math.min(100,Math.floor(number(args.limit,50))));
   return products.filter(p=>{
    if(!p||typeof p!=='object') return false;
    const stock=number(p.qty,0);
    if(name==='strap_get_low_stock') return p&&p.tracked!==false&&stock<=threshold;
    if(!query) return true;
    return [p.title,p.sku,p.barcode,p.category].some(v=>String(v||'').toLowerCase().includes(query));
   }).slice(0,limit).map(p=>({id:String(p.id||''),title:safeText(p.title,160),sku:safeText(p.sku,80),barcode:safeText(p.barcode,80),category:safeText(p.category,100),price:number(p.price,number(p.unitPrice,0)),quantity:number(p.qty,0),tracked:p.tracked!==false,status:safeText(p.status||'active',30)}));
  }
  if(name==='strap_get_sales') {
   const from=args.from?new Date(args.from).getTime():0, to=args.to?new Date(args.to).getTime():Date.now()+86400000;
   if((args.from&&!Number.isFinite(from))||(args.to&&!Number.isFinite(to))) throw new Error('Use valid ISO-8601 dates for from and to.');
   const limit=Math.max(1,Math.min(100,Math.floor(number(args.limit,50)))), sales=Array.isArray(ctx.operations.sales)?ctx.operations.sales:[];
   return sales.filter(s=>{
    if(!s||typeof s!=='object') return false;
    const ts=number(s.ts,Date.parse(s.ts||''));
    if(!Number.isFinite(ts)||ts<from||ts>to) return false;
    if(token.branch_ids.includes('*')) return true;
    const saleBranch=String(s.branchId||s.branch_id||s.branch||'');
    return saleBranch ? token.branch_ids.includes(saleBranch) : token.branch_ids.includes('b0');
   }).slice(0,limit).map(s=>({id:String(s.id||s.no||''),receipt_number:safeText(s.no,80),date:s.ts?new Date(number(s.ts,Date.parse(s.ts))).toISOString():null,customer:safeText(s.customer,160),total:number(s.total),paid:number(s.paidNow,number(s.total)-number(s.due)),due:number(s.due),payment_method:safeText(s.method,40),items:Array.isArray(s.lines)?s.lines.length:0}));
  }
  if(name==='strap_search_customers') {
   const query=safeText(args.query,120).toLowerCase(), limit=Math.max(1,Math.min(100,Math.floor(number(args.limit,50)))), customers=Array.isArray(ctx.operations.customers)?ctx.operations.customers:[];
   return customers.filter(c=>{if(!c||typeof c!=='object') return false;const customerBranches=Array.isArray(c.branchIds)?c.branchIds.map(String):[String(c.branchId||c.branch_id||c.branch||'')].filter(Boolean);const inBranch=token.branch_ids.includes('*')||(customerBranches.length?customerBranches.some(id=>token.branch_ids.includes(id)):token.branch_ids.includes('b0'));return inBranch&&[c.name,c.email,c.phone].some(v=>String(v||'').toLowerCase().includes(query));}).slice(0,limit).map(c=>({id:String(c.id||''),name:safeText(c.name,120),email:safeText(c.email,160),phone:safeText(c.phone,60)}));
  }
  if(!token.scopes.includes('store:write')) throw new Error('This AI connection has read-only permission.');
  if(name==='strap_create_product'||name==='strap_update_product'||name==='strap_set_branch_stock') {
   const branch=allowedBranch(ctx,token,args.branch_id), client=await pool.connect(); let productId=safeText(args.product_id,100);
   try {
    await client.query('begin');
    await client.query("insert into user_data(user_id,blob,updated_at) values($1,'{}'::jsonb,now()) on conflict(user_id) do nothing",[token.user_id]);
    const locked=await client.query('select blob from user_data where user_id=$1 for update',[token.user_id]), blob=locked.rows[0].blob||{}, key='ls:strap.f1.items.'+branch.id, products=parse(blob[key],[]);
    if(!Array.isArray(products)) throw new Error('Product data is not available for this branch.');
    if(name==='strap_create_product') {
     const title=safeText(args.title,160), price=Number(args.price), qty=args.qty==null?0:Number(args.qty);
     if(!title||!Number.isFinite(price)||price<0||!Number.isFinite(qty)||qty<0) throw new Error('Provide a product title, a valid non-negative price, and a valid non-negative quantity.');
     productId=crypto.randomUUID();
     products.unshift({id:productId,title,price,qty,category:safeText(args.category,100),sku:safeText(args.sku,80),barcode:safeText(args.barcode,80),description:safeText(args.description,2000),tracked:true,status:'active',createdAt:Date.now()});
    } else {
     const index=products.findIndex(p=>String(p.id)===productId);
     if(index<0) throw new Error('Product not found in the selected branch.');
     if(name==='strap_set_branch_stock') {
      const qty=Number(args.quantity); if(!Number.isFinite(qty)||qty<0) throw new Error('Quantity must be a non-negative number.');
      products[index]={...products[index],qty};
     } else {
      const fields=['title','price','qty','category','sku','barcode','description','tracked','status'], patch={};
      for(const field of fields) if(Object.prototype.hasOwnProperty.call(args,field)) patch[field]=args[field];
      if(patch.title!==undefined) { patch.title=safeText(patch.title,160); if(!patch.title) throw new Error('Product title cannot be empty.'); }
      if(patch.price!==undefined) { if(!Number.isFinite(Number(patch.price))||Number(patch.price)<0) throw new Error('Price must be a non-negative number.'); patch.price=Number(patch.price); }
      if(patch.qty!==undefined) { if(!Number.isFinite(Number(patch.qty))||Number(patch.qty)<0) throw new Error('Quantity must be a non-negative number.'); patch.qty=Number(patch.qty); }
      if(patch.category!==undefined) patch.category=safeText(patch.category,100);
      if(patch.sku!==undefined) patch.sku=safeText(patch.sku,80);
      if(patch.barcode!==undefined) patch.barcode=safeText(patch.barcode,80);
      if(patch.description!==undefined) patch.description=safeText(patch.description,2000);
      if(patch.tracked!==undefined&&typeof patch.tracked!=='boolean') throw new Error('Tracked must be true or false.');
      if(patch.status!==undefined&&!['active','draft','archived'].includes(patch.status)) throw new Error('Invalid product status.');
      if(!Object.keys(patch).length) throw new Error('Provide at least one product field to update.');
      products[index]={...products[index],...patch};
     }
    }
    blob[key]=JSON.stringify(products);
    await client.query('update user_data set blob=$2::jsonb,updated_at=now() where user_id=$1',[token.user_id,JSON.stringify(blob)]);
    await client.query('commit');
   } catch(error) { await client.query('rollback').catch(()=>{}); throw error; }
   finally { client.release(); }
   await audit(token,name,branch.id,productId,{fields:Object.keys(args).filter(k=>k!=='branch_id'&&k!=='product_id')});
   return {ok:true,product_id:productId,branch_id:branch.id,action:name,...(name==='strap_upload_product_image'?{image_url:APP_URL+`/api/media?id=${safeText(args.product_id,100)}`,mime_type:imageMime,size_bytes:imageBuffer.length}:{})};
  }
  throw new Error('Unknown Strap tool: '+name);
 }
 async function verifyOAuthJwt(raw) {
  const issuer=String(process.env.NEON_AUTH_BASE_URL||'').replace(/\/$/,'');
  if(!issuer) return null;
  const parts=String(raw||'').split('.');
  if(parts.length!==3) return null;
  let header,payload;
  try { header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')); } catch(_) { return null; }
  if(header.alg!=='EdDSA'||!header.kid||payload.iss!==issuer||!payload.sub) return null;
  const now=Math.floor(Date.now()/1000);
  if(!Number.isFinite(Number(payload.exp))||Number(payload.exp)<=now||(payload.nbf&&Number(payload.nbf)>now+30)||(payload.iat&&Number(payload.iat)>now+30)) return null;
  const aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];
  if(!aud.includes(APP_URL+'/api/mcp')) return null;
  try {
   if(!jwksCache||jwksCache.expires<Date.now()) {
    const response=await fetch(issuer+'/.well-known/jwks.json',{headers:{Accept:'application/json'}});
    if(!response.ok) return null;
    const body=await response.json();jwksCache={keys:Array.isArray(body.keys)?body.keys:[],expires:Date.now()+300000};
   }
   const jwk=jwksCache.keys.find(k=>k.kid===header.kid&&k.kty==='OKP'&&k.crv==='Ed25519');
   if(!jwk) { jwksCache=null; const refresh=await fetch(issuer+'/.well-known/jwks.json',{headers:{Accept:'application/json'}}); if(!refresh.ok) return null; const fresh=await refresh.json(); jwksCache={keys:Array.isArray(fresh.keys)?fresh.keys:[],expires:Date.now()+300000}; }
   const activeJwk=jwksCache.keys.find(k=>k.kid===header.kid&&k.kty==='OKP'&&k.crv==='Ed25519'); if(!activeJwk) return null;
   const key=crypto.createPublicKey({key:activeJwk,format:'jwk'});
   const valid=crypto.verify(null,Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'));
   return valid?payload:null;
  } catch(error) { console.error('MCP OAuth token verification failed:',error.message);return null; }
 }
 async function authenticate(req) {
  await ensureSchema();
  const match=/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization||''));
  if(!match||match[1].length<24) return null;
  const raw=match[1];
  const rows=await q('select t.id,t.user_id,t.scopes,t.branch_ids,t.name from strap_mcp_tokens t join app_users a on a.id=t.user_id where t.token_hash=$1 and t.revoked_at is null and a.deleted_at is null limit 1',[sha(raw)]);
  if(rows[0]) {
   if(!await premiumActive(rows[0].user_id)) return null;
   await q('update strap_mcp_tokens set last_used_at=now() where id=$1',[rows[0].id]);
   return rows[0];
  }
  const claims=await verifyOAuthJwt(raw);
  if(!claims) return null;
  const userId=String(claims.sub), account=await q('select id from app_users where id=$1 and deleted_at is null limit 1',[userId]);
  if(!account[0]||!await premiumActive(userId)) return null;
  const clientId=safeText(claims.client_id||claims.azp||claims.clientId,256);
  if(!clientId) return null;
  const ctx=await ownerContext(userId), defaultBranch=String(ctx.settings.active||'b0');
  await q("insert into strap_mcp_oauth_grants(user_id,client_id,client_name,scopes,branch_ids) values($1,$2,$3,array['store:read']::text[],$4::text[]) on conflict(user_id,client_id) do nothing",[userId,clientId,safeText(claims.client_name||'OAuth AI client',100),[defaultBranch]]);
  const grants=await q('select client_id,client_name,scopes,branch_ids,revoked_at from strap_mcp_oauth_grants where user_id=$1 and client_id=$2 limit 1',[userId,clientId]);
  if(!grants[0]||grants[0].revoked_at||!grants[0].scopes.includes('store:read')) return null;
  return {id:null,user_id:userId,client_id:clientId,scopes:grants[0].scopes,branch_ids:grants[0].branch_ids,name:grants[0].client_name,oauth:true};
 }
 async function handle(req,res) {
  const protocolHeader=req.headers['mcp-protocol-version'];
  if(protocolHeader) res.setHeader('MCP-Protocol-Version',String(protocolHeader));
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers','MCP-Protocol-Version, MCP-Session-Id, WWW-Authenticate');
  if(req.method==='OPTIONS') { res.statusCode=204; return res.end(); }
  await ensureSchema();
  if(req.method!=='POST') { res.setHeader('Allow','POST'); return json(res,405,{error:'Use POST for the Strap MCP Streamable HTTP endpoint.'}); }
  const token=await authenticate(req);
  if(!token) { res.setHeader('WWW-Authenticate','Bearer resource_metadata="https://strap60.vercel.app/.well-known/oauth-protected-resource/api/mcp"'); return json(res,401,{error:'Unauthorized',message:'Connect using Strap OAuth or a valid Strap access token.'}); }
  const body=req.body&&typeof req.body==='object'?req.body:{};
  if(body.jsonrpc!=='2.0'||typeof body.method!=='string') return json(res,400,rpcError(body.id,-32600,'Invalid JSON-RPC request.'));
  if(body.method==='notifications/initialized'||body.method==='notifications/cancelled') { res.statusCode=202; return res.end(); }
  if(body.method==='initialize') { res.setHeader('MCP-Protocol-Version',body.params&&body.params.protocolVersion||'2025-03-26'); return json(res,200,rpcResult(body.id,{protocolVersion:body.params&&body.params.protocolVersion||'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'Strap',title:'Strap Business Management',version:'1.0.0',websiteUrl:APP_URL,icons:[{src:ICON_URL,mimeType:'image/svg+xml',sizes:['any']}]}})); }
  if(body.method==='ping') return json(res,200,rpcResult(body.id,{}));
  if(body.method==='tools/list') return json(res,200,rpcResult(body.id,{tools:token.scopes.includes('store:write')?[...readTools,...writeTools]:readTools}));
  if(body.method==='tools/call') {
   const name=safeText(body.params&&body.params.name,100), args=body.params&&body.params.arguments&&typeof body.params.arguments==='object'?body.params.arguments:{};
   try { const result=await callTool(name,args,token); if(!writeTools.some(tool=>tool.name===name)) await audit(token,name,args.branch_id||null,null,{read:true}); return json(res,200,rpcResult(body.id,{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false})); }
   catch(error) { return json(res,200,rpcResult(body.id,{content:[{type:'text',text:error.message||'Tool call failed.'}],isError:true})); }
  }
  return json(res,200,rpcError(body.id,-32601,'Method not found.'));
 }
 async function manage(req,res,user) {
  if(!user) return json(res,401,{ok:false,message:'Sign in to manage AI connections.'});
  await ensureSchema();
  if(!await premiumActive(user.id)) return json(res,403,{ok:false,message:'Strap MCP connections require Strap Premium.'});
  if(req.method==='GET') {
   const rows=await q('select id::text,name,token_prefix,scopes,branch_ids,created_at,last_used_at from strap_mcp_tokens where user_id=$1 and revoked_at is null order by created_at desc',[user.id]);
   const oauth=await q('select client_id,client_name,scopes,branch_ids,created_at,updated_at,revoked_at from strap_mcp_oauth_grants where user_id=$1 order by created_at desc',[user.id]);
   const activity=await q('select id,action,branch_id,resource_id,details,created_at from strap_mcp_audit_log where user_id=$1 order by created_at desc limit 50',[user.id]);
   const ctx=await ownerContext(user.id);
   const branches=ctx.branches.map(b=>({id:String(b.id),name:safeText(b.name,100)}));
   return json(res,200,{ok:true,endpoint:APP_URL+'/api/mcp',connections:rows,oauth_connections:oauth,activity,branches});
  }
  if(req.method==='POST') {
   const body=req.body||{}, name=safeText(body.name||'AI connection',80), scopes=Array.isArray(body.scopes)?body.scopes.filter(x=>['store:read','store:write'].includes(x)):['store:read'];
   const activeCount=await q('select count(*)::int as count from strap_mcp_tokens where user_id=$1 and revoked_at is null',[user.id]);
   if(Number(activeCount[0]&&activeCount[0].count||0)>=10) return json(res,429,{ok:false,message:'You can have up to 10 active AI connections. Revoke one before adding another.'});
   const cleanScopes=[...new Set(['store:read',...scopes])], branches=Array.isArray(body.branch_ids)&&body.branch_ids.length?[...new Set(body.branch_ids.map(x=>safeText(x,100)).filter(Boolean))].slice(0,30):['*'];
   if(branches.includes('*')&&branches.length>1) return json(res,400,{ok:false,message:'Use * by itself for all branches, or select specific branch IDs.'});
   const ctx=await ownerContext(user.id);
   if(!branches.includes('*')&&branches.some(id=>!ctx.branches.some(b=>String(b.id)===id))) return json(res,400,{ok:false,message:'One or more selected branches do not exist.'});
   const raw='strap_mcp_'+crypto.randomBytes(32).toString('hex');
   const rows=await q('insert into strap_mcp_tokens(user_id,token_hash,token_prefix,name,scopes,branch_ids) values($1,$2,$3,$4,$5,$6) returning id::text,name,token_prefix,scopes,branch_ids,created_at',[user.id,sha(raw),raw.slice(0,16),name,cleanScopes,branches]);
   return json(res,201,{ok:true,endpoint:APP_URL+'/api/mcp',connection:rows[0],access_token:raw,warning:'Copy this token now. It will not be shown again.'});
  }
  if(req.method==='PATCH') {
   const body=req.body||{}, clientId=safeText(body.client_id,256);
   if(!clientId) return json(res,400,{ok:false,message:'OAuth client ID is required.'});
   const ctx=await ownerContext(user.id);
   const scopes=Array.isArray(body.scopes)?[...new Set(['store:read',...body.scopes.filter(x=>x==='store:write')])]:['store:read'];
   const branches=Array.isArray(body.branch_ids)&&body.branch_ids.length?[...new Set(body.branch_ids.map(x=>safeText(x,100)).filter(Boolean))]:[];
   if(!branches.length||branches.includes('*')&&branches.length>1||branches.some(id=>id!=='*'&&!ctx.branches.some(b=>String(b.id)===id))) return json(res,400,{ok:false,message:'Choose one or more valid branches.'});
   const updated=await q('update strap_mcp_oauth_grants set scopes=$3::text[],branch_ids=$4::text[],revoked_at=null,updated_at=now() where user_id=$1 and client_id=$2 returning client_id',[user.id,clientId,scopes,branches]);
   if(!updated.length) return json(res,404,{ok:false,message:'OAuth connection not found. Connect the AI client first.'});
   return json(res,200,{ok:true,updated:true});
  }
  if(req.method==='DELETE') {
   const body=req.body||{}, clientId=safeText(body.client_id||(req.query&&req.query.client_id),256);
   if(clientId) {
    const rows=await q('update strap_mcp_oauth_grants set revoked_at=now(),updated_at=now() where user_id=$1 and client_id=$2 and revoked_at is null returning client_id',[user.id,clientId]);
    return json(res,200,{ok:true,revoked:rows.length===1});
   }
   const id=safeText((req.query&&req.query.id)||body.id,80);
   if(!id) return json(res,400,{ok:false,message:'Connection ID is required.'});
   const rows=await q('update strap_mcp_tokens set revoked_at=now() where id=$1::uuid and user_id=$2 and revoked_at is null returning id',[id,user.id]);
   return json(res,200,{ok:true,revoked:rows.length===1});
  }
  res.setHeader('Allow','GET, POST, PATCH, DELETE');
  return json(res,405,{ok:false,message:'Method not allowed.'});
 }
 return {handle,manage};
};
