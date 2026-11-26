(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const toast = msg => {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove('on'), 2600);
  };

  // Details saved by the sign-up flow (index.html). Falls back to sample details so this page can also be opened on its own.
  let D = {};
  try { D = JSON.parse(sessionStorage.getItem('strap.session') || '{}'); } catch (e) {}
  if (!D.bizname) D = { ...D, name: D.name || 'Amaka Obi', bizname: 'Amaka Fashion House', currency: D.currency || 'NGN' };
  const first = () => (D.name || '').split(/\s+/)[0];
  // Staff access is temporarily disabled while the feature is being rebuilt.
  const STAFF = null;
  try { sessionStorage.removeItem('staff.session'); } catch (e) {}

  const api = {};
  /* ===== DASHBOARD ===== */
  // Backend hook: replace with the real "today" summary for this store. Demo numbers for now.
  Object.assign(api, {
    async getDashboard() { await sleep(500); return StrapFeatures.stats(); }
  });

  const dash = $('#dash'), loader = $('#loader'), loaderMsg = $('#loader-msg');
  const LOAD_MSGS = ['Setting up your store', 'Stocking the shelves', 'Counting today’s sales', 'Almost there'];
  const LOAD_MIN = 3000;
  const svg = (k, s = 24, w = 1.8) => StrapUI.ic(k, s, w);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const initials = n => (n.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || 'S').toUpperCase();
  // Full currency values everywhere: never abbreviate prices or revenue as K/M.
  // Stored values and calculations remain unchanged.
  const money = n => {
    const value = Number(n);
    const amount = Number.isFinite(value) ? value : 0;
    try {
      return new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: D.currency || 'NGN',
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
        currencyDisplay: 'narrowSymbol'
      }).format(amount);
    } catch (e) {
      return '₦' + amount.toLocaleString('en-NG', { maximumFractionDigits: 2 });
    }
  };
  const num = n => Math.round(n).toLocaleString('en');

  // smooth sparkline path from a list of values
  function spark(vals, W = 300, H = 72, pad = 8) {
    const max = Math.max(...vals), min = Math.min(...vals), dx = (W - 16) / (vals.length - 1);
    const pts = vals.map((v, i) => [i * dx, H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2)]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2; d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`; }
    return { line: d, area: `${d} L${W - 16},${H} L0,${H} Z`, end: pts[pts.length - 1] };
  }

  // the loader is already on screen when this page opens; cycle its messages while data loads
  function startMsgs() {
    let k = 0; loaderMsg.textContent = LOAD_MSGS[0];
    return setInterval(() => {
      k = Math.min(k + 1, LOAD_MSGS.length - 1); loaderMsg.textContent = LOAD_MSGS[k];
      loaderMsg.style.animation = 'none'; void loaderMsg.offsetWidth; loaderMsg.style.animation = '';
    }, LOAD_MIN / LOAD_MSGS.length);
  }
  async function boot() {
    loader.hidden = false; loader.classList.add('on');
    const msgs = startMsgs(), t0 = Date.now();
    let data;
    try {
      data = await api.getDashboard(D);
    } catch (e) {
      console.error('[Strap dashboard] Data startup failed:', e);
      data = null;
    }
    await sleep(Math.max(0, LOAD_MIN - (Date.now() - t0)));
    clearInterval(msgs);
    if (!data || typeof data !== 'object') {
      showBootError('We couldn’t load your workspace. Check your connection and try again.');
      return;
    }
    // Staff accounts may receive a deliberately limited data set. Keep dashboard
    // rendering resilient when a role does not have every owner-only statistic.
    data = {
      revenue: 0, deltaPct: null, hourly: Array(12).fill(0), sold: 0,
      orders: 0, customers: 0, stock: 0, products: 0, low: 0, ...data
    };
    if (!Array.isArray(data.hourly) || !data.hourly.length) data.hourly = Array(12).fill(0);
    try {
      buildDash(data);
      dash.hidden = false; document.body.classList.add('is-dash');
      const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = '#0a0a0a';
      window.scrollTo(0, 0);
      await sleep(80);
      dash.classList.add('go'); loader.classList.add('out'); runCounts();
      await sleep(reduced() ? 0 : 850);
      loader.hidden = true; loader.className = 'loader'; document.body.classList.remove('lock');
    } catch (e) {
      console.error('[Strap dashboard] Workspace render failed:', e);
      dash.replaceChildren();
      showBootError('Your sign-in worked, but your workspace could not finish opening. Tap to retry.');
    }
  }
  function showBootError(message) {
    loaderMsg.textContent = message;
    const bar = $('.ld-bar', loader);
    if (bar) bar.hidden = true;
    let retry = $('#loader-retry');
    if (!retry) {
      retry = document.createElement('button');
      retry.id = 'loader-retry'; retry.type = 'button'; retry.className = 'ld-retry';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => {
        retry.remove();
        const bar = $('.ld-bar', loader); if (bar) bar.hidden = false;
        boot();
      });
      loader.querySelector('.ld-in').appendChild(retry);
    }
    retry.hidden = false;
  }

  const TAB_ICONS = ['home', 'inbox', 'tag', 'menu'], TAB_NAMES = ['Home', 'Orders', 'Products', 'Menu'];
  const U = StrapUI, uic = U.ic;
  // sidebar structure: [id, label, icon, extra]
  const BASE_MENU = [
    ['home', 'Home', 'home'], ['orders', 'Orders', 'inbox'],
    ['products', 'Products', 'tag', [['products', 'All products'], ['collections', 'Collections'], ['inventory', 'Inventory'], ['purchase', 'Purchase orders'], ['transfers', 'Transfers'], ['gift', 'Gift cards']]],
    ['customers', 'Customers', 'users'], ['staff', 'Staff', 'users', 'soon'], ['growth', 'Growth', 'growth'], ['activity', 'Activity log', 'clock', 'soon'], ['devices', 'Devices & printers', 'phone', 'soon'],
    ['@', 'Sales channels'], ['online', 'Online store', 'store'], ['mcp', 'MCP', 'plug'],
    ['@', ''], ['billing', 'Billing', 'wallet', [['billing-overview', 'Overview'], ['billing-history', 'Payment history'], ['billing-receipts', 'Payments received & receipts'], ['billing-results', 'Payment results'], ['billing-renew', 'Renew Premium'], ['billing-subscription', 'Subscription management'], ['billing-notifications', 'Billing notifications'], ['billing-reconciliation', 'Payment reconciliation']]], ['premium', 'Premium', 'flash'], ['settings', 'Settings', 'gear']
  ];
  const STAFF_MENU = {
    'new-sale':['new-sale','Sales desk','receipt'],
    'sales-today':['sales-today','Today’s sales','receipt'],
    'sales-history':['sales-history','Sales history','clock'],
    products:['products','Products','tag'],
    inventory:['inventory','Inventory','box'],
    transfers:['transfers','Transfers','transfer'],
    orders:['orders','Orders','inbox'],
    customers:['customers','Customers','users']
  };
  const MENU = !STAFF ? BASE_MENU
    : STAFF.role === 'Stock keeper'
      ? [['products','Products','tag',[['products','All products'],['inventory','Inventory'],['transfers','Transfers']]]]
      : (STAFF.allowedRoutes || []).map(id => STAFF_MENU[id]).filter(Boolean);
  const TAB_OF = { home: 0, products: 2, collections: 2, inventory: 2, purchase: 2, transfers: 2, gift: 2 };

  function buildDash(d) {
    const store = D.bizname || 'My Store', who = first() || 'there';
    const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const sp = spark(d.hourly);
    const photo = D.photoUrl || '';
    const av = photo ? `<img src="${esc(photo)}" alt="">` : esc(initials(store));
    const card = (i, ic, label, key, val, sub, cls = '') => `
      <article class="sc in ${cls}" style="--i:${i}" tabindex="0">
        <div class="ic">${svg(ic, 26)}</div>
        <div class="tx"><span class="lb">${label}</span><b class="vl" data-count="${val}" data-kind="${key}">0</b><span class="sb">${sub}</span></div>
      </article>`;
    const salesOpen = (()=>{try{return JSON.parse(localStorage.getItem('strap.v1')||'{}').staffSalesOpen===true;}catch(e){return false;}})();
    const menuHtml = MENU.map(m => {
      if (m[0] === '@') return m[1] ? `<p class="ds-h">${m[1]}</p>` : '<div class="ds-sep"></div>';
      const [id, lbl, ico, ex] = m;
      if (Array.isArray(ex)) return `<div class="ds-grp"><button type="button" class="ds-i" data-grp="${id}" aria-expanded="false"><span class="ds-ic">${uic(ico, 24, 1.8)}</span><span>${lbl}</span><span class="ds-chev">${uic('chevD', 18, 2)}</span></button><div class="ds-sub"><div>${ex.map(([sid, sl]) => `<button type="button" class="ds-s" data-go="${sid}">${sl}</button>`).join('')}</div></div></div>`;
      return `<button type="button" class="ds-i" data-go="${id}"><span class="ds-ic">${uic(ico, 24, 1.8)}</span><span>${lbl}</span>${ex === 'soon' ? '<em class="ds-b">Coming soon</em>' : ''}</button>`;
    }).join('');
    const staffToolbar = STAFF && STAFF.role === 'Stock keeper' ? `<header class="staff-bar"><div><b>${esc(store)}</b><small>${esc(STAFF.role)} access</small></div><button type="button" id="staff-menu">Menu ${uic('menu',20,2)}</button></header>` : '';
    dash.innerHTML = `
      <div class="dtop"></div>
      <section class="dsheet">${staffToolbar}
        <div class="pane" data-id="home">
          <header class="dh in" style="--i:0">
            <div class="who"><div class="av">${av}</div><span class="sn">${esc(store)}</span></div>
            <button class="bell" type="button" aria-label="Notifications">${svg('bell', 24, 2)}<i></i></button>
          </header>
          <h1 class="hi"><span class="ln"><span>Welcome back</span></span><span class="ln"><span class="nm">${esc(who)}</span></span></h1>
          <h2 class="sec in" style="--i:3">Today’s overview<small>${date}</small></h2>

          <article class="rev in" style="--i:4" tabindex="0">
            <div class="glow"></div>
            <div class="rtop"><div class="ic">${svg('wallet', 26)}</div><span class="lb">Total revenue today</span></div>
            <b class="amt" data-count="${d.revenue}" data-kind="money">${money(0)}</b>
            <span class="delta">${d.deltaPct == null ? 'No sales yet today' : svg('up', 14, 2.6) + d.deltaPct + '% vs yesterday'}</span>
            <svg class="spark" viewBox="0 0 300 72" aria-hidden="true">
              <defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e6f53a" stop-opacity=".32"/><stop offset="1" stop-color="#e6f53a" stop-opacity="0"/></linearGradient></defs>
              <path class="sa" d="${sp.area}" fill="url(#sg)"/>
              <path class="sl" d="${sp.line}" pathLength="1" fill="none" stroke="#e6f53a" stroke-width="2.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
              <circle class="sd" cx="${sp.end[0]}" cy="${sp.end[1]}" r="4.5" fill="#e6f53a"/>
            </svg>
          </article>

          <article class="sl-card in" style="--i:5">
            <div class="sl-top"><span class="sl-ic">${uic('receipt', 26, 1.8)}</span><div><b>Sales desk</b><small>${num(d.orders)} orders · ${money(d.revenue)} so far today</small></div></div>
            <button type="button" class="sl-btn" data-go="sales-today"><span>Open today’s sales</span><i>${uic('arrow', 20, 2.2)}</i></button>
            <button type="button" class="sl-link" data-go="sales-history">${uic('clock', 20, 1.9)}<span>Sales history</span>${uic('chevR', 18, 2)}</button>
          </article>

          ${card(6, 'bag', 'Products sold today', 'int', d.sold, `${num(d.orders)} orders`)}
          ${card(7, 'users', 'New customers', 'int', d.customers, 'Joined today')}
          ${card(8, 'box', 'Total stock', 'int', d.stock, `Across ${num(d.products)} products`)}
          ${card(9, 'alert', 'Low stock', 'int', d.low, d.low ? 'Running out soon' : 'All well stocked', d.low ? 'warn' : '')}
        </div>
      </section>

      <nav class="dnav" aria-label="Main">
        <div class="tabs">
          <span class="bub"><i></i></span>
          ${TAB_ICONS.map((k, i) => `<button type="button" class="tab t${i}${i ? '' : ' on'}" data-i="${i}" aria-label="${TAB_NAMES[i]}" ${i ? '' : 'aria-current="page"'}>${uic(k, 26, 1.8)}</button>`).join('')}
        </div>
      </nav>

      <div class="dr" id="dr" aria-hidden="true">
        <div class="dr-scrim"></div>
        <aside class="dr-panel" role="dialog" aria-label="Menu">
          <div class="dr-top"><div class="who"><div class="av">${av}</div><span class="sn">${esc(store)}</span></div><button type="button" class="pm-x" id="dr-x" aria-label="Close menu">${uic('close', 20, 2.2)}</button></div>
          <button type="button" class="ds-open" data-go="new-sale"><span>Open sale</span><i>${uic('arrow', 22, 2.4)}</i></button>
          <label class="ds-search" for="ds-page-search">
            <span class="ds-search-icon">${uic('search', 19, 1.9)}</span>
            <input id="ds-page-search" type="search" placeholder="Find a page" autocomplete="off" spellcheck="false" aria-label="Find a page in the menu">
            <kbd aria-hidden="true">/</kbd>
          </label>
          <p class="ds-search-empty" role="status" aria-live="polite" hidden>No pages found. Try another search.</p>
          <nav class="ds-nav" aria-label="Workspace pages">${menuHtml}</nav>
          ${STAFF ? `<div class="staff-drawer-foot"><button type="button" data-staff-messages>Messages <em>Coming soon</em></button><button type="button" data-staff-logout>${uic('out',20,2)}<span>Log out</span></button></div>` : ''}
        </aside>
      </div>`;

    const sheet = $('.dsheet', dash), tabsEl = $('.tabs', dash), tabs = $$('.tab', dash), bub = $('.bub', dash), drawer = $('#dr', dash);
    const panes = { home: $('.pane[data-id=home]', dash) }, mods = {};
    const showPageFailure = pane => {
      pane.innerHTML = '<section class="pg-empty"><h2>This page could not load</h2><p>Something went wrong while opening this section. Your saved data has not been changed.</p><button type="button" class="pm-add" data-page-retry>Refresh page</button></section>';
      const retry = $('[data-page-retry]', pane);
      if (retry) retry.addEventListener('click', () => location.reload());
    };
    let current = 'home';
    const ctx = {
      toast, esc, money, cur: D.currency || 'NGN', data: d, store: D, staff: STAFF, go: id => show(id), products: () => mods.products, openMenu: () => openDrawer(),
      rename: v => { D.bizname = v; try { sessionStorage.setItem('strap.session', JSON.stringify(D)); } catch (e) {} $('.sn', dash).forEach(n => n.textContent = v); $('.av', dash).forEach(a => { if (!a.querySelector('img')) a.textContent = initials(v); }); },
      signOut: async () => { try { await StrapAPI.signOut(); } finally { location.replace('/'); } }
    };
    StrapFeatures.init(ctx);
    setTimeout(() => { StrapFeatures.showPendingPremiumWelcome().catch(e => console.warn('[Strap Premium] Welcome check failed:',e)); }, 400);
    function ensure(id) {
      if (panes[id]) return panes[id];
      const p = document.createElement('div'); p.className = 'pane'; p.dataset.id = id; p.hidden = true; sheet.appendChild(p); panes[id] = p;
      if (id === 'products') {
        try {
          mods.products = StrapProducts.mount(p, ctx);
        } catch (err) {
          console.error('[Strap dashboard] Products module failed to initialize:', err);
          p.innerHTML = '<section class="empty"><h2>Products could not load</h2><p>Please refresh and try again.</p></section>';
          mods.products = null;
        }
      } else {
        try {
          mods[id] = StrapPages.build(id, p, ctx);
        } catch (err) {
          console.error('[Strap dashboard] Page module failed to initialize (' + id + '):', err);
          mods[id] = null;
          showPageFailure(p);
        }
      }
      return p;
    }
    // inventory needs the products module to exist first
    async function show(id, options = {}) {
      if (id === 'staff') { toast('Staff is coming soon.'); closeDrawer(); return; }
      if (STAFF && !(STAFF.allowedRoutes || []).includes(id)) { toast('This section is not included in your staff access.'); return; }
      let planAccess = { verified: false, plan: StrapFeatures.state.plan };
      try {
        if (typeof StrapFeatures.waitForPlan === 'function') planAccess = await StrapFeatures.waitForPlan();
      } catch (err) {
        console.warn('[Strap dashboard] Could not verify Premium status before navigation:', err);
      }
      if (planAccess.verified && planAccess.plan !== 'premium' && !['home','products','settings','premium', 'billing-overview','billing-history','billing-receipts','billing-results','billing-renew','billing-subscription','billing-notifications','billing-reconciliation'].includes(id)) {
        closeDrawer();
        toast('This feature requires Strap Premium.');
        try { StrapFeatures.open('premium'); } catch (err) { console.error('[Strap dashboard] Premium screen failed to open:', err); }
        return;
      }
      if (id === 'ai') { ensure('products'); closeDrawer(); return mods.products.openAI(); }
      if (StrapFeatures.has(id)) { closeDrawer(); return StrapFeatures.open(id); }
      if (id === 'inventory' || id === 'new-sale' || id === 'collections') ensure('products');
      const p = ensure(id);
      if (options.history !== false && current !== id) {
        const url = location.pathname + location.search + '#' + encodeURIComponent(id);
        history.pushState({ strapPage: id }, '', url);
      }
      current = id;
      Object.entries(panes).forEach(([k, el]) => { el.hidden = k !== id; });
      if (!p.dataset.seen) p.dataset.seen = 1;
      else if (mods[id] && mods[id].onShow) {
        try { mods[id].onShow(); }
        catch (err) { console.error('[Strap dashboard] Page refresh failed (' + id + '):', err); showPageFailure(p); }
      }
      const t = TAB_OF[id];
      tabs.forEach((x, i) => { x.classList.toggle('on', i === t); i === t ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current'); });
      tabsEl.classList.toggle('none', t === undefined);
      if (t !== undefined) bub.style.transform = `translateX(${t * 100}%)`;
      dash.classList.toggle('focus', id === 'new-sale');
      $$('.ds-i[data-go], .ds-s', drawer).forEach(b => b.classList.toggle('on', b.dataset.go === id));
      const g = $('.ds-grp', drawer); if (g) g.classList.toggle('has', ['products', 'collections', 'inventory', 'purchase', 'transfers', 'gift'].includes(id));
      closeDrawer();
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    const staffMenu=$('#staff-menu',dash); if(staffMenu) staffMenu.addEventListener('click',openDrawer);
    const staffLogout=$('[data-staff-logout]',drawer); if(staffLogout) staffLogout.addEventListener('click',async()=>{await StrapAPI.signOut();location.replace('index.html');});
    const staffMessages=$('[data-staff-messages]',drawer); if(staffMessages) staffMessages.addEventListener('click',()=>toast('Staff messages are coming soon.'));

    if(STAFF) { const nav=$('.dnav',dash); if(nav) nav.hidden=true; }
    const pageSearch = $('#ds-page-search', drawer);
    const searchEmpty = $('.ds-search-empty', drawer);
    const groupOpenBeforeSearch = new Map($('.ds-grp', drawer).map(group => [group, group.classList.contains('open')]));
    function filterMenu(query) {
      const q = String(query || '').trim().toLocaleLowerCase();
      let visible = 0;
      Array.from($('.ds-nav', drawer).children).forEach(item => {
        if (item.classList.contains('ds-grp')) {
          const heading = $('.ds-i', item);
          const children = $('.ds-s', item);
          const headingMatch = !q || heading.textContent.toLocaleLowerCase().includes(q);
          let childMatches = 0;
          children.forEach(child => {
            const match = !q || headingMatch || child.textContent.toLocaleLowerCase().includes(q);
            child.hidden = !match;
            if (match) childMatches++;
          });
          item.hidden = !!q && !headingMatch && childMatches === 0;
          if (q && childMatches > 0) {
            item.classList.add('open');
            heading.setAttribute('aria-expanded', 'true');
          } else if (!q) {
            const wasOpen = groupOpenBeforeSearch.get(item) === true;
            item.classList.toggle('open', wasOpen);
            heading.setAttribute('aria-expanded', wasOpen ? 'true' : 'false');
          }
        } else if (item.matches('[data-go]')) {
          item.hidden = !!q && !item.textContent.toLocaleLowerCase().includes(q);
        } else {
          item.hidden = !!q;
        }
        if (!item.hidden) visible++;
      });
      if (searchEmpty) searchEmpty.hidden = !q || visible > 0;
    }
    function openDrawer(focusSearch = false) {
      drawer.classList.add('on');
      drawer.setAttribute('aria-hidden', 'false');
      document.body.classList.add('pm-open');
      if (focusSearch && pageSearch) requestAnimationFrame(() => pageSearch.focus());
    }
    function closeDrawer() {
      if (!drawer.classList.contains('on')) return;
      drawer.classList.remove('on');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('pm-open');
      if (pageSearch && pageSearch.value) {
        pageSearch.value = '';
        filterMenu('');
      }
    }
    if (pageSearch) pageSearch.addEventListener('input', () => filterMenu(pageSearch.value));

    tabs.forEach(t => t.addEventListener('click', () => {
      const i = +t.dataset.i;
      t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
      if (i === 3) return openDrawer();
      show(['home', 'orders', 'products'][i]);
    }));
    dash.addEventListener('click', e => {
      const g = e.target.closest('[data-go]'); if (g) return show(g.dataset.go);
      const grp = e.target.closest('[data-grp]');
      if (grp) { const open = grp.getAttribute('aria-expanded') !== 'true'; grp.setAttribute('aria-expanded', open); grp.parentNode.classList.toggle('open', open); }
    });
    $('.dr-scrim', drawer).addEventListener('click', closeDrawer); $('#dr-x', drawer).addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (drawer.classList.contains('on') && pageSearch && pageSearch.value) {
          pageSearch.value = '';
          filterMenu('');
          pageSearch.focus();
          return;
        }
        closeDrawer();
        return;
      }
      const target = e.target;
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const shortcut = (e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k');
      if (shortcut) {
        e.preventDefault();
        openDrawer(true);
      }
    });
    // swipe the menu back to the left to close it
    let sx = null; const panel = $('.dr-panel', drawer);
    panel.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    panel.addEventListener('touchend', e => { if (sx !== null && e.changedTouches[0].clientX - sx < -70) closeDrawer(); sx = null; });
    // the products group starts expanded
    const pg = $('[data-grp=products]', drawer); pg.setAttribute('aria-expanded', 'true'); pg.parentNode.classList.add('open'); groupOpenBeforeSearch.set(pg.parentNode, true);

    // Optional dashboard modules must never prevent the signed-in workspace from opening.
    try { ensure('products'); } catch (err) {
      console.error('[Strap dashboard] Products startup failed:', err);
    }
    try { StrapFeatures.bind(mods.products); } catch (err) {
      console.error('[Strap dashboard] Product feature binding failed:', err);
    }
    try { StrapFeatures.mountHome(ctx, panes.home); } catch (err) {
      console.error('[Strap dashboard] Home widgets failed to initialize:', err);
    }
    const routeIds = new Set(['home','orders','products','customers','purchase','transfers','gift','sales-today','sales-history','new-sale','inventory','collections','growth','online','mcp','settings']);
    const initialRoute = decodeURIComponent(location.hash.slice(1));
    const firstRoute = routeIds.has(initialRoute) ? initialRoute : 'home';
    history.replaceState({ strapPage: firstRoute }, '', location.pathname + location.search + '#' + encodeURIComponent(firstRoute));
    if (firstRoute !== 'home') show(firstRoute, { history: false });
    addEventListener('popstate', () => {
      const id = decodeURIComponent(location.hash.slice(1));
      show(routeIds.has(id) ? id : 'home', { history: false });
    });
    const bell = $('.bell', dash);
    bell.addEventListener('click', () => { bell.classList.remove('ring'); void bell.offsetWidth; bell.classList.add('ring'); StrapFeatures.open('notifications'); });
    if(STAFF && STAFF.defaultRoute) show(STAFF.defaultRoute);
  }

  // numbers climb to their value as each card arrives
  function runCounts() {
    $$('[data-count]', dash).forEach(n => {
      const to = +n.dataset.count, fmt = n.dataset.kind === 'money' ? money : num;
      const card = n.closest('.in'), delay = card ? (+card.style.getPropertyValue('--i') || 0) * 70 + 350 : 400;
      if (reduced()) { n.textContent = fmt(to); return; }
      const dur = n.dataset.kind === 'money' ? 1600 : 1100;
      setTimeout(() => {
        const t0 = performance.now();
        const step = t => { const p = Math.min(1, (t - t0) / dur); n.textContent = fmt(to * (1 - Math.pow(1 - p, 4))); if (p < 1) requestAnimationFrame(step); else n.textContent = fmt(to); };
        requestAnimationFrame(step);
      }, delay);
    });
  }

  boot();
})();
