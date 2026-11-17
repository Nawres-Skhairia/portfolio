// Tool pages: leaving with the Back link drops the dark panel, then the home page lifts it away.
// A file, not inline code, so the browser safety settings stay strict (PORT-26). Nothing is stored.
(function () {
  'use strict';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var back = document.querySelector('.back');
  if (!back) return;
  back.addEventListener('click', function (e) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    var href = back.href;
    document.documentElement.classList.add('pt-leave');
    setTimeout(function () { location.href = href; }, 560);
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) document.documentElement.classList.remove('pt-leave'); });
})();
