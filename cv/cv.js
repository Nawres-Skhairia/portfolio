/* CV page: Motion switch, print without links, reveal on scroll, section bar, experience filters. No requests, nothing stored but the Motion choice for this tab. */
(function () {
  var root = document.documentElement;
  // Motion switch: a per-visit choice (sessionStorage, erased when the tab closes), like the theme switch. Nothing is sent.
  // Motion is on unless the visitor turns it off (Nawres, 17 Nov: the effects must show on phones too). Page transitions follow the system setting.
  var saved = null;
  try { saved = sessionStorage.getItem('cv-motion'); } catch (e) {}
  var off = saved === 'off';
  var skipVT = function (e) { if (off && e.viewTransition) e.viewTransition.skipTransition(); };
  window.addEventListener('pagereveal', skipVT);
  window.addEventListener('pageswap', skipVT);
  root.classList.add(off ? 'cv-motion-off' : 'cv-motion-on');
  var still = off || !('IntersectionObserver' in window);
  if (!still) {
    root.classList.add('fx');
    setTimeout(function () { if (!document.querySelector('.cv-hero.in')) root.classList.remove('fx'); }, 3000);
  }
  var SEL = '.cv-hero, .cv-reveal';
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

    // the section bar sits under the site header, whatever its height
    var head = document.querySelector('.site-head');
    var setHead = function () { if (head) document.body.style.setProperty('--head-h', head.offsetHeight + 'px'); };
    setHead(); addEventListener('resize', setHead);

    // Experience filters: everything is shown by default; a filter only narrows the current role's categories.
    var cats = document.querySelectorAll('.cv-cat');
    var fbtns = document.querySelectorAll('.cv-filter button');
    var apply = function (set) {
      cats.forEach(function (c) { c.hidden = !!set && set.indexOf(c.getAttribute('data-cat')) < 0; });
      fbtns.forEach(function (b) { var f = b.getAttribute('data-f'); b.setAttribute('aria-pressed', String(set ? set.indexOf(f) >= 0 : f === 'all')); });
    };
    fbtns.forEach(function (b) { b.addEventListener('click', function () { var f = b.getAttribute('data-f'); apply(f === 'all' || b.getAttribute('aria-pressed') === 'true' ? null : [f]); }); });
    // Skills layers point to the experience categories of the same field
    document.querySelectorAll('.cv-layer-name button').forEach(function (b) {
      b.addEventListener('click', function () {
        var set = (b.getAttribute('data-cats') || '').split(' ').filter(Boolean);
        apply(set.length ? set : null);
        var now = document.querySelector('.cv-job.is-now');
        if (now) {
          now.scrollIntoView({ behavior: off ? 'auto' : 'smooth', block: 'start' });
          cats.forEach(function (c) { if (!c.hidden) { c.classList.add('hl'); setTimeout(function () { c.classList.remove('hl'); }, 1600); } });
        }
      });
    });

    // section bar: the current section is underlined
    var links = Array.prototype.slice.call(document.querySelectorAll('.cv-sec a'));
    var targets = links.map(function (a) { return document.querySelector(a.getAttribute('href')); });
    var bar = document.querySelector('.cv-sec-bar');
    var sd = window.CSS && CSS.supports('animation-timeline: scroll()');
    var ticking = false;
    var spy = function () {
      ticking = false;
      var y = innerHeight * 0.35, cur = -1;
      targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top < y) cur = i; });
      links.forEach(function (a, i) { a.classList.toggle('on', i === cur); if (i === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      if (bar && !sd) { var h = document.documentElement.scrollHeight - innerHeight; bar.style.setProperty('--p', h > 0 ? Math.min(1, scrollY / h) : 0); }
    };
    addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
    spy();

    if (still) return;
    document.querySelectorAll('.cv-profile-block, .cv-job, .cv-layer, .cv-toolgrid, .cv-card').forEach(function (el) { el.classList.add('cv-reveal'); });
    var stagger = function (sel, step, cap) { document.querySelectorAll(sel).forEach(function (ul) { var n = ul.children.length, s = n > 1 ? Math.min(step, cap / (n - 1)) : 0; Array.prototype.forEach.call(ul.children, function (li, i) { li.style.setProperty('--d', Math.round(i * s) + 'ms'); }); }); };
    stagger('.cv-points', 45, 400); stagger('.cv-tags', 30, 400);
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav && nav.type === 'back_forward') { showAll(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    document.querySelectorAll(SEL).forEach(function (el) { io.observe(el); });
  });
})();
