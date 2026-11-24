(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StrapGiftRules = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  function validate(card, today) {
    if (!card) return { ok: false, code: 'NOT_FOUND', message: 'No gift card matches that QR or code.' };
    const status = String(card.status || 'active').toLowerCase();
    if (status !== 'active') return { ok: false, code: status === 'expired' ? 'EXPIRED' : 'INACTIVE', message: status === 'redeemed' ? 'This gift card has already been redeemed.' : status === 'expired' ? 'This gift card has expired.' : 'This gift card is no longer active.' };
    const day = String(today || new Date().toISOString().slice(0, 10));
    if (card.expiresOn && String(card.expiresOn) < day) return { ok: false, code: 'EXPIRED', message: 'This gift card has expired.' };
    const type = card.type || 'value', value = Number(card.value);
    if (type === 'discount' && (!Number.isFinite(value) || value <= 0 || value > 100)) return { ok: false, code: 'INVALID_CARD', message: 'This discount pass has an invalid percentage.' };
    if (type === 'value') {
      const balance = Number(card.balance ?? card.value);
      if (!Number.isFinite(balance) || balance <= 0) return { ok: false, code: 'EMPTY', message: 'This gift card has no remaining balance.' };
    } else if (type !== 'discount') return { ok: false, code: 'INVALID_CARD', message: 'This gift card type is not supported.' };
    return { ok: true, type, value, balance: type === 'value' ? Number(card.balance ?? card.value) : 0 };
  }
  function quote(card, subtotal, today) {
    const valid = validate(card, today);
    if (!valid.ok) return valid;
    const base = Number(subtotal);
    if (!Number.isFinite(base) || base <= 0) return { ok: false, code: 'EMPTY_CART', message: 'Add items to the sale before applying a gift card.' };
    const discount = round(valid.type === 'discount' ? base * valid.value / 100 : Math.min(base, valid.balance));
    return { ok: true, discount, total: round(Math.max(0, base - discount)), type: valid.type, remaining: valid.type === 'value' ? round(valid.balance - discount) : 0 };
  }
  function redeem(card, subtotal, saleId, today, now) {
    const id = String(saleId || '').trim();
    if (!id) return { ok: false, code: 'SALE_ID_REQUIRED', message: 'A sale reference is required to redeem this card.' };
    const previous = Array.isArray(card && card.redemptions) ? card.redemptions.find(x => String(x.saleId) === id) : null;
    if (previous) return { ok: true, alreadyProcessed: true, discount: Number(previous.discount) || 0, total: round(Math.max(0, Number(subtotal) - (Number(previous.discount) || 0))), card };
    const result = quote(card, subtotal, today);
    if (!result.ok) return result;
    const next = { ...card };
    const redemption = { saleId: id, subtotal: round(subtotal), discount: result.discount, redeemedAt: Number(now) || Date.now() };
    next.redemptions = [...(Array.isArray(card.redemptions) ? card.redemptions : []), redemption].slice(-200);
    if (result.type === 'discount') next.status = 'redeemed';
    else { next.balance = result.remaining; next.status = result.remaining > 0 ? 'active' : 'redeemed'; }
    next.lastRedeemedAt = redemption.redeemedAt; next.lastSaleId = id;
    return { ok: true, alreadyProcessed: false, discount: result.discount, total: result.total, card: next };
  }
  return { validate, quote, redeem, round };
});
