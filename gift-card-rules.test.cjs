'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Gift = require('./gift-card-rules');

test('partial value redemption keeps the remaining balance active', () => {
  const r=Gift.redeem({id:'g1',type:'value',value:1000,balance:1000,status:'active'},400,'sale-1','2026-11-24',1);
  assert.equal(r.ok,true); assert.equal(r.discount,400); assert.equal(r.card.balance,600); assert.equal(r.card.status,'active');
});
test('full value redemption marks the card redeemed', () => {
  const r=Gift.redeem({id:'g2',type:'value',value:1000,balance:1000,status:'active'},1500,'sale-2','2026-11-24',1);
  assert.equal(r.discount,1000); assert.equal(r.card.balance,0); assert.equal(r.card.status,'redeemed');
});
test('percentage discount pass is single-use', () => {
  const r=Gift.redeem({id:'g3',type:'discount',value:50,status:'active'},2000,'sale-3','2026-11-24',1);
  assert.equal(r.discount,1000); assert.equal(r.card.status,'redeemed');
  assert.equal(Gift.redeem(r.card,2000,'sale-4','2026-11-24',2).code,'INACTIVE');
});
test('expired card is rejected', () => {
  const r=Gift.quote({id:'g4',type:'value',value:500,balance:500,status:'active',expiresOn:'2026-11-23'},100,'2026-11-24');
  assert.equal(r.ok,false); assert.equal(r.code,'EXPIRED');
});
test('same sale retry is idempotent and does not deduct twice', () => {
  const first=Gift.redeem({id:'g5',type:'value',value:1000,balance:1000,status:'active'},300,'sale-5','2026-11-24',1);
  const retry=Gift.redeem(first.card,300,'sale-5','2026-11-24',2);
  assert.equal(retry.ok,true); assert.equal(retry.alreadyProcessed,true); assert.equal(retry.card.balance,700); assert.equal(retry.card.redemptions.length,1);
});
test('a different sale cannot reuse a redeemed discount pass', () => {
  const first=Gift.redeem({id:'g6',type:'discount',value:25,status:'active'},1000,'sale-6','2026-11-24',1);
  const retry=Gift.redeem(first.card,1000,'sale-7','2026-11-24',2);
  assert.equal(retry.ok,false); assert.equal(retry.code,'INACTIVE');
});
test('invalid discount percentage is rejected', () => {
  const r=Gift.quote({id:'g7',type:'discount',value:150,status:'active'},100,'2026-11-24');
  assert.equal(r.ok,false); assert.equal(r.code,'INVALID_CARD');
});
