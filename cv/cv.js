/* CV page: print button and the rise-in motion (still under reduced motion). */
(function () {
  var root = document.documentElement;
  var still = !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still) root.classList.add('fx');
  var SEL = '.cv-hero, .cv-job, .cv-side .cv-block, .cv-main > .cv-block > .cv-h, #cv-side-projects ~ *';
  var showAll = function () { document.querySelectorAll(SEL).forEach(function (el) { el.classList.add('in'); }); };
  window.addEventListener('beforeprint', showAll);
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.cv-print');
    if (btn) btn.addEventListener('click', function () { showAll(); window.print(); });
    if (still) return;
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav && nav.type === 'back_forward') { showAll(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    document.querySelectorAll(SEL).forEach(function (el) { io.observe(el); });
  });
})();
