'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const createMcp = require('../mcp-server');

const token = 'strap_mcp_test_token_012345678901234567890123456789';
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

function fixture(scopes=['store:read'], branchIds=['b0']) {
  const blob = {
    'ls:strap.f1': JSON.stringify({branches:[{id:'b0',name:'Main'},{id:'b1',name:'Second'}],active:'b0'}),
    'ls:strap.f1.items.b0': JSON.stringify([{id:'p1',title:'Main item',sku:'M-1',price:100,qty:2,tracked:true}]),
    'ls:strap.f1.items.b1': JSON.stringify([{id:'p2',title:'Second item',sku:'S-1',price:200,qty:4,tracked:true}]),
    'ls:strap.v1': JSON.stringify({sales:[
      {id:'s1',no:'S-1',ts:Date.now(),total:100,paidNow:100,branchId:'b0',lines:[]},
      {id:'s2',no:'S-2',ts:Date.now(),total:200,paidNow:200,branchId:'b1',lines:[]}
    ]})
  };
  const pool = {
    async query(sql, params=[]) {
      if (sql.includes('from strap_mcp_tokens t join app_users')) {
        return {rows: params[0]===tokenHash ? [{id:'token-1',user_id:'user-1',scopes,branch_ids:branchIds,name:'test'}] : []};
      }
      if (sql.includes('from app_users a left join user_data')) {
        return {rows:[{id:'user-1',email:'owner@example.com',profile:{bizname:'Test Store',currency:'NGN'},blob}]};
      }
      return {rows:[]};
    },
    async connect() {
      return {
        async query(sql, params=[]) {
          if (sql.includes('select blob from user_data where user_id=$1 for update')) return {rows:[{blob}]};
          if (sql.startsWith('update user_data set blob=')) {
            Object.assign(blob, JSON.parse(params[1]));
            return {rows:[]};
          }
          return {rows:[]};
        },
        release() {}
      };
    }
  };
  const server=createMcp({pool,premiumActive:async()=>true});
  async function send(body, method='POST', authorization='Bearer '+token) {
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=v;}};
    await server.handle({method,headers:{authorization:authorization||'',},body},res);
    return {status:res.statusCode,headers:res.headers,body:res.body?JSON.parse(res.body):null,raw:res.body};
  }
  return {send,blob};
}

test('initializes MCP and advertises Strap favicon', async()=>{
  const {send}=fixture();
  const r=await send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}});
  assert.equal(r.status,200);
  assert.equal(r.body.result.serverInfo.name,'Strap');
  assert.equal(r.body.result.serverInfo.icons[0].src,'https://strap60.vercel.app/favicon.svg');
});

test('read-only token sees only its allowed branch and cannot write',async()=>{
  const {send}=fixture();
  const list=await send({jsonrpc:'2.0',id:1,method:'tools/list'});
  assert.equal(list.body.result.tools.length,7);
  const products=await send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'strap_search_products',arguments:{query:'item',branch_id:'b0'}}});
  assert.deepEqual(products.body.result.structuredContent.map(x=>x.id),['p1']);
  const cross=await send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'strap_search_products',arguments:{query:'item',branch_id:'b1'}}});
  assert.equal(cross.body.result.isError,true);
  const write=await send({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'strap_create_product',arguments:{title:'Blocked',price:1}}});
  assert.equal(write.body.result.isError,true);
});

test('write permission exposes safe product tools and persists product creation',async()=>{
  const {send,blob}=fixture(['store:read','store:write'],['b0']);
  const list=await send({jsonrpc:'2.0',id:1,method:'tools/list'});
  assert.equal(list.body.result.tools.length,10);
  const created=await send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'strap_create_product',arguments:{title:'New item',price:250,qty:5,branch_id:'b0'}}});
  assert.equal(created.body.result.structuredContent.ok,true);
  assert.equal(JSON.parse(blob['ls:strap.f1.items.b0']).length,2);
  const invalid=await send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'strap_update_product',arguments:{product_id:'p1',tracked:'false'}}});
  assert.equal(invalid.body.result.isError,true);
});

test('unauthorized requests return the protected-resource challenge',async()=>{
  const {send}=fixture();
  const r=await send({jsonrpc:'2.0',id:1,method:'initialize'},'POST','');
  assert.equal(r.status,401);
  assert.match(r.headers['WWW-Authenticate'],/oauth-protected-resource/);
});

test('CORS preflight is answered without authentication',async()=>{
  const {send}=fixture();
  const r=await send({},'OPTIONS','');
  assert.equal(r.status,204);
  assert.equal(r.headers['Access-Control-Allow-Methods'],'POST, OPTIONS');
});
