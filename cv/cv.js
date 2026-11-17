/* CV page: print button and the rise-in motion (still under reduced motion). */
(function () {
  var root = document.documentElement;
  // Motion switch: a per-visit choice (sessionStorage, erased when the tab closes), like the theme switch. Nothing is sent.
  // Motion is on unless the visitor turns it off with the switch (Nawres, 17 Nov: the effects must show on phones too,
  // including phones with the system's reduce-motion setting). The page transition still follows the system setting.
  var saved = null;
  try { saved = sessionStorage.getItem('cv-motion'); } catch (e) {}
  var off = saved === 'off';
  // no page transition when motion is off
  var skipVT = function (e) { if (off && e.viewTransition) e.viewTransition.skipTransition(); };
  window.addEventListener('pagereveal', skipVT);
  window.addEventListener('pageswap', skipVT);
  root.classList.add(off ? 'cv-motion-off' : 'cv-motion-on');
  var still = off || !('IntersectionObserver' in window);
  if (!still) {
    root.classList.add('fx');
    // safety: if the reveal script never runs, show everything after 3 s
    setTimeout(function () { if (!document.querySelector('.cv-hero.in')) root.classList.remove('fx'); }, 3000);
  }
  var SEL = '.cv-hero, .cv-job, .cv-side .cv-block, .cv-main > .cv-block > .cv-h, #cv-side-projects ~ *';
  var showAll = function () { document.querySelectorAll(SEL).forEach(function (el) { el.classList.add('in'); }); };
  // The PDF carries no clickable links: hrefs are lifted while printing and put back after.
  var unlink = function () { document.querySelectorAll('a[href]').forEach(function (a) { a.setAttribute('data-href', a.getAttribute('href')); a.removeAttribute('href'); }); };
  var relink = function () { document.querySelectorAll('a[data-href]').forEach(function (a) { a.setAttribute('href', a.getAttribute('data-href')); a.removeAttribute('data-href'); }); };
  window.addEventListener('beforeprint', function () { showAll(); unlink(); });
  window.addEventListener('afterprint', relink);
  document.addEventListener('DOMContentLoaded', function () {
    var mot = document.querySelector('.cv-motion');
    if (mot) {
      mot.setAttribute('aria-pressed', off ? 'false' : 'true');
      mot.addEventListener('click', function () { try { sessionStorage.setItem('cv-motion', off ? 'on' : 'off'); } catch (e) {} location.reload(); });
    }
    var btn = document.querySelector('.cv-print');
    if (btn) btn.addEventListener('click', function () { showAll(); unlink(); window.print(); relink(); });
    if (still) return;
    // staggered lines and tags: each item gets its place in its list
    // stagger capped per group: 400 ms in total for a list of lines, 500 ms for a group of tags
    var stagger = function (sel, step, cap) { document.querySelectorAll(sel).forEach(function (ul) { var n = ul.children.length, s = n > 1 ? Math.min(step, cap / (n - 1)) : 0; Array.prototype.forEach.call(ul.children, function (li, i) { li.style.setProperty('--d', Math.round(i * s) + 'ms'); }); }); };
    stagger('.cv-points', 45, 400); stagger('.cv-tags', 30, 500);
    // reading progress bar
    var bar = document.createElement('div'); bar.className = 'cv-progress'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar);
    var tick = false, upd = function () { tick = false; var h = document.documentElement.scrollHeight - innerHeight; bar.style.setProperty('--p', h > 0 ? Math.min(1, scrollY / h) : 0); };
    // native scroll-driven animation where the browser has it; a light scroll listener everywhere else
    if (window.CSS && CSS.supports('animation-timeline: scroll()')) bar.classList.add('sd');
    else { addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true }); upd(); }
    // soft light that follows the pointer on the current role (fine pointers only)
    var card = document.querySelector('.cv-job.is-now');
    if (card && matchMedia('(hover: hover) and (pointer: fine)').matches) card.addEventListener('pointermove', function (e) { var r = card.getBoundingClientRect(); card.style.setProperty('--mx', (e.clientX - r.left) + 'px'); card.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav && nav.type === 'back_forward') { showAll(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    document.querySelectorAll(SEL).forEach(function (el) { io.observe(el); });
  });
})();
