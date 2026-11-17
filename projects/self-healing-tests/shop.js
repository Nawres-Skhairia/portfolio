// The made-up shop. It applies the redesign stop asked for in the address (?stop=0..3),
// then runs a tiny checkout. Made-up products, no real data, nothing is sent anywhere.
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const stop = Math.max(0, Math.min(3, Number(params.get('stop')) || 0));
  const $ = (id) => document.getElementById(id);
  let bug = false;

  // ---------- 1. apply the fixed redesign changes ----------
  SH_REDESIGN.opsUpTo(stop).forEach((o) => {
    if (o.op === 'rename') {
      const el = $(o.from);
      const label = document.querySelector('label[for="' + o.from + '"]');
      el.id = o.to; el.setAttribute('data-test', o.to);
      if (label) { label.htmlFor = o.to; if (o.label) label.textContent = o.label; }
      if (o.labelId && o.label) $(o.labelId).textContent = o.label;
      if (o.text) el.textContent = o.text;
      if (o.aria) el.setAttribute('aria-label', o.aria);
    } else if (o.op === 'move') {
      $(o.before).before($(o.el));
    } else if (o.op === 'wrap') {
      const box = document.createElement('div'), t = document.createElement('p'), sec = $(o.el);
      box.className = 'wrapblock'; t.className = 'wraptitle'; t.textContent = o.title;
      sec.before(box); box.append(t, sec);
    } else if (o.op === 'swap') {
      const a = $(o.a), b = $(o.b), mark = document.createElement('span');
      a.before(mark); b.before(a); mark.replaceWith(b);
    } else if (o.op === 'layout') {
      $('shop').classList.add('cols');
    } else if (o.op === 'bug') {
      bug = true;
    }
  });

  // ---------- 2. the checkout ----------
  // Elements are found by role in the page's own code, so the page works at every stop.
  const q = (sel) => document.querySelector(sel);
  const el = {
    beans: q('#sec-basket .line:nth-of-type(1) input'), mug: q('#sec-basket .line:nth-of-type(2) input'),
    delivery: q('#sec-delivery select'), code: q('#sec-code input'), apply: q('#sec-code button'), codeMsg: q('#sec-code output'),
    name: q('#sec-contact .line:nth-of-type(1) input'), email: q('#sec-contact input[type=email]'),
    total: q('#sec-total output'), place: q('#actions .primary'), cancel: q('#actions button:not(.primary)'), result: q('[role=status]')
  };
  const PRICE = { beans: 12, mug: 8.5 }, DELIVERY = { standard: 4.9, pickup: 0 };
  let discount = 0;
  const qty = (i) => { const n = Math.floor(Number(i.value)); return Number.isFinite(n) && n > 0 ? Math.min(n, 9) : 0; };
  const euro = (n) => '€' + n.toFixed(2);
  function goods() { return qty(el.beans) * PRICE.beans + qty(el.mug) * PRICE.mug; }
  function total() {
    const g = goods() * (1 - discount);
    const fee = bug ? 0 : DELIVERY[el.delivery.value]; // the planted bug of stop 3
    return Math.round((g + fee) * 100) / 100;
  }
  function show() { el.total.textContent = euro(total()); }
  function say(text, state) { el.result.textContent = text; el.result.dataset.state = state; }

  [el.beans, el.mug, el.delivery].forEach((i) => { i.addEventListener('input', show); i.addEventListener('change', show); });
  el.apply.addEventListener('click', () => {
    const ok = el.code.value.trim().toUpperCase() === 'WELCOME10';
    discount = ok ? 0.1 : 0;
    el.codeMsg.textContent = ok ? '10% off your coffee and mugs' : 'Code not valid';
    show();
  });
  el.place.addEventListener('click', () => {
    if (goods() === 0) return say('Your basket is empty', 'error');
    if (!el.name.value.trim()) return say('Please enter your name', 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.email.value.trim())) return say('Please enter your email', 'error');
    say('Order placed. Total ' + euro(total()) + '.', 'placed');
  });
  el.cancel.addEventListener('click', () => {
    el.beans.value = '0'; el.mug.value = '0'; show();
    say('Order cancelled', 'cancelled');
  });
  show();
  document.documentElement.dataset.ready = '1';
})();
