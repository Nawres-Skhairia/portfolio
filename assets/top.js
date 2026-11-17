// Home page only, loaded in the page head so it runs before the browser restores the old
// scroll position: on refresh, always start at the top (phones otherwise jump back to the
// last section). A file, not inline code, so the browser safety settings stay strict (PORT-26).
(function () {
  'use strict';
  // Always 'manual' on this page: the browser decides whether to restore the old position
  // from the setting in force when the page was left, so setting it only after a reload is too late.
  // (Going back from a project page still keeps the place: the browser keeps the whole page in memory.)
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  if (!nav || nav.type !== 'reload') return;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  var top = function () { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); document.documentElement.style.scrollBehavior = ''; };
  top();
  document.addEventListener('DOMContentLoaded', top);
  window.addEventListener('load', top);
  window.addEventListener('pageshow', top);
})();
