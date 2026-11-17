/* CV page: print button, rise-in motion, tile stagger and the "On this page" scroll-spy. Still under reduced motion. */
(function () {
  var root = document.documentElement;
  var still = !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still) root.classList.add('fx');
  var SEL = '.cv-hero, .cv-reveal, .cv-map';
  var showAll = function () { document.querySelectorAll(SEL).forEach(function (el) { el.classList.add('in'); }); };
  // print: core skills go to the narrow left column (Olivia's print layout); put back after printing
  var core, coreHome;
  window.addEventListener('beforeprint', function () {
    showAll();
    core = document.getElementById('cv-core'); var side = document.querySelector('.cv-side');
    if (core && side && core.parentNode !== side) { coreHome = core.nextElementSibling; side.insertBefore(core, side.querySelector('#cv-lang') ? side.querySelector('#cv-lang').closest('section') : null); }
  });
  window.addEventListener('afterprint', function () {
    if (core && coreHome && coreHome.parentNode) coreHome.parentNode.insertBefore(core, coreHome);
  });
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.cv-print');
    if (btn) btn.addEventListener('click', function () { showAll(); window.print(); });

    // blocks that rise in as groups
    document.querySelectorAll('.cv-main > .cv-block, .cv-side > .cv-block, .cv-toc, .cv-closing').forEach(function (el) { el.classList.add('cv-reveal'); });
    document.querySelectorAll('.cv-tile').forEach(function (el, i) { el.style.setProperty('--i', i % 14); });

    // scroll-spy for "On this page"
    var links = Array.prototype.slice.call(document.querySelectorAll('.cv-toc a'));
    var targets = links.map(function (a) { return document.querySelector(a.getAttribute('href')); });
    var setCurrent = function (id) { links.forEach(function (a) { if (a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }); };
    links.forEach(function (a, i) {
      a.addEventListener('click', function () {
        var t = targets[i]; if (!t) return;
        var h = t.querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); setTimeout(function () { h.focus({ preventScroll: true }); }, 400); }
        setCurrent(t.id);
      });
    });
    if ('IntersectionObserver' in window && targets.length) {
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) setCurrent(e.target.id); });
      }, { rootMargin: '-30% 0px -60% 0px' });
      targets.forEach(function (t) { if (t) spy.observe(t); });
    }

    if (still) return;
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav && nav.type === 'back_forward') { showAll(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    document.querySelectorAll(SEL).forEach(function (el) { io.observe(el); });
  });
})();
