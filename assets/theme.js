// Light and dark switch. Loaded in the head so the page never flashes the wrong theme.
// The site opens in dark. A choice made with the switch applies to every page and is kept only for this visit
// (sessionStorage, erased when the tab closes), never sent anywhere. No cookie. File, not inline code (PORT-26).
(function () {
  'use strict';
  var root = document.documentElement, KEY = 'theme', saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch (e) {}
  root.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
  root.classList.add('has-theme-switch');
  function current() { return root.getAttribute('data-theme'); }
  function sync() { document.querySelectorAll('.theme-switch').forEach(function (b) { b.setAttribute('aria-pressed', current() === 'dark' ? 'true' : 'false'); }); }
  document.addEventListener('DOMContentLoaded', function () {
    sync();
    document.querySelectorAll('.theme-switch').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = current() === 'dark' ? 'light' : 'dark';
        var apply = function () {
          root.setAttribute('data-theme', next);
          try { sessionStorage.setItem(KEY, next); } catch (e) {}
          sync();
        };
        var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!calm && document.startViewTransition) {
          var r = btn.getBoundingClientRect();
          root.style.setProperty('--theme-x', (r.left + r.width / 2) + 'px');
          root.style.setProperty('--theme-y', (r.top + r.height / 2) + 'px');
          root.classList.add('theme-changing');
          var t = document.startViewTransition(apply);
          t.finished.then(function () { root.classList.remove('theme-changing'); }, function () { root.classList.remove('theme-changing'); });
        } else {
          apply();
        }
      });
    });
  });
})();
