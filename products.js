/* Strap – Products tab: list/grid, add + edit panel, CSV / website import flows, export flows.
   All data calls go through `api` below. Replace those with real backend calls later. */
window.StrapProducts = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const U = StrapUI, ic = U.ic;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // [name, domain, brand colour (fallback tile), address placeholder]
  const SITES = [
    ['Shopify', 'shopify.com', '#5a863e', 'yourstore.myshopify.com'], ['WooCommerce', 'woocommerce.com', '#7f54b3', 'yourstore.com'],
    ['Etsy', 'etsy.com', '#f1641e', 'etsy.com/shop/yourshop'], ['Amazon', 'amazon.com', '#232f3e', 'amazon.com/sp?seller=…'],
    ['eBay', 'ebay.com', '#e53238', 'ebay.com/usr/yourname'], ['Jumia', 'jumia.com.ng', '#f68b1e', 'jumia.com.ng/yourshop'], ['Square', 'squareup.com', '#0a0a0a', 'yourstore.square.site']
  ];
  const CATEGORIES = ['Apparel & accessories', 'Beauty & personal care', 'Electronics', 'Food & drinks', 'Fitness & sports', 'Home & living', 'Stationery & office', 'Other'];
  const EXPORTS = [
    { id: 'pdf', icon: 'pdf', label: 'Export to PDF', ext: 'pdf' },
    { id: 'csv', icon: 'csv', label: 'Export to CSV', ext: 'csv' },
    { id: 'sheet', icon: 'sheet', label: 'Export to spreadsheet', ext: 'xls' },
    { id: 'link', icon: 'link', label: 'Export as link', soon: true }
  ];

  // favicon chain: Google -> DuckDuckGo -> the site's own /favicon.ico -> coloured letter tile (always visible underneath)
  const favSrc = (d, i) => [`https://www.google.com/s2/favicons?domain=${d}&sz=128`, `https://icons.duckduckgo.com/ip3/${d}.ico`, `https://${d}/favicon.ico`][i];
  window.__sfv = (im, ok) => {
    const n = (+im.dataset.i || 0) + 1;
    if (ok && im.naturalWidth >= 20) { im.classList.add('ok'); return; }
    if (n < 3) { im.dataset.i = n; im.src = favSrc(im.dataset.d, n); } else im.remove();
  };
  const fav = ([name, d, col], size = 44) => `<span class="pm-fav" style="--b:${col};width:${size}px;height:${size}px"><em>${name[0]}</em><img src="${favSrc(d, 0)}" data-d="${d}" data-i="0" alt="" referrerpolicy="no-referrer" decoding="async" onload="__sfv(this,1)" onerror="__sfv(this,0)"></span>`;

  // ===== Backend hooks. Products start EMPTY; replace these with real calls. =====
  const DEMO_SITE = [['Canvas Pencil Case', 2500], ['Foam Exercise Mat', 14000], ['Resistance Loop Bands', 6500], ['Conditioning Hair Mask', 5200], ['Ankara Tote Bag', 9800], ['Linen Throw Pillow', 7600]];
  const productBranch = () => {
    try {
      const f1 = JSON.parse(localStorage.getItem('strap.f1') || '{}');
      return String(f1.active || (f1.branches && f1.branches[0] && f1.branches[0].id) || 'b0');
    } catch (e) { return 'b0'; }
  };
  const productKey = () => 'strap.f1.items.' + productBranch();
  const readProducts = () => {
    try { const rows = JSON.parse(localStorage.getItem(productKey()) || '[]'); return Array.isArray(rows) ? rows : []; }
    catch (e) { return []; }
  };
  const writeProducts = async rows => {
    localStorage.setItem(productKey(), JSON.stringify(Array.isArray(rows) ? rows : []));
    const result = await StrapAPI.flush();
    if (!result || !result.ok) throw new Error(result && result.msg || 'Products could not be saved to your Strap database.');
    return rows;
  };
  const api = {
    async getProducts() { return readProducts(); },
    async persistProducts(rows) { return writeProducts(rows); },
    async saveProduct(p) {
      let image = p.image || '';
      const f = (p.media || []).find(x => x && /^image\//.test(x.type || ''));
      if (f) {
        const u = await StrapAPI.upload(f);
        if (!u) throw new Error('The product image could not be uploaded. Please try again.');
        image = u;
      }
      const { media, ...rest } = p;
      // Build the record here, but let the caller persist the final list exactly once.
      // Previously this function flushed the whole store and save() flushed it again,
      // causing duplicate writes and intermittent save failures on slower connections.
      return { ...rest, image, id: p.id ?? ('p' + Date.now() + Math.random().toString(36).slice(2, 7)) };
    },
    async deleteProduct(id) {
      await writeProducts(readProducts().filter(x => String(x.id) !== String(id)));
      return { ok: true };
    },
    async importCsv(list) {
      const existing = readProducts();
      const added = (Array.isArray(list) ? list : []).map((item, i) => ({ ...item, id: item.id || ('p' + Date.now() + i + Math.random().toString(36).slice(2, 5)) }));
      await writeProducts([...added, ...existing]);
      return added;
    },
    async importFromSite() { throw new Error('Direct website imports are not connected yet. Use CSV import for now.'); },
    async exportProducts() { return { ok: true }; }
  };

  // ===== helpers: CSV in/out, PDF, downloads =====
  function parseCsv(t) {
    const rows = []; let r = [], c = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === ';' || ch === '\t') { r.push(c); c = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); c = ''; rows.push(r); r = []; }
      else c += ch;
    }
    if (c || r.length) { r.push(c); rows.push(r); }
    return rows.filter(x => x.some(v => v.trim()));
  }
  function csvToProducts(text) {
    const rows = parseCsv(text.replace(/^\uFEFF/, '')); if (rows.length < 2) return { ok: [], skipped: 0 };
    const h = rows[0].map(x => x.trim().toLowerCase());
    const col = re => h.findIndex(x => re.test(x));
    const ti = col(/^(title|name|product|product name)$/), pi = col(/^(price|selling price|variant price)/), qi = col(/(qty|quantity|stock|inventory)/),
      si = col(/status/), ki = col(/sku/), ii = col(/(image|photo|img)/);
    if (ti < 0) return { ok: [], skipped: rows.length - 1 };
    const ok = []; let skipped = 0;
    rows.slice(1).forEach(r => {
      const title = (r[ti] || '').trim(); if (!title) { skipped++; return; }
      const qty = qi >= 0 && r[qi] !== undefined && r[qi].trim() !== '' ? Math.max(0, parseInt(r[qi], 10) || 0) : null;
      const st = si >= 0 ? (r[si] || '').trim().toLowerCase() : '';
      ok.push({ title, price: pi >= 0 ? parseFloat((r[pi] || '').replace(/[^\d.]/g, '')) || 0 : 0, tracked: qty !== null, qty: qty || 0, status: ['active', 'draft', 'archived'].includes(st) ? st : 'active', sku: ki >= 0 ? (r[ki] || '').trim() : '', image: ii >= 0 && /^https?:/i.test(r[ii] || '') ? r[ii].trim() : '' });
    });
    return { ok, skipped };
  }
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const stockOf = p => p.tracked ? p.qty : '';
  function buildFile(fmt, list, cur) {
    if (fmt === 'csv') {
      const t = ['Title,Status,Price,Quantity,SKU,Category,Vendor', ...list.map(p => [q(p.title), p.status, p.price || 0, stockOf(p), q(p.sku), q(p.category), q(p.vendor)].join(','))].join('\r\n');
      return new Blob(['\uFEFF' + t], { type: 'text/csv;charset=utf-8' });
    }
    if (fmt === 'sheet') {
      const e = U.esc, t = `<html><head><meta charset="utf-8"></head><body><table border="1"><tr><th>Title</th><th>Status</th><th>Price</th><th>Quantity</th><th>SKU</th><th>Category</th><th>Vendor</th></tr>${list.map(p => `<tr><td>${e(p.title)}</td><td>${e(p.status)}</td><td>${p.price || 0}</td><td>${stockOf(p)}</td><td>${e(p.sku || '')}</td><td>${e(p.category || '')}</td><td>${e(p.vendor || '')}</td></tr>`).join('')}</table></body></html>`;
      return new Blob([t], { type: 'application/vnd.ms-excel' });
    }
    // minimal PDF (Courier, ASCII)
    const cl = s => String(s).replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1');
    const pad = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '.' : String(s).padEnd(n));
    const lines = ['Strap - Products', new Date().toDateString(), '', pad('TITLE', 32) + pad('STATUS', 10) + pad('PRICE', 14) + 'STOCK', '-'.repeat(64),
      ...list.map(p => pad(p.title, 32) + pad(p.status, 10) + pad(`${cur} ${Math.round(p.price || 0).toLocaleString('en')}`, 14) + (p.tracked ? p.qty : '-'))];
    const per = 48, pages = []; for (let i = 0; i < lines.length; i += per) pages.push(lines.slice(i, i + per));
    const objs = ['<</Type/Catalog/Pages 2 0 R>>', '', '<</Type/Font/Subtype/Type1/BaseFont/Courier>>'], kids = [];
    pages.forEach(pg => {
      const s = 'BT /F1 10 Tf 14 TL 40 800 Td\n' + pg.map(l => `(${cl(l)}) Tj T*`).join('\n') + '\nET';
      objs.push(`<</Length ${s.length}>>\nstream\n${s}\nendstream`); const ci = objs.length;
      objs.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents ${ci} 0 R/Resources<</Font<</F1 3 0 R>>>>>>`); kids.push(objs.length + ' 0 R');
    });
    objs[1] = `<</Type/Pages/Count ${kids.length}/Kids[${kids.join(' ')}]>>`;
    let out = '%PDF-1.4\n', off = [];
    objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF`;
    return new Blob([out], { type: 'application/pdf' });
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function mount(root, ctx) {
    const { toast, esc, money, cur } = ctx;
    let items = [], status = 'all', query = '', sort = 'new', loading = true, searchOpen = false;
    let viewMode = 'list'; try { viewMode = sessionStorage.getItem('strap.pview') || 'list'; } catch (e) {}
    const picked = new Set();
    const nm = n => (n || '').toString();

    root.innerHTML = `
      <div class="pm">
        <header class="pm-head">
          <h1 class="pm-title"><span class="pm-tico">${ic('tag', 24, 1.8)}</span>Products</h1>
          <button class="pm-add sm" type="button" id="pm-add" hidden>Add product</button>
          <button class="pm-round" type="button" id="pm-more" aria-label="More actions" aria-haspopup="menu" aria-expanded="false" hidden>${ic('dots', 24)}</button>
          <div class="pm-pop" id="pm-pop" role="menu" hidden></div>
        </header>
        <section class="pm-box">
          <div class="pm-tools">
            <div class="pm-tabs" id="pm-tabs"></div>
            <div class="pm-tr">
              <button type="button" class="pm-pl wide" id="pm-sbtn" aria-label="Search and filter">${ic('search', 20, 2)}${ic('filter', 18, 2)}</button>
              <button type="button" class="pm-pl" id="pm-vbtn"></button>
            </div>
          </div>
          <div class="pm-sbar" id="pm-sbar" hidden>
            <label class="pm-si">${ic('search', 18, 2)}<input id="pm-q" type="search" placeholder="Search products" autocomplete="off"></label>
            <label class="pm-so"><select id="pm-sort" aria-label="Sort products"><option value="new">Newest</option><option value="az">Name A–Z</option><option value="lo">Price: low to high</option><option value="hi">Price: high to low</option></select>${ic('chevUD', 16, 2.2)}</label>
          </div>
          <div class="pm-selbar" id="pm-selbar" hidden><b></b><button type="button" id="pm-clear">Clear</button></div>
          <div id="pm-body"></div>
        </section>
      </div>`;

    const body = $('#pm-body', root), selbar = $('#pm-selbar', root), tabs = $('#pm-tabs', root);
    const invText = p => p.tracked ? (p.qty > 0 ? `${p.qty} in stock` : 'Out of stock') : 'Inventory not tracked';
    const label = s => ({ active: 'Active', draft: 'Draft', archived: 'Archived' }[s] || s);
    const visible = () => {
      let r = items.filter(p => (status === 'all' || p.status === status) && nm(p.title).toLowerCase().includes(query.toLowerCase()));
      if (sort === 'az') r.sort((a, b) => nm(a.title).localeCompare(nm(b.title)));
      if (sort === 'lo') r.sort((a, b) => (a.price || 0) - (b.price || 0));
      if (sort === 'hi') r.sort((a, b) => (b.price || 0) - (a.price || 0));
      return r;
    };
    const ck = p => `<label class="pm-ck"><input type="checkbox" data-id="${p.id}" ${picked.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.title)}"><span>${ic('check', 14, 3.2)}</span></label>`;
    const thumb = p => p.image ? `<img src="${esc(p.image)}" alt="" onerror="this.remove()">` : ic('image', 28, 1.6);
    const rowHtml = p => `<li class="pm-row" data-id="${p.id}" tabindex="0">${ck(p)}<div class="pm-img">${thumb(p)}</div><div class="pm-info"><b>${esc(p.title)}</b><span class="pm-badge ${p.status}">${label(p.status)}</span><small>${invText(p)}</small></div><span class="pm-price">${money(p.price || 0)}</span></li>`;
    const cardHtml = p => `<li class="pm-gc" data-id="${p.id}" tabindex="0">${ck(p)}<div class="pm-gimg">${thumb(p)}</div><b>${esc(p.title)}</b><span class="pm-badge ${p.status}">${label(p.status)}</span><small>${invText(p)}</small><span class="pm-price">${money(p.price || 0)}</span></li>`;

    function renderChrome() {
      const has = items.length > 0 && !loading;
      $('#pm-add', root).hidden = !has; $('#pm-more', root).hidden = !has;
      const vb = $('#pm-vbtn', root), sb = $('#pm-sbtn', root);
      vb.innerHTML = ic(viewMode === 'list' ? 'grid' : 'list', 20, 2); vb.setAttribute('aria-label', viewMode === 'list' ? 'Switch to column view' : 'Switch to list view');
      [vb, sb].forEach(b => { b.disabled = !has; b.classList.toggle('off', !has); });
      sb.classList.toggle('on', searchOpen && has);
      $('#pm-sbar', root).hidden = !(searchOpen && has);
      tabs.innerHTML = has
        ? [['all', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived']].map(([v, l]) => `<button type="button" class="pm-tab${status === v ? ' on' : ''}" data-s="${v}">${l}</button>`).join('')
        : `<button type="button" class="pm-tab on">All</button><button type="button" class="pm-tab plus" data-plus aria-label="Add a saved view">${ic('plus', 20, 2)}</button>`;
    }
    function renderBody() {
      if (loading) { body.innerHTML = `<ul class="pm-list">${Array.from({ length: 4 }, () => '<li class="pm-row sk"><span class="pm-img"></span><div class="pm-info"><b></b><i></i></div></li>').join('')}</ul>`; return; }
      if (!items.length) {
        body.innerHTML = `
          <div class="pm-es">
            ${U.illus('products')}
            <h2>Add your products</h2>
            <p>Start by stocking your store with products your customers will love</p>
            <div class="pm-acts"><button type="button" class="pm-add" data-act="add">${ic('plus', 20, 2.2)} Add product</button><button type="button" class="pm-imp" data-act="import">${ic('download', 20, 2)} Import</button></div>
          </div>
          <div class="pm-es2">
            <h3>Products and importing</h3>
            <p>Add products one by one, or bring your whole catalogue over by importing it from another app or website.</p>
          </div>`; return;
      }
      const rows = visible();
      if (!rows.length) { body.innerHTML = `<div class="pm-nomatch">${ic('search', 26, 1.8)}<p>No products match your search.</p></div>`; return; }
      body.innerHTML = viewMode === 'grid' ? `<ul class="pm-grid">${rows.map(cardHtml).join('')}</ul>` : `<ul class="pm-list">${rows.map(rowHtml).join('')}</ul>`;
      body.querySelectorAll('.pm-row[data-id], .pm-gc[data-id]').forEach(item => {
        const open = e => { if (e && e.target && e.target.closest && e.target.closest('.pm-ck')) return; const product = items.find(x => String(x.id) === String(item.dataset.id)); if (product) openPage(product); else toast('This product could not be opened. Refresh and try again.'); };
        item.addEventListener('click', open);
        item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
      });
    }
    function renderSel() { selbar.hidden = !picked.size; $('b', selbar).textContent = `${picked.size} selected`; }
    const subs = [];
    function refreshLists() {
      const pg = document.querySelector('.pm-page'); if (!pg) return;
      const uniq = k => [...new Set(items.map(p => String(p[k] || '').trim()).filter(Boolean))];
      const fill = (id, base) => { const dl = pg.querySelector('#' + id); if (dl) dl.innerHTML = [...new Set(base)].map(v => `<option>${esc(v)}</option>`).join(''); };
      fill('pm-types', ['Physical', 'Digital', 'Service', ...uniq('type')]); fill('pm-vendors', uniq('vendor'));
    }
    function renderAll() { renderChrome(); renderBody(); renderSel(); refreshLists(); subs.forEach(f => { try { f(); } catch (e) {} }); }

    // ----- events on the list page -----
    root.addEventListener('click', e => {
      const t = e.target;
      const act = t.closest('[data-act]');
      if (act) { const a = act.dataset.act; if (a === 'import') openImport(); if (a === 'discover') toast('Product sourcing is coming soon'); return; }
      if (t.closest('#pm-more')) return togglePop();
      if (t.closest('#pm-clear')) { picked.clear(); renderBody(); renderSel(); return; }
      if (t.closest('[data-plus]')) return toast('Saved views are coming soon');
      const tb = t.closest('.pm-tab[data-s]'); if (tb) { status = tb.dataset.s; renderChrome(); renderBody(); return; }
      if (t.closest('#pm-sbtn') && items.length) { searchOpen = !searchOpen; renderChrome(); if (searchOpen) $('#pm-q', root).focus(); return; }
      if (t.closest('#pm-vbtn') && items.length) {
        viewMode = viewMode === 'list' ? 'grid' : 'list'; try { sessionStorage.setItem('strap.pview', viewMode); } catch (er) {}
        renderChrome(); renderBody(); toast(viewMode === 'grid' ? 'Column view' : 'List view'); return;
      }
    }, true);
    body.addEventListener('click', e => { const add = e.target.closest('[data-act="add"]'); if (add) { e.preventDefault(); openPage(); } });
    const headerAdd = $('#pm-add', root);
    if (headerAdd) headerAdd.addEventListener('click', e => { e.preventDefault(); openPage(); });
    body.addEventListener('change', e => { const c = e.target.closest('input[type=checkbox]'); if (!c) return; c.checked ? picked.add(c.dataset.id) : picked.delete(c.dataset.id); renderSel(); });
    $('#pm-q', root).addEventListener('input', e => { query = e.target.value.trim(); renderBody(); });
    $('#pm-sort', root).addEventListener('change', e => { sort = e.target.value; renderBody(); });

    // ----- three-dots menu (only exists once there are products) -----
    const pop = $('#pm-pop', root), moreBtn = $('#pm-more', root);
    pop.innerHTML = `<button type="button" role="menuitem" class="pm-pi" data-m="import"><span class="pm-pico">${ic('download', 20)}</span><span>Import products</span></button><p class="pm-pop-h">Export products</p>` + EXPORTS.map(x =>
      `<button type="button" role="menuitem" class="pm-pi${x.soon ? ' soon' : ''}" data-x="${x.id}"><span class="pm-pico">${ic(x.icon, 20)}</span><span>${x.label}</span>${x.soon ? '<em>Coming soon</em>' : ''}</button>`).join('');
    function togglePop(force) { const open = force !== undefined ? force : pop.hidden; pop.hidden = !open; moreBtn.setAttribute('aria-expanded', open); }
    pop.addEventListener('click', e => {
      const b = e.target.closest('.pm-pi'); if (!b) return; togglePop(false);
      if (b.dataset.m === 'import') return openImport();
      const x = EXPORTS.find(v => v.id === b.dataset.x);
      if (x.soon) return toast('Export as link is coming soon');
      exportScreen(x);
    });
    document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('#pm-pop') && !e.target.closest('#pm-more')) togglePop(false); });

    // ===== bottom sheet: import options =====
    const sheetWrap = document.createElement('div');
    sheetWrap.className = 'pm-layer'; sheetWrap.hidden = true;
    sheetWrap.innerHTML = `
      <div class="pm-scrim"></div>
      <section class="pm-sheet" role="dialog" aria-modal="true" aria-label="Import products">
        <div class="pm-grab"><i></i></div>
        <div class="pm-view" data-v="main">
          <div class="pm-sh"><h2>Import products</h2><button type="button" class="pm-x" data-close aria-label="Close">${ic('close', 20, 2.2)}</button></div>
          <button type="button" class="pm-opt" data-o="csv"><span class="pm-oi">${ic('csv', 24)}</span><span class="pm-ot"><b>Import via CSV</b><small>Accepts .csv, .txt and .xls</small></span>${ic('chevR', 20, 2)}</button>
          <button type="button" class="pm-opt" data-o="sites"><span class="pm-oi">${ic('globe', 24)}</span><span class="pm-ot"><b>Import from a website</b><small>Bring your catalogue from another store</small></span>${ic('chevR', 20, 2)}</button>
        </div>
        <div class="pm-view" data-v="sites" hidden>
          <div class="pm-sh"><button type="button" class="pm-x" data-back aria-label="Back">${ic('back', 20, 2.2)}</button><h2>Import from a website</h2><button type="button" class="pm-x" data-close aria-label="Close">${ic('close', 20, 2.2)}</button></div>
          <ul class="pm-sites">${SITES.map((s, i) => `<li><button type="button" class="pm-site" data-site="${i}">${fav(s)}<b>${s[0]}</b>${ic('chevR', 18, 2)}</button></li>`).join('')}</ul>
        </div>
      </section>`;
    document.body.appendChild(sheetWrap);
    const sheet = $('.pm-sheet', sheetWrap);
    const showView = v => $$('.pm-view', sheet).forEach(el => { el.hidden = el.dataset.v !== v; });
    function openSheet() { showView('main'); sheet.style.transform = ''; sheetWrap.hidden = false; document.body.classList.add('pm-open'); void sheet.offsetWidth; sheetWrap.classList.add('on'); }
    function closeSheet(keepLock) { sheetWrap.classList.remove('on'); if (!keepLock) document.body.classList.remove('pm-open'); setTimeout(() => { if (!sheetWrap.classList.contains('on')) sheetWrap.hidden = true; }, 380); }
    const openImport = openSheet;
    const openAI = () => StrapFeatures.aiImport(list => { items = [...list, ...items]; renderAll(); StrapFeatures.setItems(items); });
    sheetWrap.addEventListener('click', e => {
      if (e.target.closest('.pm-scrim') || e.target.closest('[data-close]')) return closeSheet();
      if (e.target.closest('[data-back]')) return showView('main');
      const o = e.target.closest('.pm-opt');
      if (o) { if (o.dataset.o === 'ai') { closeSheet(); openAI(); } if (o.dataset.o === 'csv') { closeSheet(true); csvPicker(); } if (o.dataset.o === 'sites') showView('sites'); return; }
      const s = e.target.closest('.pm-site'); if (s) { closeSheet(true); siteConnect(SITES[+s.dataset.site]); }
    });
    let y0 = null, dy = 0; const grab = $('.pm-grab', sheet);
    grab.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; }, { passive: true });
    grab.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
    grab.addEventListener('touchend', () => { sheet.style.transition = ''; if (dy > 90) closeSheet(); else sheet.style.transform = ''; y0 = null; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!sheetWrap.hidden) closeSheet(); else if (!flow.hidden) fClose(); else if (!page.hidden) closePage(); togglePop(false); } });

    // ===== full-screen flow screens (import / export) =====
    const flow = document.createElement('div'); flow.className = 'pm-flow'; flow.hidden = true; document.body.appendChild(flow);
    let tok = 0, A = {};
    const fOpen = h => { tok++; A = {}; flow.innerHTML = h; flow.hidden = false; document.body.classList.add('pm-open'); void flow.offsetWidth; flow.classList.add('on'); };
    const fSet = h => { A = {}; flow.innerHTML = h; flow.scrollTop = 0; };
    const fClose = () => { tok++; flow.classList.remove('on'); document.body.classList.remove('pm-open'); setTimeout(() => { if (!flow.classList.contains('on')) { flow.hidden = true; flow.innerHTML = ''; } }, 360); };
    flow.addEventListener('click', e => { if (e.target.closest('[data-fclose]')) return fClose(); const b = e.target.closest('[data-a]'); if (b && A[b.dataset.a]) A[b.dataset.a](b, e); });
    flow.addEventListener('change', e => { if (e.target.matches('input[type=file]') && A.file) A.file(e.target.files[0]); if (e.target.matches('input[name=scope]') && A.scope) A.scope(e.target.value); });
    flow.addEventListener('input', e => { if (e.target.matches('[data-addr]') && A.addr) A.addr(e.target.value); });
    flow.addEventListener('dragover', e => { const d = e.target.closest('.fl-drop'); if (d) { e.preventDefault(); d.classList.add('hot'); } });
    flow.addEventListener('dragleave', e => { const d = e.target.closest('.fl-drop'); if (d) d.classList.remove('hot'); });
    flow.addEventListener('drop', e => { const d = e.target.closest('.fl-drop'); if (d) { e.preventDefault(); d.classList.remove('hot'); if (A.file && e.dataTransfer.files[0]) A.file(e.dataTransfer.files[0]); } });

    const top = back => `<div class="fl-top">${back ? `<button type="button" class="pm-round" data-a="back" aria-label="Back">${ic('back', 22, 2.2)}</button>` : '<span></span>'}<button type="button" class="pm-round" data-fclose aria-label="Close">${ic('close', 22, 2.2)}</button></div>`;
    const progScreen = (title, sub, steps) => `${top()}<div class="fl-body c"><div class="fl-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" pathLength="1"/></svg><div class="fl-core"><b class="fl-pct">0%</b><small class="fl-cnt">&nbsp;</small></div></div><h1>${title}</h1><p class="fl-sub">${sub}</p><ul class="fl-steps">${steps.map(s => `<li><i>${ic('check', 14, 3.4)}</i><span>${s}</span></li>`).join('')}</ul></div>`;
    const doneScreen = (title, sub, stats, cta) => `${top()}<div class="fl-body c"><div class="fl-ok"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="rg"/><path d="m38 62 16 16 30-34" class="ck"/></svg></div><h1>${title}</h1><p class="fl-sub">${sub}</p>${stats.length ? `<div class="fl-stats">${stats.map(([n, l]) => `<div><b>${n}</b><small>${l}</small></div>`).join('')}</div>` : ''}<button type="button" class="pm-add fl-cta" data-a="done">${cta}</button></div>`;
    const errScreen = (title, sub, cta) => `${top()}<div class="fl-body c"><div class="fl-bad">${ic('warn', 44, 1.8)}</div><h1>${title}</h1><p class="fl-sub">${sub}</p><button type="button" class="pm-add fl-cta" data-a="retry">${cta}</button><button type="button" class="pm-ghost fl-cta2" data-fclose>Cancel</button></div>`;

    // animated progress: ring + percentage + ticking steps; resolves false if the screen was closed meanwhile
    async function run(my, total, ms, unit = 'products') {
      const fg = $('.fl-ring .fg', flow), pc = $('.fl-pct', flow), cnt = $('.fl-cnt', flow), lis = $$('.fl-steps li', flow), t0 = performance.now();
      for (;;) {
        if (my !== tok) return false;
        const p = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - p, 1.5), k = Math.min(lis.length - 1, Math.floor(e * lis.length));
        fg.style.strokeDashoffset = 1 - e; pc.textContent = Math.round(e * 100) + '%';
        if (total) cnt.textContent = `${Math.round(e * total)} of ${total} ${unit}`;
        lis.forEach((li, i) => { li.classList.toggle('done', i < k || p >= 1); li.classList.toggle('act', i === k && p < 1); });
        if (p >= 1) { await sleep(450); return my === tok; }
        await sleep(50);
      }
    }

    // ----- CSV import -----
    function csvPicker() {
      fOpen(`${top()}<div class="fl-body"><div class="fl-hero">${U.illus('csv')}</div><h1>Import via CSV</h1><p class="fl-sub">Upload a spreadsheet from your old store, or a file you prepared yourself.</p>
        <label class="fl-drop"><input type="file" accept=".csv,.txt,.xls,.xlsx" hidden><span class="fl-dico">${ic('upload', 28, 1.8)}</span><b>Choose a file</b><small>or drag and drop it here</small></label>
        <p class="fl-fm">Accepts .csv, .txt and .xls</p>
        <ul class="fl-tips"><li>${ic('check', 16, 2.6)}<span>A <b>Title</b> column is required</span></li><li>${ic('check', 16, 2.6)}<span>Optional: Price, Quantity, Status, SKU, Image</span></li></ul>
        <button type="button" class="pm-ghost fl-link" data-a="sample">${ic('download', 18, 2)} Download sample CSV</button></div>`);
      A.file = csvRun;
      A.sample = () => download(new Blob(['Title,Price,Quantity,Status,SKU\r\nCanvas Pencil Case,2500,24,active,CPC-01\r\nFoam Exercise Mat,14000,9,draft,FEM-02\r\n'], { type: 'text/csv' }), 'strap-sample.csv');
    }
    async function csvRun(file) {
      if (!file) return; const my = tok, ext = (file.name.split('.').pop() || '').toLowerCase(); let res = { ok: [], skipped: 0 }, err = null;
      if (ext === 'xls' || ext === 'xlsx') err = ['Spreadsheet files aren’t supported yet', 'Save your file as .csv (Save as → CSV) and upload it again.'];
      else { try { res = csvToProducts(await file.text()); } catch (e) { err = ['We couldn’t read that file', 'Make sure it’s a plain CSV or text file and try again.']; } if (!err && !res.ok.length) err = ['No products found', 'We couldn’t find a Title column, or every row was empty. Check the sample file for the format.']; }
      if (err) { fSet(errScreen(err[0], err[1], 'Try another file')); A.retry = csvPicker; return; }
      fSet(progScreen('Importing your products', file.name, ['Reading your file', 'Checking columns', 'Matching products', 'Adding to your store']));
      const total = res.ok.length, saved = api.importCsv(res.ok);
      if (!(await run(my, total, Math.min(6500, 2400 + total * 30)))) return;
      try {
        const list = await saved; items = [...list, ...items]; renderAll();
        fSet(doneScreen(`${list.length} product${list.length === 1 ? '' : 's'} imported`, res.skipped ? 'Some rows had no title, so we skipped them.' : 'They’re in your catalogue now. Tap any product to edit it.', [[list.length, 'Imported'], [res.skipped, 'Skipped']], 'View products')); A.done = fClose;
      } catch (e) { fSet(errScreen('Import failed', 'Something went wrong while saving your products.', 'Try again')); A.retry = csvPicker; }
    }

    // ----- website import -----
    function siteConnect(s) {
      let addr = '';
      fOpen(`${top()}<div class="fl-body"><div class="fl-hero sm">${fav(s, 84)}</div><h1>Import from ${s[0]}</h1><p class="fl-sub">Enter your ${s[0]} store address and we’ll bring your catalogue across.</p>
        <label class="pm-fl"><span>Store address</span><input data-addr type="text" inputmode="url" autocapitalize="none" autocomplete="off" placeholder="${s[3]}"></label>
        <p class="fl-note">${ic('lock', 16, 2)}<span>We only read your product catalogue. Nothing on ${s[0]} is changed.</span></p>
        <button type="button" class="pm-add fl-cta" data-a="go" disabled>Connect store</button></div>`);
      const go = $('[data-a=go]', flow);
      A.addr = v => { addr = v.trim(); go.disabled = addr.length < 3; };
      A.go = () => siteRun(s, addr);
    }
    async function siteRun(s, addr) {
      const my = tok;
      fSet(progScreen(`Importing from ${s[0]}`, esc(addr), [`Connecting to ${s[0]}`, 'Finding your products', 'Copying photos and prices', 'Adding to your store']));
      let list = []; const call = api.importFromSite(s[0].toLowerCase(), addr).then(r => list = r).catch(() => null);
      const rp = run(my, 0, 5200);
      const [ok] = await Promise.all([rp, call]); if (!ok) return;
      if (!list.length) { fSet(errScreen('No products found', `We connected to ${s[0]} but couldn’t find any products to import.`, 'Try another address')); A.retry = () => siteConnect(s); return; }
      items = [...list, ...items]; renderAll();
      fSet(doneScreen(`${list.length} products imported`, `Your ${s[0]} catalogue is now in Strap.`, [[list.length, 'Imported'], [0, 'Skipped']], 'View products')); A.done = fClose;
    }

    // ----- export -----
    function exportScreen(x) {
      const all = items.length, sel = picked.size, view = visible().length; let scope = sel ? 'sel' : 'all';
      if (!all) { fOpen(`${top()}<div class="fl-body c"><div class="fl-hero">${U.illus('products')}</div><h1>Nothing to export yet</h1><p class="fl-sub">Add a few products first, then come back to export them.</p><button type="button" class="pm-add fl-cta" data-fclose>Got it</button></div>`); return; }
      const opt = (v, l, n, off) => `<label class="fl-sc${off ? ' off' : ''}"><input type="radio" name="scope" value="${v}" ${v === scope ? 'checked' : ''} ${off ? 'disabled' : ''}><span class="rd"></span><b>${l}</b><small>${n} product${n === 1 ? '' : 's'}</small></label>`;
      fOpen(`${top()}<div class="fl-body"><div class="fl-hero sm"><span class="fl-xi">${ic(x.icon, 34, 1.7)}</span></div><h1>${x.label}</h1><p class="fl-sub">Choose what to include in your file.</p>
        <div class="fl-scs">${opt('all', 'All products', all)}${opt('view', 'Current view', view, view === all)}${opt('sel', 'Selected products', sel, !sel)}</div>
        <button type="button" class="pm-add fl-cta" data-a="go">${ic('download', 20, 2)} Export</button></div>`);
      A.scope = v => { scope = v; }; A.go = () => exportRun(x, scope === 'sel' ? items.filter(p => picked.has(p.id)) : scope === 'view' ? visible() : items.slice());
    }
    async function exportRun(x, list) {
      const my = tok;
      fSet(progScreen('Preparing your export', x.label.replace('Export to ', '').replace('Export as ', '').toUpperCase() + ' file', ['Gathering your products', `Formatting as ${x.id === 'sheet' ? 'a spreadsheet' : x.id.toUpperCase()}`, 'Packing your file']));
      let blob; try { await api.exportProducts(x.id, list); blob = buildFile(x.id, list, ctx.cur); } catch (e) { fSet(errScreen('Export failed', 'We couldn’t build your file. Please try again.', 'Try again')); A.retry = () => exportRun(x, list); return; }
      if (!(await run(my, list.length, 2800 + list.length * 15))) return;
      const name = `strap-products-${new Date().toISOString().slice(0, 10)}.${x.ext}`;
      fSet(doneScreen('Your file is ready', `${list.length} product${list.length === 1 ? '' : 's'} · ${name}`, [], `${ic('download', 20, 2)} Download file`));
      $('.fl-cta', flow).insertAdjacentHTML('afterend', '<button type="button" class="pm-ghost fl-cta2" data-fclose>Done</button>');
      A.done = () => { download(blob, name); toast('Download started'); };
    }

    // ===== full page: add product manually =====
    const page = document.createElement('div');
    page.className = 'pm-page'; page.hidden = true;
    page.innerHTML = `
      <div class="pm-pbar"><button type="button" class="pm-round" data-pback aria-label="Back">${ic('back', 22, 2.2)}</button></div>
      <form class="pm-form" novalidate>
        <h1 id="pm-ptitle">Add product</h1>

        <section class="pm-card">
          <label class="pm-fl"><span>Title</span><input name="title" type="text" placeholder="Short sleeve t-shirt" autocomplete="off"></label>
          <p class="pm-lb">Description</p>
          <div class="pm-rte">
            <div class="pm-tb">
              <label class="pm-sel"><select data-fmt data-dd="textstyle" aria-label="Text style"><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option></select>${ic('chevD', 16, 2.4)}</label>
              <button type="button" data-cmd="bold" aria-label="Bold"><b>B</b></button>
              <button type="button" data-cmd="italic" aria-label="Italic"><i>I</i></button>
              <button type="button" data-cmd="underline" aria-label="Underline"><u>U</u></button>
              <button type="button" data-cmd="insertUnorderedList" aria-label="Bulleted list">${'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".6" fill="currentColor"/><circle cx="4.5" cy="12" r=".6" fill="currentColor"/><circle cx="4.5" cy="18" r=".6" fill="currentColor"/></svg>'}</button>
            </div>
            <div class="pm-ed" contenteditable="true" data-ph="Tell customers what makes this product great"></div>
          </div>
          <p class="pm-lb">Media</p>
          <div class="pm-drop">
            <div class="pm-thumbs" hidden></div>
            <div class="pm-dacts"><button type="button" class="pm-pill" data-upload>Upload new</button><button type="button" class="pm-ghost" data-existing>Select existing</button></div>
            <small>Accepts images, videos, or 3D models</small>
            <input type="file" accept="image/*,video/*,.glb,.gltf" multiple hidden data-file>
          </div>
          <p class="pm-lb">Category</p>
          <label class="pm-fl sel"><select name="category"><option value="">Choose a product category</option>${CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select>${ic('chevUD', 18, 2)}</label>
          <p class="pm-hint">Helps organise your catalogue and makes search and filters work better.</p>
          <div class="pm-sep"></div><h3 class="pm-card-title">Food &amp; menu details <small>Optional · useful for restaurants, cafés and bakeries</small></h3>
          <label class="pm-fl"><span>Menu type</span><select name="foodType"><option value="">Choose menu type</option><option>Starter</option><option>Main course</option><option>Side</option><option>Dessert</option><option>Drink</option><option>Snack</option><option>Bakery</option><option>Combo / platter</option></select></label>
          <label class="pm-fl"><span>Serving size / portion</span><input name="servingSize" type="text" placeholder="e.g. 1 plate, 500 ml, serves 2"></label>
          <label class="pm-fl"><span>Preparation time</span><input name="prepTime" type="text" placeholder="e.g. 15–20 minutes"></label>
          <label class="pm-fl"><span>Ingredients / contents</span><textarea name="ingredients" rows="2" placeholder="List key ingredients or what is included"></textarea></label>
          <label class="pm-fl"><span>Dietary information / allergens</span><input name="dietary" type="text" placeholder="e.g. Vegetarian, contains nuts, dairy-free"></label>
        </section>

        <h2 class="pm-h">Price</h2>
        <section class="pm-card">
          <label class="pm-fl money"><span class="cur">₦</span><input name="price" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></label>
          <div class="pm-sep"></div>
          <div class="pm-chips">
            <button type="button" class="pm-chip" data-reveal="cmp">Compare-at</button>
            <button type="button" class="pm-chip" data-reveal="unit">Unit price</button>
            <button type="button" class="pm-chip" data-toggle="tax" data-on="Yes" data-off="No">Charge tax <em class="on">Yes</em></button>
            <button type="button" class="pm-chip" data-reveal="cost">Cost per item</button>
          </div>
          <label class="pm-fl money rv" data-f="cmp" hidden><span class="cur">₦</span><input name="compare" type="number" inputmode="decimal" min="0" placeholder="Compare-at price"></label>
          <label class="pm-fl rv" data-f="unit" hidden><span>Unit price</span><input name="unit" type="text" placeholder="e.g. ₦500 per 100g"></label>
          <label class="pm-fl money rv" data-f="cost" hidden><span class="cur">₦</span><input name="cost" type="number" inputmode="decimal" min="0" placeholder="Cost per item"></label>
        </section>

        <section class="pm-card">
          <div class="pm-trow"><h3>Inventory</h3><span class="pm-tl">Inventory tracked</span><button type="button" class="pm-sw on" role="switch" aria-checked="true" data-sw="tracked" aria-label="Track inventory"><i></i></button></div>
          <div class="pm-inv" data-f="invbox">
            <div class="pm-invh"><span>Location</span><span>Quantity</span></div>
            <div class="pm-invr"><b>Shop location</b>
              <div class="pm-step"><input name="qty" type="number" inputmode="numeric" min="0" value="0" aria-label="Quantity"><button type="button" data-step="-1" aria-label="Decrease">−</button><button type="button" data-step="1" aria-label="Increase">+</button></div>
            </div>
          </div>
          <div class="pm-sep"></div>
          <div class="pm-chips">
            <button type="button" class="pm-chip" data-reveal="sku">SKU</button>
            <button type="button" class="pm-chip" data-reveal="barcode">Barcodes</button>
            <button type="button" class="pm-chip" data-toggle="oos" data-on="On" data-off="Off">Sell when out of stock <em>Off</em></button>
          </div>
          <label class="pm-fl rv" data-f="sku" hidden><span>SKU</span><input name="sku" type="text" autocomplete="off"></label>
          <label class="pm-fl rv" data-f="barcode" hidden><span>Barcode</span><input name="barcode" type="text" inputmode="numeric" autocomplete="off"></label>
        </section>

        <section class="pm-card">
          <div class="pm-trow"><h3>Shipping</h3><span class="pm-tl">Physical product</span><button type="button" class="pm-sw on" role="switch" aria-checked="true" data-sw="physical" aria-label="Physical product"><i></i></button></div>
          <div data-f="shipbox">
            <p class="pm-lb">Package when shipped alone</p>
            <label class="pm-fl sel"><select name="package"><option>Store default · Sample box – 22 × 13.7 × 4.2 cm</option><option>Small mailer</option><option>Large box</option></select>${ic('chevUD', 18, 2)}</label>
            <p class="pm-lb">Packed product size</p>
            <div class="pm-dim"><label class="pm-fl"><span>L</span><input name="len" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0.0"></label>
              <label class="pm-fl sel sm"><select name="dunit"><option>cm</option><option>in</option><option>m</option></select>${ic('chevUD', 16, 2)}</label>
              <label class="pm-fl"><span>W</span><input name="wid" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0.0"></label><i></i>
              <label class="pm-fl"><span>H</span><input name="hei" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0.0"></label><i></i></div>
            <p class="pm-lb">Weight</p>
            <div class="pm-dim"><label class="pm-fl"><input name="wt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.0"></label>
              <label class="pm-fl sel sm"><select name="wunit"><option>kg</option><option>g</option><option>lb</option><option>oz</option></select>${ic('chevUD', 16, 2)}</label></div>
            <div class="pm-sep"></div>
            <div class="pm-chips"><button type="button" class="pm-chip" data-reveal="origin">Country of origin</button><button type="button" class="pm-chip" data-reveal="hs">HS code</button></div>
            <label class="pm-fl rv" data-f="origin" hidden><span>Country of origin</span><input name="origin" type="text" placeholder="Nigeria"></label>
            <label class="pm-fl rv" data-f="hs" hidden><span>HS code</span><input name="hs" type="text" inputmode="numeric"></label>
          </div>
        </section>

        <h2 class="pm-h">Variants</h2>
        <section class="pm-card pm-var">
          <div id="pm-opts"></div>
          <button type="button" class="pm-addopt" id="pm-addopt">${ic('plus', 22, 2)}<span>Add options like size or color</span></button>
        </section>

        <div class="pm-h2row"><h2 class="pm-h">Custom fields</h2></div>
        <section class="pm-card slim"><p class="pm-muted">No custom fields yet</p><div class="pm-sep"></div><button type="button" class="pm-chip" data-soon="Custom fields">${ic('plus', 16, 2.4)} Add field</button></section>

        <div class="pm-h2row"><h2 class="pm-h">Search listing</h2><button type="button" class="pm-icobtn" data-seo aria-label="Edit search listing">${ic('edit', 22)}</button></div>
        <section class="pm-card">
          <p class="pm-muted" data-seoprev>Add a title and description to see how this product might appear in a search engine listing</p>
          <div data-f="seo" hidden>
            <label class="pm-fl"><span>Page title</span><input name="seoTitle" type="text" maxlength="70"></label>
            <label class="pm-fl"><span>Meta description</span><textarea name="seoDesc" rows="3" maxlength="160"></textarea></label>
          </div>
        </section>

        <label class="pm-fl sel stat"><span>Status</span><select name="status"><option value="active">Active</option><option value="draft">Draft</option></select>${ic('chevUD', 18, 2)}</label>

        <h2 class="pm-h">Publishing</h2>
        <section class="pm-card slim"><div class="pm-chan">${ic('layers', 22)}<b>Online store &amp; POS</b></div></section>

        <h2 class="pm-h">Product organisation</h2>
        <section class="pm-card">
          <label class="pm-fl sel"><span>Type</span><input name="type" list="pm-types" placeholder="None" autocomplete="off">${ic('chevUD', 18, 2)}</label>
          <label class="pm-fl sel"><span>Vendor</span><input name="vendor" list="pm-vendors" placeholder="None" autocomplete="off">${ic('chevUD', 18, 2)}</label>
          <datalist id="pm-types"><option>Physical</option><option>Digital</option><option>Service</option></datalist><datalist id="pm-vendors"></datalist>
          <div class="pm-tagbox" data-tags="collections"><span>Collections</span><div class="pm-tl2"></div><button type="button" class="pm-chip" data-addtag>${ic('plus', 16, 2.4)} Choose collections</button></div>
          <div class="pm-tagbox" data-tags="tags"><span>Tags</span><div class="pm-tl2"></div><button type="button" class="pm-chip" data-addtag>${ic('plus', 16, 2.4)} Add tags</button></div>
          <div class="pm-sep"></div>
          <label class="pm-fl sel"><span>Product page layout</span><select name="layout"><option>Default product</option><option>Gallery focus</option><option>Minimal</option></select>${ic('chevUD', 18, 2)}</label>
        </section>
      </form>
      <div class="pm-save"><button type="button" class="pm-del" data-del hidden aria-label="Delete product">${ic('trash', 20, 1.8)}</button><button type="button" class="pm-ghost" data-discard>Discard</button><button type="button" class="pm-pill dark" data-save>Save product</button></div>`;
    document.body.appendChild(page);
    const form = $('.pm-form', page);
    let files = [], editing = null;

    function openPage(p) {
      page.hidden = false; document.body.classList.add('pm-open'); page.scrollTop = 0; void page.offsetWidth; page.classList.add('on');
      try {
        resetForm(); editing = p || null; if (p) fillForm(p);
      $('#pm-ptitle', page).textContent = p ? 'Edit product' : 'Add product';
      $('[data-save]', page).textContent = p ? 'Save changes' : 'Save product';
      const dl = $('[data-del]', page); dl.hidden = !p; dl.classList.remove('arm');
      const inventoryLocked = !!p && (!window.StrapFeatures || window.StrapFeatures.state.plan !== 'premium');
      const trackedSwitch = $('[data-sw="tracked"]', page), quantity = $('input[name="qty"]', page);
      if (trackedSwitch) trackedSwitch.disabled = inventoryLocked;
      if (quantity) quantity.readOnly = inventoryLocked;
      $$('[data-step], [data-toggle="oos"]', page).forEach(x => { x.disabled = inventoryLocked; });
      let lockNote = $('[data-inventory-lock]', page);
      if (!lockNote) {
        const invBox = $('[data-f="invbox"]', page);
        if (invBox) { invBox.insertAdjacentHTML('afterend', '<p class="pm-tl" data-inventory-lock hidden>Inventory changes require Premium. Your current stock is preserved.</p>'); lockNote = $('[data-inventory-lock]', page); }
      }
        if (lockNote) lockNote.hidden = !inventoryLocked;
      } catch (err) {
        console.error('[Strap products] Product panel initialisation failed:', err && err.stack || err);
        toast('The product form could not load one of its optional fields. Please try again.');
      }
    }
    function closePage() { page.classList.remove('on'); document.body.classList.remove('pm-open'); setTimeout(() => { if (!page.classList.contains('on')) page.hidden = true; }, 360); }
    function resetForm() {
      if (form && typeof form.reset === 'function') form.reset();
      const editor = $('.pm-ed', page); if (editor) editor.innerHTML = '';
      files = []; renderThumbs();
      $$('.rv', page).forEach(x => { x.hidden = true; });
      $$('.pm-chip.on', page).forEach(c => c.classList.remove('on'));
      $$('[data-toggle]', page).forEach(c => {
        const badge = $('em', c), init = c.dataset.toggle === 'tax';
        c.dataset.state = init ? '1' : '0';
        if (badge) { badge.textContent = init ? c.dataset.on : c.dataset.off; badge.classList.toggle('on', init); }
      });
      $$('.pm-sw', page).forEach(sw => { sw.classList.add('on'); sw.setAttribute('aria-checked', 'true'); });
      const inventory = $('[data-f=invbox]', page), shipping = $('[data-f=shipbox]', page), seo = $('[data-f=seo]', page);
      if (inventory) inventory.hidden = false;
      if (shipping) shipping.hidden = false;
      if (seo) seo.hidden = true;
      const options = $('#pm-opts', page), addOption = $('#pm-addopt', page);
      if (options) options.innerHTML = '';
      if (addOption) addOption.hidden = false;
      $$('.pm-tl2', page).forEach(x => { x.innerHTML = ''; });
      updSeo();
      if (window.StrapPicker && typeof window.StrapPicker.sync === 'function') {
        window.setTimeout(() => { try { window.StrapPicker.sync(page); } catch (err) { console.warn('[Strap products] Picker refresh failed:', err); } }, 0);
      }
    }
    // rich text
    $$('[data-cmd]', page).forEach(b => { b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', () => { $('.pm-ed', page).focus(); document.execCommand(b.dataset.cmd); }); });
    let edRange = null;
    const keepRange = () => { const s = getSelection(); edRange = s.rangeCount && $('.pm-ed', page).contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; };
    ['mousedown', 'touchstart'].forEach(t => page.addEventListener(t, e => { if (e.target.closest('.pm-tb .dd-t')) keepRange(); }, true));
    $('[data-fmt]', page).addEventListener('change', e => {
      const ed = $('.pm-ed', page); ed.focus();
      if (edRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(edRange); }
      document.execCommand('formatBlock', false, e.target.value);
    });
    // media
    const thumbs = $('.pm-thumbs', page), fileIn = $('[data-file]', page);
    function renderThumbs() {
      thumbs.hidden = !files.length;
      thumbs.innerHTML = files.map((f, i) => `<div class="pm-th">${f.type.startsWith('image') ? `<img src="${f.url}" alt="">` : ic('image', 24)}<button type="button" data-rm="${i}" aria-label="Remove">${ic('x', 14, 2.6)}</button></div>`).join('');
    }
    $('[data-upload]', page).addEventListener('click', () => fileIn.click());
    $('[data-existing]', page).addEventListener('click', () => toast('Your media library is empty'));
    fileIn.addEventListener('change', e => { [...e.target.files].forEach(f => files.push({ name: f.name, type: f.type || '', url: URL.createObjectURL(f), file: f })); renderThumbs(); fileIn.value = ''; });
    thumbs.addEventListener('click', e => { const r = e.target.closest('[data-rm]'); if (r) { files.splice(+r.dataset.rm, 1); renderThumbs(); } });
    // chips, switches, stepper
    page.addEventListener('click', e => {
      const c = e.target.closest('.pm-chip');
      if (c) {
        if (c.dataset.reveal) { const f = $(`[data-f="${c.dataset.reveal}"]`, page); f.hidden = !f.hidden; c.classList.toggle('on', !f.hidden); if (!f.hidden) $('input', f).focus(); }
        else if (c.dataset.toggle) { const e2 = $('em', c), on = c.dataset.state !== '1'; c.dataset.state = on ? '1' : '0'; e2.textContent = on ? c.dataset.on : c.dataset.off; e2.classList.toggle('on', on); }
        else if (c.dataset.soon) toast(`${c.dataset.soon} are coming soon`);
        else if (c.hasAttribute('data-addtag')) { const bx = c.closest('.pm-tagbox'); bx.dataset.tags === 'collections' ? pickCollections() : addTag(bx); }
      }
      const sw = e.target.closest('.pm-sw');
      if (sw) {
        const on = !sw.classList.contains('on'); sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on);
        if (sw.dataset.sw === 'tracked') $('[data-f=invbox]', page).hidden = !on;
        if (sw.dataset.sw === 'physical') $('[data-f=shipbox]', page).hidden = !on;
      }
      const st = e.target.closest('[data-step]');
      if (st) { const i = $('input[name=qty]', page); i.value = Math.max(0, (+i.value || 0) + +st.dataset.step); }
      if (e.target.closest('[data-seo]')) { const f = $('[data-f=seo]', page); f.hidden = !f.hidden; if (!f.hidden) $('input', f).focus(); }
      if (e.target.closest('[data-pback]') || e.target.closest('[data-discard]')) closePage();
      if (e.target.closest('[data-save]')) save();
      const dl = e.target.closest('[data-del]'); if (dl) removeProduct(dl);
      const rmt = e.target.closest('[data-rmtag]'); if (rmt) rmt.parentNode.remove();
    });
    // collections: pick from the ones created on the Collections page (or create one right here)
    const tagChip = v => { const s = document.createElement('span'); s.className = 'pm-tag'; s.innerHTML = `<span>${esc(v)}</span><button type="button" data-rmtag aria-label="Remove ${esc(v)}">${ic('x', 12, 2.8)}</button>`; return s; };
    const collCount = name => items.filter(p => (p.collections || []).includes(name)).length;
    const collOpt = c => { const n = collCount(c.name); return { v: c.name, l: c.name, s: n ? `${n} product${n === 1 ? '' : 's'}` : 'No products yet', ic: 'collections', tone: 'lemon' }; };
    async function pickCollections() {
      const CS = StrapStore.collections, wrap = $('[data-tags=collections] .pm-tl2', page);
      const cur = $$('.pm-tag > span', wrap).map(x => x.textContent);
      const res = await StrapPicker.pick({
        title: 'Add to collections', multi: true, value: cur, options: CS.all().map(collOpt), done: 'Done',
        empty: 'No collections yet. Create your first one below.',
        create: { label: 'Create', placeholder: 'New collection name', make: async name => { const c = CS.add(name); return c ? collOpt(c) : null; } }
      });
      if (!res) return;
      wrap.innerHTML = ''; res.forEach(v => wrap.appendChild(tagChip(v)));
    }
    // tags
    function addTag(box) {
      const wrap = $('.pm-tl2', box); if ($('input', wrap)) return $('input', wrap).focus();
      const inp = document.createElement('input'); inp.className = 'pm-taginp'; inp.placeholder = 'Type and press Enter'; wrap.appendChild(inp); inp.focus();
      const done = () => { const v = inp.value.trim(); inp.remove(); if (v) { const s = document.createElement('span'); s.className = 'pm-tag'; s.innerHTML = `<span>${esc(v)}</span><button type="button" data-rmtag aria-label="Remove ${esc(v)}">${ic('x', 12, 2.8)}</button>`; wrap.appendChild(s); } };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); done(); addTag(box); } });
      inp.addEventListener('blur', done);
    }
    // variants
    $('#pm-addopt', page).addEventListener('click', () => {
      const wrap = $('#pm-opts', page), n = $$('.pm-opt2', wrap).length; if (n >= 3) return;
      const d = document.createElement('div'); d.className = 'pm-opt2';
      d.innerHTML = `<label class="pm-fl"><span>Option name</span><input type="text" data-on placeholder="Size" autocomplete="off"></label><label class="pm-fl"><span>Values (comma separated)</span><input type="text" data-ov placeholder="S, M, L" autocomplete="off"></label>`;
      wrap.appendChild(d); $('input', d).focus(); if (n === 2) $('#pm-addopt', page).hidden = true;
    });
    // SEO preview
    function updSeo() {
      const field = name => form && form.elements ? form.elements.namedItem(name) : null;
      const title = field('seoTitle'), productTitle = field('title'), description = field('seoDesc');
      const t = String(title && title.value || '').trim() || String(productTitle && productTitle.value || '').trim();
      const d = String(description && description.value || '').trim(), preview = $('[data-seoprev]', page);
      if (!preview) return;
      if (!t && !d) { preview.className = 'pm-muted'; preview.textContent = 'Add a title and description to see how this product might appear in a search engine listing'; return; }
      preview.className = 'pm-seoprev';
      preview.innerHTML = `<b>${esc(t || 'Untitled product')}</b><small>${esc(d || 'No description yet.')}</small>`;
    }
    form.addEventListener('input', e => { if (['title', 'seoTitle', 'seoDesc'].includes(e.target.name)) updSeo(); });

    function fillForm(p) {
      const set = (n, v) => { if (form[n] && v != null && v !== '') form[n].value = v; };
      ['title', 'category', 'sku', 'barcode', 'package', 'origin', 'hs', 'status', 'type', 'vendor', 'layout', 'foodType', 'servingSize', 'prepTime', 'ingredients', 'dietary'].forEach(n => set(n, p[n]));
      set('price', p.price); set('compare', p.compareAt); set('cost', p.cost); set('unit', p.unitPrice); set('qty', p.qty);
      set('len', p.size && p.size.l); set('wid', p.size && p.size.w); set('hei', p.size && p.size.h); set('dunit', p.size && p.size.unit);
      set('wt', p.weight && p.weight.v); set('wunit', p.weight && p.weight.unit);
      set('seoTitle', p.seo && p.seo.title); set('seoDesc', p.seo && p.seo.description);
      $('.pm-ed', page).innerHTML = p.description || '';
      const rv = (k, show) => { const f = $(`[data-f="${k}"]`, page), c = $(`.pm-chip[data-reveal="${k}"]`, page); if (f) f.hidden = !show; if (c) c.classList.toggle('on', show); };
      rv('cmp', !!p.compareAt); rv('unit', !!p.unitPrice); rv('cost', !!p.cost); rv('sku', !!p.sku); rv('barcode', !!p.barcode); rv('origin', !!p.origin); rv('hs', !!p.hs);
      const tg = (k, on) => { const c = $(`[data-toggle=${k}]`, page), em = $('em', c); c.dataset.state = on ? '1' : '0'; em.textContent = on ? c.dataset.on : c.dataset.off; em.classList.toggle('on', on); };
      tg('tax', p.chargeTax !== false); tg('oos', !!p.sellWhenOut);
      const sw = (k, on) => { const s = $(`[data-sw=${k}]`, page); s.classList.toggle('on', on); s.setAttribute('aria-checked', on); };
      sw('tracked', !!p.tracked); $('[data-f=invbox]', page).hidden = !$('[data-sw=tracked]', page).classList.contains('on');
      sw('physical', p.physical !== false); $('[data-f=shipbox]', page).hidden = !$('[data-sw=physical]', page).classList.contains('on');
      (p.options || []).forEach(o => { $('#pm-addopt', page).click(); const d = $$('.pm-opt2', page).pop(); $('[data-on]', d).value = o.name; $('[data-ov]', d).value = o.values.join(', '); });
      const tags = (k, arr) => { const w = $(`[data-tags=${k}] .pm-tl2`, page); (arr || []).forEach(v => { const s = document.createElement('span'); s.className = 'pm-tag'; s.innerHTML = `<span>${esc(v)}</span><button type="button" data-rmtag aria-label="Remove ${esc(v)}">${ic('x', 12, 2.8)}</button>`; w.appendChild(s); }); };
      tags('collections', p.collections); tags('tags', p.tags);
      if (p.seo && (p.seo.title || p.seo.description)) $('[data-f=seo]', page).hidden = false;
      files = (p.files || []).map(f => ({ ...f })); renderThumbs(); updSeo();
      if (window.StrapPicker && typeof window.StrapPicker.sync === 'function') {
        try { window.StrapPicker.sync(page); } catch (err) { console.warn('[Strap products] Picker refresh failed:', err); }
      }
    }
    let delTimer;
    async function removeProduct(btn) {
      if (!btn.classList.contains('arm')) { btn.classList.add('arm'); toast('Tap the bin again to delete this product'); clearTimeout(delTimer); delTimer = setTimeout(() => btn.classList.remove('arm'), 3500); return; }
      const id = editing && editing.id; if (!id) return;
      try { await api.deleteProduct(id); items = items.filter(x => x.id !== id); picked.delete(id); renderAll(); closePage(); toast('Product deleted'); } catch (err) { toast('Could not delete. Try again.'); }
    }
    async function save() {
      const title = form.title.value.trim();
      if (!title) { form.title.focus(); form.title.closest('.pm-fl').classList.add('bad'); setTimeout(() => form.title.closest('.pm-fl').classList.remove('bad'), 900); return toast('Add a product title first'); }
      const g = n => form[n] ? form[n].value : '';
      const product = {
        id: editing ? editing.id : undefined,
        title, description: $('.pm-ed', page).innerHTML, category: g('category'), price: +g('price') || 0, compareAt: +g('compare') || null, cost: +g('cost') || null, unitPrice: g('unit'),
        chargeTax: $('[data-toggle=tax]', page).dataset.state !== '0',
        tracked: $('[data-sw=tracked]', page).classList.contains('on'), qty: +g('qty') || 0, sku: g('sku'), barcode: g('barcode'), sellWhenOut: $('[data-toggle=oos]', page).dataset.state === '1',
        physical: $('[data-sw=physical]', page).classList.contains('on'), package: g('package'),
        size: { l: g('len'), w: g('wid'), h: g('hei'), unit: g('dunit') }, weight: { v: g('wt'), unit: g('wunit') }, origin: g('origin'), hs: g('hs'),
        options: $$('.pm-opt2', page).map(o => ({ name: $('[data-on]', o).value.trim(), values: $('[data-ov]', o).value.split(',').map(s => s.trim()).filter(Boolean) })).filter(o => o.name && o.values.length),
        seo: { title: g('seoTitle'), description: g('seoDesc') }, status: g('status'), type: g('type'), vendor: g('vendor'), layout: g('layout'),
        foodType:g('foodType'),servingSize:g('servingSize'),prepTime:g('prepTime'),ingredients:g('ingredients'),dietary:g('dietary'),
        collections: $$('[data-tags=collections] .pm-tag > span', page).map(x => x.textContent), tags: $$('[data-tags=tags] .pm-tag > span', page).map(x => x.textContent)
      };
      const btn = $('[data-save]', page), idle = editing ? 'Save changes' : 'Save product'; btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const saved = await api.saveProduct({ ...product, files: files.map(({ name, type, url }) => ({ name, type, url })), media: files.map(f => f.file).filter(Boolean) });
        const rec = { ...saved, ...product, id: saved.id, image: saved.image || product.image || '', files: files.map(({ name, type, url }) => ({ name, type, url })) };
        await api.persistProducts(editing ? items.map(x => String(x.id) === String(editing.id) ? rec : x) : [rec, ...items]);
        if (editing) { const i = items.findIndex(x => String(x.id) === String(editing.id)); if (i > -1) items[i] = rec; else items.unshift(rec); } else items.unshift(rec);
        renderAll(); closePage(); toast(editing ? 'Changes saved' : 'Product added');
      } catch (err) {
        console.error('[Strap products] Save failed:', err);
        const reason = err && err.message ? String(err.message) : '';
        toast(reason && reason.length < 110 ? reason : 'Could not save product. Check your connection and try again.');
      } finally {
        btn.disabled = false; btn.textContent = idle;
      }
    }

    // ----- boot -----
    renderAll();
    api.getProducts().then(r => { items = r; loading = false; renderAll(); }).catch(() => { items = []; loading = false; renderAll(); });
    return {
      activeBranchId: () => productBranch(),
      items: () => items, openAdd: () => openPage(), openImport, openAI,
      countIn: name => items.filter(p => (p.collections || []).includes(name)).length,
      inCollection: name => items.filter(p => (p.collections || []).includes(name)).map(p => p.id),
      setCollection(name, ids) {
        const want = new Set(ids);
        items.forEach(p => { const has = (p.collections || []).includes(name), on = want.has(p.id); if (on && !has) p.collections = [...(p.collections || []), name]; if (!on && has) p.collections = p.collections.filter(x => x !== name); });
        api.persistProducts(items).catch(e => { console.error(e); toast('Collection changes could not sync. Please retry.'); });
        renderAll();
      },
      dropCollection(name) { items.forEach(p => { if ((p.collections || []).includes(name)) p.collections = p.collections.filter(x => x !== name); }); api.persistProducts(items).catch(e => { console.error(e); toast('Collection changes could not sync. Please retry.'); }); renderAll(); },
      setQty(id, qty) { const p = items.find(x => x.id === id); if (p) { p.qty = Math.max(0, qty); api.persistProducts(items).catch(e => { console.error(e); toast('Stock change could not sync. Please retry.'); }); renderBody(); } return p; },
      onChange(fn) { subs.push(fn); }
    };
  }
  return { mount, api };
})();
