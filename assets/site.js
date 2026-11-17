// Site-wide script (same origin, no inline code, for the browser safety settings, PORT-26).
// Only small finishing touches: the page works and reads the same without it.
(function () {
  'use strict';
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // the menu marks the section on screen (all devices)
  var links = {};
  document.querySelectorAll('.nav nav a[href^="#"]').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var a = links[en.target.id];
        if (a) a.classList.toggle('is-here', en.isIntersecting);
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(links).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
  }

  if (calm) return;

  // page change to a tool: a dark panel sweeps up and the tool's picture grows to fill the screen, then the tool opens
  document.querySelectorAll('a.row').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
      e.preventDefault();
      var href = a.href, img = a.querySelector('.media img');
      var panel = document.createElement('div'); panel.className = 'pt-panel';
      document.body.appendChild(panel);
      if (img && img.animate) {
        var r = img.getBoundingClientRect(), pic = document.createElement('img');
        pic.src = img.currentSrc || img.src; pic.alt = ''; pic.className = 'pt-pic';
        pic.style.left = r.left + 'px'; pic.style.top = r.top + 'px'; pic.style.width = r.width + 'px'; pic.style.height = r.height + 'px';
        document.body.appendChild(pic);
        img.style.visibility = 'hidden';
        var vw = window.innerWidth, vh = window.innerHeight;
        var k = Math.min(vw * 0.86 / r.width, vh * 0.7 / r.height);
        var dx = vw / 2 - (r.left + r.width / 2), dy = vh / 2 - (r.top + r.height / 2);
        pic.animate([
          { transform: 'none' },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + k + ')', opacity: 1, offset: 0.7 },
          { transform: 'translate(' + dx + 'px,' + (dy - 20) + 'px) scale(' + (k * 1.03) + ')', opacity: 1 }
        ], { duration: 1000, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
      }
      requestAnimationFrame(function () { panel.classList.add('go'); });
      setTimeout(function () { location.href = href; }, 950);
    });
  });
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    document.querySelectorAll('.pt-panel, .pt-pic').forEach(function (n) { n.remove(); });
    document.querySelectorAll('.media img').forEach(function (i) { i.style.visibility = ''; });
  });

  // proof panel: the test counts run up with the lines (the final number is already in the page)
  document.querySelectorAll('.proof .count').forEach(function (el, i) {
    var to = parseInt(el.textContent, 10), start = 0, delay = i ? 1900 : 600, dur = 700;
    if (!to) return;
    el.textContent = '0';
    setTimeout(function () {
      function step(t) {
        if (!start) start = t;
        var k = Math.min(1, (t - start) / dur);
        el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }, delay);
  });

  if (!fine) return;

  // light that follows the pointer, and a slow drift of the screenshot
  function track(sel, fn) {
    document.querySelectorAll(sel).forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        fn(el, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e, r);
      }, { passive: true });
      el.addEventListener('pointerleave', function () { fn(el, null); });
    });
  }
  track('.row', function (el, x, yy) {
    var img = el.querySelector('.media img');
    if (x === null) { if (img) { ['--ix', '--iy', '--irx', '--iry'].forEach(function (p) { img.style.removeProperty(p); }); } return; }
    el.style.setProperty('--mx', (x * 100) + '%');
    el.style.setProperty('--my', (yy * 100) + '%');
    if (img) {
      img.style.setProperty('--ix', ((0.5 - x) * 8) + 'px'); img.style.setProperty('--iy', ((0.5 - yy) * 6) + 'px');
      img.style.setProperty('--irx', ((0.5 - yy) * 3) + 'deg'); img.style.setProperty('--iry', ((x - 0.5) * 4) + 'deg');
    }
  });
  track('.proof', function (el, x, yy) {
    if (x === null) { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); return; }
    el.style.setProperty('--mx', (x * 100) + '%');
    el.style.setProperty('--my', (yy * 100) + '%');
    el.style.setProperty('--rx', ((0.5 - yy) * 6) + 'deg');
    el.style.setProperty('--ry', ((x - 0.5) * 8) + 'deg');
  });
  track('.contact-box', function (el, x, yy) {
    if (x === null) return;
    el.style.setProperty('--mx', (x * 100) + '%');
    el.style.setProperty('--my', (yy * 100) + '%');
  });

  track('.hero', function (el, x, yy) {
    if (x === null) { el.style.setProperty('--hx', '0px'); el.style.setProperty('--hy', '0px'); return; }
    el.style.setProperty('--hx', ((x - 0.7) * 160) + 'px');
    el.style.setProperty('--hy', ((yy - 0.3) * 120) + 'px');
  });
  // buttons lean towards the pointer, and their fill starts where the pointer came in
  track('.magnetic', function (el, x, yy) {
    if (x === null) { el.style.setProperty('--tx', '0px'); el.style.setProperty('--ty', '0px'); return; }
    el.style.setProperty('--px', (x * 100) + '%');
    el.style.setProperty('--py', (yy * 100) + '%');
    el.style.setProperty('--tx', ((x - 0.5) * 10) + 'px');
    el.style.setProperty('--ty', ((yy - 0.5) * 8) + 'px');
  });
})();
