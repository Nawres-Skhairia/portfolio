/* CV page, screen effects (showpiece pass). Screen only, no libraries, no requests, nothing stored.
   Under reduced motion: the background is drawn once and stays still; everything else stays off.
   All text is already in the HTML; this file only decorates it. */
(function () {
  'use strict';
  var root = document.documentElement;
  var calm = root.classList.contains('cv-motion-off');
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function css(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  ready(function () {
    var hero = document.querySelector('.cv-hero');
    if (!hero) return;

    /* 1. Live grid behind the hero: a field of points with a slow wave, packets running along the lines,
          and a ripple that follows the pointer. Paused when off screen or when the tab is hidden. */
    var stage = document.createElement('div');
    stage.className = 'cv-stage';
    stage.setAttribute('aria-hidden', 'true');
    var cv = document.createElement('canvas');
    stage.appendChild(cv);
    hero.insertBefore(stage, hero.firstChild);
    var ctx = cv.getContext('2d');
    var W = 0, H = 0, dpr = 1, gap = 30, pts = [], packets = [], mx = -9999, my = -9999, t0 = performance.now(), on = true, raf = 0;
    var col = {};
    function colours() { col = { dot: css('--ink-3') || '#888', acc: css('--accent') || '#8fcaae' }; }
    function size() {
      var r = stage.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      gap = W < 600 ? 34 : 30;
      pts = [];
      for (var y = gap / 2; y < H; y += gap) for (var x = gap / 2; x < W; x += gap) pts.push(x, y);
      packets = [];
      var n = W < 600 ? 0 : 11; // no moving lines on phones: the text there spans the full width
      for (var i = 0; i < n; i++) packets.push(newPacket(true));
    }
    function newPacket(anywhere) {
      var horiz = Math.random() < 0.6;
      var line = Math.floor(Math.random() * Math.max(1, (horiz ? H : W) / gap)) * gap + gap / 2;
      return { h: horiz, line: line, pos: anywhere ? Math.random() * (horiz ? W : H) : -40, v: 40 + Math.random() * 70, len: 40 + Math.random() * 60 };
    }
    function draw(now) {
      var t = (now - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = col.dot;
      for (var i = 0; i < pts.length; i += 2) {
        var x = pts[i], y = pts[i + 1];
        var w = calm ? 0 : Math.sin(t * 1.1 + x * 0.012 + y * 0.018);
        var dx = x - mx, dy = y - my, d = Math.sqrt(dx * dx + dy * dy), push = 0;
        if (d < 170) push = (1 - d / 170);
        var ox = d ? dx / d * push * 14 : 0, oy = (d ? dy / d * push * 14 : 0) + w * 2.2;
        ctx.globalAlpha = 0.26 + 0.2 * (w + 1) / 2 + push * 0.6;
        var s = 1 + push * 1.8;
        ctx.fillRect(x + ox - s / 2, y + oy - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      if (!calm) {
        for (var k = 0; k < packets.length; k++) {
          var p = packets[k];
          p.pos += p.v / 60;
          var max = p.h ? W : H;
          if (p.pos - p.len > max) packets[k] = p = newPacket(false);
          var g = p.h ? ctx.createLinearGradient(p.pos - p.len, 0, p.pos, 0) : ctx.createLinearGradient(0, p.pos - p.len, 0, p.pos);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, col.acc);
          ctx.strokeStyle = g; ctx.lineWidth = 1.4;
          ctx.beginPath();
          if (p.h) { ctx.moveTo(p.pos - p.len, p.line); ctx.lineTo(p.pos, p.line); } else { ctx.moveTo(p.line, p.pos - p.len); ctx.lineTo(p.line, p.pos); }
          ctx.stroke();
          ctx.fillStyle = col.acc;
          ctx.beginPath();
          if (p.h) ctx.arc(p.pos, p.line, 2, 0, 7); else ctx.arc(p.line, p.pos, 2, 0, 7);
          ctx.fill();
        }
      }
    }
    function loop(now) { raf = 0; if (!on) return; draw(now); raf = requestAnimationFrame(loop); }
    function start() { if (!raf && on && !calm) raf = requestAnimationFrame(loop); }
    colours(); size(); draw(performance.now());
    new MutationObserver(function () { colours(); if (calm) draw(performance.now()); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    var rt = 0;
    addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { size(); draw(performance.now()); }, 150); });
    if (!calm) {
      new IntersectionObserver(function (e) { on = e[0].isIntersecting && !document.hidden; start(); }).observe(stage);
      document.addEventListener('visibilitychange', function () { on = !document.hidden; start(); });
      if (fine) {
        hero.addEventListener('pointermove', function (e) { var r = stage.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
        hero.addEventListener('pointerleave', function () { mx = my = -9999; });
      }
      start();
    }
    if (calm) return;

    /* 2. Kinetic name: each letter rises in turn, and lifts on hover. The heading keeps its plain text for screen readers. */
    var h1 = hero.querySelector('h1');
    if (h1 && !h1.querySelector('.cv-ch')) {
      var name = h1.textContent;
      h1.setAttribute('aria-label', name);
      h1.textContent = '';
      var k = 0;
      name.split(' ').forEach(function (word, wi) {
        if (wi) h1.appendChild(document.createTextNode(' '));
        var w = document.createElement('span');
        w.className = 'cv-word'; w.setAttribute('aria-hidden', 'true');
        word.split('').forEach(function (c) {
          var s = document.createElement('span');
          s.className = 'cv-ch'; s.textContent = c; s.style.setProperty('--k', k++);
          w.appendChild(s);
        });
        h1.appendChild(w);
      });
      root.classList.add('cv-kinetic');
    }

    /* 3. The job title decodes from scrambled characters into the real words (the real words stay for screen readers). */
    var role = hero.querySelector('.cv-role-main');
    if (role) {
      var text = role.textContent, glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ/<>_=+0123456789';
      var real = document.createElement('span'); real.className = 'cv-sr'; real.textContent = text;
      var shown = document.createElement('span'); shown.setAttribute('aria-hidden', 'true'); shown.className = 'cv-scramble';
      role.textContent = ''; role.appendChild(real); role.appendChild(shown);
      var startAt = performance.now() + 650, dur = 1300;
      shown.textContent = text.replace(/\S/g, ' ');
      (function step(now) {
        var p = clamp((now - startAt) / dur, 0, 1), out = '';
        for (var i = 0; i < text.length; i++) {
          var c = text[i];
          if (c === ' ' || i / text.length < p) out += c;
          else if (i / text.length < p + 0.18) out += glyphs[(Math.random() * glyphs.length) | 0];
          else out += ' ';
        }
        shown.textContent = out;
        if (p < 1) requestAnimationFrame(step); else shown.textContent = text;
      })(performance.now());
    }

    /* 4. Parallax: the hero text drifts slower than the page and fades as it leaves; the grid sinks faster. */
    var ticking = false;
    function para() {
      ticking = false;
      var y = window.scrollY, hgt = hero.offsetHeight || 1;
      if (y > hgt * 1.5) return;
      hero.style.setProperty('--py', (y * 0.22).toFixed(1) + 'px');
      hero.style.setProperty('--pf', clamp(1 - y / (hgt * 1.1), 0, 1).toFixed(3));
      stage.style.setProperty('--sy', (y * 0.45).toFixed(1) + 'px');
    }
    addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(para); } }, { passive: true });
    para();

    /* 5. Career timeline: an accent line fills with the scroll, a bright point travels down it,
          and each role's dot lights up when the point reaches it. */
    var jobs = document.querySelector('.cv-jobs');
    if (jobs) {
      var comet = document.createElement('span'); comet.className = 'cv-comet'; comet.setAttribute('aria-hidden', 'true');
      jobs.appendChild(comet);
      var items = jobs.querySelectorAll('.cv-job');
      var tl = false;
      var track = function () {
        tl = false;
        var r = jobs.getBoundingClientRect(), mid = innerHeight * 0.55;
        var p = clamp((mid - r.top) / r.height, 0, 1);
        jobs.style.setProperty('--tp', p.toFixed(4));
        var yy = p * r.height;
        items.forEach(function (it) { it.classList.toggle('lit', it.offsetTop + 12 <= yy); });
      };
      addEventListener('scroll', function () { if (!tl) { tl = true; requestAnimationFrame(track); } }, { passive: true });
      addEventListener('resize', track);
      track();
    }

    /* 8. Dates roll up like a counter when each role comes into view (the real dates stay for screen readers and print). */
    var whens = [];
    document.querySelectorAll('.cv-job .cv-when').forEach(function (el) {
      var txt = el.textContent;
      if (!/\d{4}/.test(txt)) return;
      var real = document.createElement('span'); real.className = 'cv-sr'; real.textContent = txt;
      var roll = document.createElement('span'); roll.className = 'cv-roll'; roll.setAttribute('aria-hidden', 'true'); roll.textContent = txt;
      el.textContent = ''; el.appendChild(real); el.appendChild(roll);
      whens.push({ el: roll, txt: txt, done: false });
    });
    var finish = function () { whens.forEach(function (w) { w.done = true; w.el.textContent = w.txt; }); };
    addEventListener('beforeprint', finish);
    var rollIt = function (w) {
      if (w.done) return; w.done = true;
      var t1 = performance.now(), d = 1100;
      (function step(now) {
        var p = clamp((now - t1) / d, 0, 1), e = 1 - Math.pow(1 - p, 3);
        w.el.textContent = w.txt.replace(/\d{4}/g, function (y) { return String(Math.round(2000 + (Number(y) - 2000) * e)); });
        if (p < 1) requestAnimationFrame(step); else w.el.textContent = w.txt;
      })(t1);
    };
    var io2 = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { whens.forEach(function (w) { if (w.el.parentNode === e.target) rollIt(w); }); io2.unobserve(e.target); } }); }, { threshold: 0.6 });
    whens.forEach(function (w) { io2.observe(w.el.parentNode); });

    if (!fine) return;

    /* 9. A wide soft glow follows the pointer across the whole page background. */
    var glow = document.createElement('div'); glow.className = 'cv-glow'; glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);

    /* 6. Current role card: tilts in 3D toward the pointer, with the light that follows it. */
    var card = document.querySelector('.cv-job.is-now');
    if (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
        var deg = Math.min(2.4, Math.sqrt(nx * nx + ny * ny) * 5);
        card.style.rotate = (-ny).toFixed(3) + ' ' + nx.toFixed(3) + ' 0 ' + deg.toFixed(2) + 'deg';
      });
      card.addEventListener('pointerleave', function () { card.style.rotate = ''; });
    }

    /* 7. Magnetic tags and buttons: they lean toward the pointer, then spring back. */
    document.querySelectorAll('.cv-tags li, .cv-hero .cv-print').forEach(function (el) {
      var pull = el.matches('.cv-tags li') ? 0.28 : 0.2;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = clamp((e.clientX - r.left - r.width / 2) * pull, -6, 6), y = clamp((e.clientY - r.top - r.height / 2) * pull * 1.3, -5, 5);
        el.style.translate = x.toFixed(1) + 'px ' + y.toFixed(1) + 'px';
      });
      el.addEventListener('pointerleave', function () { el.style.translate = ''; });
    });
  });
})();
