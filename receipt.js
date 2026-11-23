/* Strap – sales receipt: a JSON template (colours, fonts, text, what to show) plus a renderer used by
   the live preview in Settings, the receipt after a sale, printing and sharing. */
window.StrapReceipt = (() => {
  const esc = StrapUI.esc;
  const HEX = /^#[0-9a-f]{6}$/i;

  const FONTS = {
    'Sora': "Sora, 'Helvetica Neue', Arial, sans-serif",
    'Inter': "Inter, 'Helvetica Neue', Arial, sans-serif",
    'Space Mono': "'Space Mono', 'Courier New', monospace",
    'DM Serif Display': "'DM Serif Display', Georgia, serif",
    'Courier': "'Courier New', Courier, monospace",
    'Georgia': "Georgia, 'Times New Roman', serif"
  };
  const PAPER = { '58mm': 224, '80mm': 304, 'a6': 392 };
  const DIVIDERS = ['dashed', 'dotted', 'solid', 'double', 'none'];

  const defaults = (biz = 'My Store') => ({
    version: 1,
    paper: '80mm',
    font: { family: 'Sora', size: 12, bold: false },
    align: 'center',
    divider: 'dashed',
    colors: { text: '#0a0a0a', background: '#ffffff', accent: '#0a0a0a', muted: '#6b6b66' },
    header: { showLogo: true, logo: '', businessName: biz, tagline: '', address: '', phone: '', email: '', website: '', social: '' },
    meta: { title: 'Receipt', showReceiptNo: true, showDate: true, showCashier: true, showCustomer: true, showPayment: true, cashier: '' },
    items: { showQty: true, showUnitPrice: true, showSku: false },
    totals: { totalLabel: 'Total', showSubtotal: true, showTax: false, taxLabel: 'VAT', taxRate: 7.5 },
    footer: { thanks: 'Thank you for shopping with us!', note: 'Goods sold are not returnable after 7 days.', showThanks: true, showNote: true }
  });

  // merge anything (stored JSON, pasted JSON) over the defaults and drop what isn't valid
  function normalize(src, biz) {
    const d = defaults(biz), out = JSON.parse(JSON.stringify(d)), s = src && typeof src === 'object' ? src : {};
    const str = (v, def, max = 160) => typeof v === 'string' ? v.slice(0, max) : def;
    const bool = (v, def) => typeof v === 'boolean' ? v : def;
    const num = (v, def, lo, hi) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
    const col = (v, def) => typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : def;
    const obj = k => (s[k] && typeof s[k] === 'object' ? s[k] : {});
    out.paper = PAPER[s.paper] ? s.paper : d.paper;
    out.align = s.align === 'left' || s.align === 'center' ? s.align : d.align;
    out.divider = DIVIDERS.includes(s.divider) ? s.divider : d.divider;
    const f = obj('font'); out.font = { family: FONTS[f.family] ? f.family : d.font.family, size: Math.round(num(f.size, d.font.size, 9, 18)), bold: bool(f.bold, d.font.bold) };
    const c = obj('colors'); Object.keys(d.colors).forEach(k => out.colors[k] = col(c[k], d.colors[k]));
    const h = obj('header');
    out.header.showLogo = bool(h.showLogo, d.header.showLogo);
    out.header.logo = typeof h.logo === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(h.logo) && h.logo.length < 200000 ? h.logo : '';
    ['businessName', 'tagline', 'address', 'phone', 'email', 'website', 'social'].forEach(k => out.header[k] = str(h[k], d.header[k]));
    const m = obj('meta'); out.meta.title = str(m.title, d.meta.title, 40); out.meta.cashier = str(m.cashier, '', 60);
    ['showReceiptNo', 'showDate', 'showCashier', 'showCustomer', 'showPayment'].forEach(k => out.meta[k] = bool(m[k], d.meta[k]));
    const it = obj('items'); ['showQty', 'showUnitPrice', 'showSku'].forEach(k => out.items[k] = bool(it[k], d.items[k]));
    const t = obj('totals'); out.totals.totalLabel = str(t.totalLabel, d.totals.totalLabel, 30); out.totals.taxLabel = str(t.taxLabel, d.totals.taxLabel, 30);
    out.totals.taxRate = num(t.taxRate, d.totals.taxRate, 0, 100); out.totals.showSubtotal = bool(t.showSubtotal, d.totals.showSubtotal); out.totals.showTax = bool(t.showTax, d.totals.showTax);
    const ft = obj('footer'); out.footer.thanks = str(ft.thanks, d.footer.thanks, 120); out.footer.note = str(ft.note, d.footer.note, 240);
    out.footer.showThanks = bool(ft.showThanks, d.footer.showThanks); out.footer.showNote = bool(ft.showNote, d.footer.showNote);
    return out;
  }
  const load = biz => normalize(StrapStore.getReceiptRaw(), biz);

  const CSS = `.rc{box-sizing:border-box;width:var(--w);max-width:100%;margin:0 auto;padding:20px 18px 22px;background:var(--bg);color:var(--tx);font:var(--fw) var(--fs)/1.45 var(--ff);text-align:var(--al);-webkit-font-smoothing:antialiased}
.rc *{box-sizing:border-box;margin:0}
.rc-logo{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 10px;border-radius:14px;background:var(--ac);color:var(--bg);font-weight:700;font-size:20px;overflow:hidden}
.rc[data-al=left] .rc-logo{margin-left:0}
.rc-logo img{width:100%;height:100%;object-fit:contain;background:#fff}
.rc-name{font-size:1.45em;font-weight:700;letter-spacing:-.02em;line-height:1.2}
.rc-tag{color:var(--mu);margin-top:2px}
.rc-info{margin-top:8px;color:var(--mu);font-size:.92em;line-height:1.55;word-break:break-word}
.rc-hr{border:0;border-top:1.5px var(--dv) var(--mu);margin:12px 0;height:0;opacity:.7}
.rc-hr[data-n]{border-top-style:solid;opacity:0;margin:6px 0}
.rc-title{font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ac);font-size:.95em}
.rc-row{display:flex;justify-content:space-between;gap:12px;text-align:left}
.rc-row span:first-child{color:var(--mu)}
.rc-row b{font-weight:600;text-align:right;word-break:break-word}
.rc-meta{display:grid;gap:3px;margin-top:8px}
.rc-it{display:grid;gap:8px;text-align:left}
.rc-line{display:flex;justify-content:space-between;gap:12px}
.rc-line b{font-weight:600}.rc-line small{display:block;color:var(--mu);font-size:.88em}
.rc-line em{font-style:normal;font-weight:600;white-space:nowrap}
.rc-tot{display:grid;gap:4px}
.rc-grand{font-size:1.25em;font-weight:700;color:var(--ac);margin-top:2px}
.rc-grand span:first-child{color:var(--ac)}
.rc-thx{font-weight:600;margin-top:2px}
.rc-note{color:var(--mu);font-size:.88em;margin-top:6px;line-height:1.5}`;
  let styled = false;
  const ensureCss = () => { if (styled) return; const s = document.createElement('style'); s.id = 'rc-css'; s.textContent = CSS; document.head.appendChild(s); styled = true; };

  const sample = () => ({
    no: 'S-0042', ts: Date.now(), method: 'card', total: 18700, customer: { name: 'Ada Okafor' }, cashier: 'You',
    lines: [{ title: 'Ankara Tote Bag', price: 9800, qty: 1, sku: 'TB-01' }, { title: 'Canvas Pencil Case', price: 2500, qty: 2, sku: 'PC-07' }, { title: 'Linen Throw Pillow', price: 3900, qty: 1, sku: 'LP-12' }]
  });
  const METHOD = { cash: 'Cash', card: 'Card', transfer: 'Transfer', credit: 'On credit' };
  const fmtDate = ts => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // returns the receipt HTML. `fmt` formats money.
  function render(tplIn, sale, fmt) {
    ensureCss();
    const t = normalize(tplIn), h = t.header, c = t.colors, s = sale || sample();
    const hr = `<hr class="rc-hr" ${t.divider === 'none' ? 'data-n' : ''} style="${t.divider === 'none' ? '' : `border-top-style:${t.divider}`}">`;
    const sub = s.lines.reduce((a, l) => a + l.price * l.qty, 0), total = s.total != null ? s.total : sub;
    const tax = total - total / (1 + t.totals.taxRate / 100);
    const info = [h.address, h.phone, h.email, h.website, h.social].filter(Boolean).map(esc).join('<br>');
    const initial = esc((h.businessName || 'S').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
    const row = (a, b) => `<div class="rc-row"><span>${esc(a)}</span><b>${esc(b)}</b></div>`;
    const meta = [
      t.meta.showReceiptNo && row('Receipt no.', s.no), t.meta.showDate && row('Date', fmtDate(s.ts)),
      t.meta.showCashier && (t.meta.cashier || s.cashier) && row('Cashier', t.meta.cashier || s.cashier),
      t.meta.showCustomer && s.customer && s.customer.name && row('Customer', s.customer.name),
      t.meta.showPayment && row('Payment', METHOD[s.method] || s.method)
    ].filter(Boolean).join('');
    const bal = s.method === 'credit' ? Math.max(0, total - (s.paidNow || 0)) : 0;
    return `<div class="rc" data-al="${t.align}" style="--w:${PAPER[t.paper]}px;--bg:${c.background};--tx:${c.text};--ac:${c.accent};--mu:${c.muted};--fs:${t.font.size}px;--fw:${t.font.bold ? 600 : 400};--ff:${FONTS[t.font.family]};--al:${t.align};--dv:${t.divider === 'none' ? 'solid' : t.divider}">
      ${h.showLogo ? `<div class="rc-logo">${h.logo ? `<img src="${esc(h.logo)}" alt="">` : initial}</div>` : ''}
      <div class="rc-name">${esc(h.businessName || 'Your store')}</div>
      ${h.tagline ? `<div class="rc-tag">${esc(h.tagline)}</div>` : ''}
      ${info ? `<div class="rc-info">${info}</div>` : ''}
      ${hr}<div class="rc-title">${esc(t.meta.title)}</div>
      ${meta ? `<div class="rc-meta">${meta}</div>` : ''}
      ${hr}
      <div class="rc-it">${s.lines.map(l => `<div class="rc-line"><div><b>${esc(l.title)}</b>${(t.items.showQty || t.items.showUnitPrice || (t.items.showSku && l.sku)) ? `<small>${[t.items.showQty && t.items.showUnitPrice ? `${l.qty} × ${fmt(l.price)}` : t.items.showQty ? `Qty ${l.qty}` : t.items.showUnitPrice ? fmt(l.price) : '', t.items.showSku && l.sku ? 'SKU ' + esc(l.sku) : ''].filter(Boolean).join(' · ')}</small>` : ''}</div><em>${fmt(l.price * l.qty)}</em></div>`).join('')}</div>
      ${hr}
      <div class="rc-tot">
        ${t.totals.showSubtotal ? row('Subtotal', fmt(sub)) : ''}
        ${t.totals.showTax && t.totals.taxRate > 0 ? row(`${t.totals.taxLabel} (${t.totals.taxRate}%) included`, fmt(tax)) : ''}
        <div class="rc-row rc-grand"><span>${esc(t.totals.totalLabel)}</span><b>${fmt(total)}</b></div>
        ${s.method === 'credit' ? `${row('Paid now', fmt(s.paidNow || 0))}${row('Balance due', fmt(bal))}` : ''}
      </div>
      ${(t.footer.showThanks && t.footer.thanks) || (t.footer.showNote && t.footer.note) ? hr : ''}
      ${t.footer.showThanks && t.footer.thanks ? `<div class="rc-thx">${esc(t.footer.thanks)}</div>` : ''}
      ${t.footer.showNote && t.footer.note ? `<div class="rc-note">${esc(t.footer.note)}</div>` : ''}
    </div>`;
  }

  // plain text version for sharing (WhatsApp, SMS…)
  function text(tplIn, sale, fmt) {
    const t = normalize(tplIn), h = t.header, s = sale;
    const L = [h.businessName, h.tagline, h.address, h.phone, h.email, h.website, h.social].filter(Boolean);
    L.push('', t.meta.title.toUpperCase(), `No: ${s.no}`, fmtDate(s.ts), '');
    s.lines.forEach(l => L.push(`${l.title}  ${l.qty} x ${fmt(l.price)} = ${fmt(l.qty * l.price)}`));
    L.push('', `${t.totals.totalLabel}: ${fmt(s.total)}`, `Payment: ${METHOD[s.method] || s.method}`);
    if (s.method === 'credit') L.push(`Paid now: ${fmt(s.paidNow || 0)}`, `Balance due: ${fmt(Math.max(0, s.total - (s.paidNow || 0)))}`);
    if (t.footer.showThanks && t.footer.thanks) L.push('', t.footer.thanks);
    return L.join('\n');
  }

  function print(tplIn, sale, fmt) {
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const t = normalize(tplIn), link = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=Inter:wght@400;600;700&family=Space+Mono:wght@400;700&family=DM+Serif+Display&display=swap">';
    f.contentDocument.open();
    f.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.no)}</title>${link}<style>${CSS}@page{margin:6mm}body{margin:0;background:#fff}.rc{box-shadow:none}</style></head><body>${render(t, sale, fmt)}</body></html>`);
    f.contentDocument.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(() => f.remove(), 2500); }, 450);
  }

  return { FONTS, PAPER, DIVIDERS, defaults, normalize, load, render, text, print, sample, METHOD };
})();
