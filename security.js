/* Strap – activity PIN: the loader "cover" animation, the 4-digit PIN pad, and the onboarding-style set-up flow
   (PIN -> confirm PIN -> emailed code -> done). Used by the sales page (closing sales) and Settings. */
window.StrapSec = (() => {
  const { $, $$, el, sleep, reduced, fx } = StrapKit;
  const U = StrapUI, ic = U.ic, esc = U.esc;
  const S = StrapStore;

  /* ---------- the lemon loader, replayed on demand ----------
     Fades in, runs the logo animation, calls `mid` while the screen is fully covered (swap what's underneath),
     then rolls up to reveal it – exactly like the loader before the dashboard appears. */
  async function cover(msg, ms, mid) {
    const L = $('#loader');
    if (!L) { if (mid) await mid(); return; }
    const inner = $('.ld-in', L), fresh = inner.cloneNode(true); inner.replaceWith(fresh);
    $('#loader-msg', L).textContent = msg;
    $('.ld-bar i', L).style.animationDuration = ms + 'ms';
    L.className = 'loader xl'; L.hidden = false; void L.offsetWidth; L.classList.add('on');
    await sleep(ms); if (mid) await mid();
    L.classList.add('out'); await sleep(reduced() ? 0 : 850);
    L.hidden = true; L.className = 'loader';
  }

  const maskEmail = e => { const m = /^([^@]{1,2})[^@]*(@.+)$/.exec(e || ''); return m ? m[1] + '•••' + m[2] : 'your email'; };

  /* ---------- PIN pad: black sheet, lemon dots, custom keypad ---------- */
  function pinPad({ title = 'Enter your PIN', sub = 'Enter your 4-digit activity PIN to confirm.', forgot = true } = {}) {
    return new Promise(res => {
      const w = el('div', 'sp-layer');
      w.innerHTML = `<div class="sp-scrim"></div><section class="sp-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sp-grab"></div>
        <button type="button" class="sp-x" data-x aria-label="Cancel">${ic('close', 20, 2.2)}</button>
        <span class="sp-ic">${ic('lock', 26, 1.9)}</span>
        <h2>${esc(title)}</h2><p class="sp-sub">${esc(sub)}</p>
        <div class="sp-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <p class="sp-err" role="alert"></p>
        <div class="sp-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}
          <button type="button" class="ghost" data-forgot ${forgot ? '' : 'disabled'}>${forgot ? 'Forgot?' : ''}</button><button type="button" data-k="0">0</button><button type="button" class="ghost" data-bk aria-label="Delete">${ic('back', 22, 2.2)}</button></div>
      </section>`;
      document.body.appendChild(w); StrapKit.lock(true); void w.offsetWidth; w.classList.add('on');
      const dots = $$('.sp-dots i', w), err = $('.sp-err', w), keys = $$('.sp-keys button', w);
      let val = '', busy = false, tmr = null, out = null;
      const paint = () => dots.forEach((d, i) => d.classList.toggle('f', i < val.length));
      const close = v => { clearInterval(tmr); w.classList.remove('on'); StrapKit.lock(false); setTimeout(() => w.remove(), reduced() ? 0 : 360); res(v); };
      const locked = () => {
        const left = S.lockLeft(); if (!left) { err.textContent = ''; keys.forEach(k => k.disabled = k.hasAttribute('data-forgot') && !forgot); clearInterval(tmr); return false; }
        err.textContent = `Too many tries. Try again in ${left}s.`; keys.forEach(k => k.disabled = true); return true;
      };
      const startLock = () => { if (locked()) { clearInterval(tmr); tmr = setInterval(locked, 500); } };
      async function push(d) {
        if (busy || val.length >= 4 || S.lockLeft()) return;
        val += d; paint(); fx('tap');
        if (val.length < 4) return;
        busy = true; const ok = await S.checkPin(val);
        if (ok) { S.pinOk(); fx('ok'); dots.forEach(x => x.classList.add('ok')); await sleep(260); close('ok'); return; }
        S.pinFail(); fx('err'); w.classList.add('bad'); dots.forEach(x => x.classList.add('x')); err.textContent = 'That PIN isn’t right. Try again.';
        await sleep(520); w.classList.remove('bad'); dots.forEach(x => x.classList.remove('x')); val = ''; paint(); busy = false; startLock();
      }
      w.addEventListener('click', e => {
        const k = e.target.closest('[data-k]'); if (k) return push(k.dataset.k);
        if (e.target.closest('[data-bk]')) { if (!busy) { val = val.slice(0, -1); paint(); fx('tap'); } return; }
        if (e.target.closest('[data-forgot]')) return close('forgot');
        if (e.target.closest('[data-x]') || e.target.closest('.sp-scrim')) close(null);
      });
      w.addEventListener('keydown', e => {
        if (/^\d$/.test(e.key)) push(e.key); else if (e.key === 'Backspace') { val = val.slice(0, -1); paint(); } else if (e.key === 'Escape') close(null);
      });
      w.tabIndex = -1; w.focus(); startLock();
      out = null;
    }).then(v => v === 'ok' ? true : v === 'forgot' ? 'forgot' : false);
  }

  /* ---------- set-up flow: looks and behaves like the onboarding form ---------- */
  // mode: 'set' | 'change' | 'reset'. Resolves true once the new PIN is saved and the loader has rolled back.
  function setupFlow({ email = '', mode = 'set' } = {}) {
    const WEAK = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '3210', '1212', '2580'];
    const copy = {
      set: ['Create your activity PIN', 'Choose 4 digits you’ll remember. You’ll enter them to confirm big actions like closing sales.'],
      change: ['Choose a new PIN', 'Pick 4 new digits. We’ll email you a code to make sure it’s you.'],
      reset: ['Reset your PIN', 'Pick 4 new digits. We’ll email you a code to make sure it’s you.']
    }[mode] || [];
    return new Promise(async resolve => {
      const layer = el('div', 'sf'); let pin = '', timer = null;
      const stop = () => clearInterval(timer);
      const rise = box => $$('.sf-t,.sf-s,.sf-fg,.sf-code,.sf-tl,.sf-foot > *', box).forEach((n, k) => { n.classList.add('rise'); n.style.setProperty('--i', Math.min(k, 8)); });
      const swap = box => { layer.replaceChildren(box); rise(box); const i = $('input', box); if (i) setTimeout(() => i.focus(), 120); };
      const leave = v => { stop(); layer.classList.add('leave'); setTimeout(() => layer.remove(), reduced() ? 0 : 320); resolve(v); };
      const back = (fn) => `<div class="sf-top"><button type="button" class="sf-back" aria-label="Back">${ic('back', 24, 2.2)}</button></div>`;

      // ----- step 1: PIN + confirm PIN -----
      function stepPin() {
        const f = el('form', 'sf-step'); f.noValidate = true;
        f.innerHTML = `${back()}<h2 class="sf-t">${copy[0]}</h2><p class="sf-s">${copy[1]}</p>
          <div class="sf-fields">
            <div class="sf-fg"><input class="sf-fi" id="sf-a" type="password" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="4-digit PIN" aria-label="4-digit PIN"><button type="button" class="sf-eye">Show</button><p class="sf-err" role="alert"></p></div>
            <div class="sf-fg"><input class="sf-fi" id="sf-b" type="password" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="Confirm PIN" aria-label="Confirm PIN"><p class="sf-err" role="alert"></p></div>
          </div><div class="sf-sp"></div>
          <div class="sf-foot"><button type="submit" class="sf-pill" disabled>Continue</button><p class="sf-note">We’ll email a 6-digit code to <b>${esc(maskEmail(email))}</b> to confirm it’s you.</p></div>`;
        const [a, b] = $$('.sf-fi', f), [ea, eb] = $$('.sf-err', f), btn = $('.sf-pill', f), eye = $('.sf-eye', f);
        $('.sf-back', f).onclick = () => leave(false);
        eye.onclick = () => { const h = a.type === 'password'; a.type = b.type = h ? 'text' : 'password'; eye.textContent = h ? 'Hide' : 'Show'; };
        const clean = i => { i.value = i.value.replace(/\D/g, '').slice(0, 4); };
        const check = () => {
          ea.textContent = eb.textContent = '';
          const okA = /^\d{4}$/.test(a.value), okB = b.value === a.value && okA;
          btn.disabled = !okB; return { okA, okB };
        };
        a.addEventListener('input', () => { clean(a); check(); if (a.value.length === 4) b.focus(); });
        b.addEventListener('input', () => { clean(b); check(); });
        a.addEventListener('blur', () => { if (a.value && a.value.length < 4) ea.textContent = 'Use exactly 4 digits.'; });
        b.addEventListener('blur', () => { if (b.value.length === 4 && b.value !== a.value) eb.textContent = 'The PINs don’t match.'; });
        f.addEventListener('submit', async e => {
          e.preventDefault(); const { okA, okB } = check();
          if (!okA) { ea.textContent = 'Use exactly 4 digits.'; return; }
          if (WEAK.includes(a.value)) { ea.textContent = 'That PIN is too easy to guess. Try something less obvious.'; return; }
          if (!okB) { eb.textContent = 'The PINs don’t match.'; return; }
          pin = a.value; btn.disabled = true; btn.textContent = 'Sending code…';
          const r = await S.api.sendCode(email);
          if (!r.ok) { btn.disabled = false; btn.textContent = 'Continue'; eb.textContent = r.msg || 'We couldn’t send a code. Try again.'; return; }
          stepCode();
        });
        swap(f);
      }

      // ----- step 2: 6-digit email code -----
      function stepCode() {
        const f = el('form', 'sf-step'); f.noValidate = true;
        f.innerHTML = `${back()}<h2 class="sf-t">Check your email</h2><p class="sf-s">We sent a 6-digit code to <b>${esc(maskEmail(email))}</b>. Enter it below to save your PIN.</p>
          <div class="sf-fg"><div class="sf-code">${[1, 2, 3, 4, 5, 6].map(n => `<input inputmode="numeric" maxlength="1" ${n === 1 ? 'autocomplete="one-time-code"' : ''} aria-label="Digit ${n}">`).join('')}</div><p class="sf-err" role="alert"></p></div>
          <div class="sf-tl"><span class="sf-tn"></span><button type="button" class="sf-rs" disabled>Resend code</button></div>
          ${S.api.DEMO ? `<p class="sf-demo">Demo mode: use code <b>${S.api.DEMO_CODE}</b></p>` : ''}
          <div class="sf-sp"></div><div class="sf-foot"><button type="submit" class="sf-pill" disabled>Verify and save PIN</button></div>`;
        const boxes = $$('.sf-code input', f), err = $('.sf-err', f), btn = $('.sf-pill', f), note = $('.sf-tn', f), rs = $('.sf-rs', f);
        $('.sf-back', f).onclick = stepPin;
        const val = () => boxes.map(b => b.value).join('');
        const start = () => { let s = 30; rs.disabled = true; stop(); const tick = () => { note.textContent = s > 0 ? `You can resend in ${s}s` : 'Didn’t get it?'; if (s-- <= 0) { stop(); rs.disabled = false; } }; tick(); timer = setInterval(tick, 1000); };
        start();
        rs.onclick = async () => { rs.disabled = true; const r = await S.api.sendCode(email); if (!r.ok) { err.textContent = r.msg || 'We couldn’t send a new code. Try again.'; rs.disabled = false; return; } boxes.forEach(b => b.value = ''); boxes[0].focus(); btn.disabled = true; err.textContent = ''; start(); toastMsg('New code sent'); };
        boxes.forEach((b, i) => {
          b.addEventListener('input', () => { b.value = b.value.replace(/\D/g, '').slice(-1); err.textContent = ''; if (b.value && i < 5) boxes[i + 1].focus(); btn.disabled = val().length < 6; if (val().length === 6) f.requestSubmit(); });
          b.addEventListener('keydown', e => { if (e.key === 'Backspace' && !b.value && i > 0) boxes[i - 1].focus(); });
          b.addEventListener('paste', e => { const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); if (!d) return; e.preventDefault(); [...d].forEach((c, k) => boxes[k].value = c); boxes[Math.min(d.length, 5)].focus(); btn.disabled = d.length < 6; if (d.length === 6) f.requestSubmit(); });
        });
        f.addEventListener('submit', async e => {
          e.preventDefault(); if (val().length < 6 || btn.disabled && btn.dataset.busy) return;
          btn.disabled = true; btn.dataset.busy = 1; btn.textContent = 'Verifying…';
          const r = await S.api.verifyCode(email, val());
          if (!r.ok) { btn.dataset.busy = ''; btn.textContent = 'Verify and save PIN'; boxes.forEach(b => b.value = ''); boxes[0].focus(); err.textContent = r.msg || 'That code isn’t right or has expired. Request a new code.'; return; }
          const saved = await S.setPin(pin);
          if (!saved.ok) { btn.dataset.busy = ''; btn.disabled = false; btn.textContent = 'Verify and save PIN'; err.textContent = 'We couldn’t save your PIN. Try again.'; return; }
          stop(); fx('ok');
          // loader again, then roll back to whatever they were doing
          await cover('PIN saved. Taking you back', 1700, () => { layer.remove(); });
          resolve(true);
        });
        swap(f);
      }
      const toastMsg = m => { const t = $('#toast'); if (!t) return; t.textContent = m; t.classList.add('on'); clearTimeout(toastMsg.id); toastMsg.id = setTimeout(() => t.classList.remove('on'), 2200); };

      // loader plays first, then rolls up to reveal the form
      await cover('Getting things ready', 1600, () => { document.body.appendChild(layer); stepPin(); });
    });
  }

  return { cover, pinPad, setupFlow, maskEmail };
})();
