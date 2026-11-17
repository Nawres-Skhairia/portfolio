// The robot and the healing loop. The robot really types and clicks in the shop, which lives
// in its own frame. The healer (heal-core.js) only proposes a new target; a repair is accepted
// only when the whole test, run again from a fresh page, goes green.
(function (root) {
  'use strict';
  const H = root.SH_HEAL, FP = root.SH_TESTS.FINGERPRINTS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function Robot(frame, cursor, stage) { this.frame = frame; this.cursor = cursor; this.stage = stage; this.delay = 350; }
  Robot.prototype.open = function (stop) {
    const frame = this.frame;
    return new Promise((resolve) => {
      frame.addEventListener('load', function done() {
        frame.removeEventListener('load', done);
        const d = frame.contentDocument;
        const wait = () => (d.documentElement.dataset.ready === '1' ? resolve() : setTimeout(wait, 10));
        wait();
      });
      frame.src = 'shop.html?stop=' + stop + '&t=' + Date.now();
    });
  };
  Robot.prototype.doc = function () { return this.frame.contentDocument; };
  Robot.prototype.find = function (target, map) {
    const id = map && map[target];
    return id ? this.doc().getElementById(id) : this.doc().querySelector('[data-test="' + target + '"]');
  };
  Robot.prototype.point = async function (el) {
    if (!this.cursor || !this.delay) return;
    // Frame coordinates, inside the (possibly shrunk) stage: 1 px is the frame's border.
    const r = el.getBoundingClientRect();
    this.cursor.hidden = false;
    this.cursor.style.transform = 'translate(' + Math.round(1 + r.left + Math.min(24, r.width / 2)) + 'px,' + Math.round(1 + r.top + r.height / 2) + 'px)';
    el.classList.add('robot');
    await sleep(this.delay);
    el.classList.remove('robot');
  };
  const readOf = (el) => String(el.matches('input, select, textarea') ? el.value : el.textContent).trim();

  // Runs one test on a fresh page. map: target -> element id, for repaired targets.
  Robot.prototype.run = async function (test, stop, map) {
    await this.open(stop);
    const log = [];
    for (let i = 0; i < test.steps.length; i++) {
      const st = test.steps[i];
      const el = this.find(st.target, map);
      const how = map && map[st.target] ? '#' + map[st.target] + ' (repaired)' : 'data-test="' + st.target + '"';
      if (!el) { log.push('✗ ' + st.say + ': nothing found at ' + how + '.'); return { status: 'broken', at: i, target: st.target, log }; }
      await this.point(el);
      if (st.do === 'set') {
        el.value = st.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        log.push('✓ ' + st.say + ' (' + how + ').');
      } else if (st.do === 'click') {
        el.click(); await sleep(20);
        log.push('✓ ' + st.say + ' (' + how + ').');
      } else {
        const actual = readOf(el);
        const ok = st.equals !== undefined ? actual === st.equals : actual.includes(st.contains);
        if (!ok) {
          log.push('✗ ' + st.say + ': the page shows "' + actual + '" (' + how + ').');
          return { status: 'fail', at: i, target: st.target, actual, expected: st.equals !== undefined ? st.equals : '… ' + st.contains + ' …', log };
        }
        log.push('✓ ' + st.say + ': "' + actual + '".');
      }
    }
    if (this.cursor) this.cursor.hidden = true;
    return { status: 'pass', log };
  };

  function mapOf(repairs) { const m = {}; Object.values(repairs).forEach((r) => { m[r.target] = r.id; }); return m; }

  // The healing loop for one test. Returns the outcome and every attempt, accepted or not.
  async function heal(robot, test, stop, opinion) {
    const first = await robot.run(test, stop, {});
    const out = { test: test.id, name: test.name, first, repairs: [], attempts: [], outcome: '', reason: '' };
    if (first.status === 'pass') { out.outcome = 'passed'; out.last = first; return out; }
    if (first.status === 'fail') { out.outcome = 'failed'; out.reason = 'Every element was found where the test expected it, and the page gave a wrong answer. Nothing to heal.'; out.last = first; return out; }

    const repairs = {};
    let res = first, guard = 0;
    while (res.status === 'broken' && guard++ < 12) {
      const fp = FP[res.target];
      const used = new Set(Object.values(repairs).map((r) => r.id));
      const ranked = H.rank(fp, robot.doc(), used);
      const pick = opinion ? await opinion(fp, ranked) : { index: 0, by: 'rules' };
      const best = ranked[pick.index] || ranked[0];
      const second = ranked.find((r) => r !== best);
      if (!H.proposable(best, second)) {
        out.outcome = 'needs a person';
        out.reason = 'Nothing on the page looks enough like the ' + H.describe(fp) + ' (best match ' + Math.round((best ? best.score : 0) * 100) + '%; the bar is ' + Math.round(H.MIN_SCORE * 100) + '%, or ' + Math.round(H.LONE.score * 100) + '% with nothing else within ' + Math.round(H.LONE.margin * 100) + ' points).';
        out.ranked = { target: res.target, list: ranked };
        out.last = res; out.repairs = Object.values(repairs); return out;
      }
      repairs[res.target] = { target: res.target, step: res.at, old: fp, id: best.id, fp: best.fp, score: best.score, margin: Math.round((best.score - (second ? second.score : 0)) * 100) / 100, ranked, by: pick.by, why: pick.why || '' };
      out.attempts.push({ target: res.target, id: best.id, score: best.score, by: pick.by, result: 'kept for the rerun' });
      res = await robot.run(test, stop, mapOf(repairs));
    }
    out.repairs = Object.values(repairs);
    if (res.status === 'pass') { out.outcome = 'healed'; out.last = res; out.attempts.forEach((a) => { a.result = 'accepted: the rerun is green'; }); return out; }

    // The rerun is still red. Try the next best element for the least clear repair first.
    const order = out.repairs.slice().sort((a, b) => a.margin - b.margin);
    for (const r of order) {
      for (const alt of r.ranked) {
        if (alt.id === r.id || alt.score < H.LONE.score) continue;
        const trial = Object.assign(mapOf(repairs), { [r.target]: alt.id });
        const t = await robot.run(test, stop, trial);
        if (t.status === 'pass') {
          out.attempts.forEach((a) => { a.result = a.target === r.target ? 'rejected: the rerun stayed red' : 'accepted: the rerun is green'; });
          out.attempts.push({ target: r.target, id: alt.id, score: alt.score, by: 'rules (next best)', result: 'accepted: the rerun is green' });
          Object.assign(r, { id: alt.id, fp: alt.fp, score: alt.score, by: 'rules (next best)', replaced: true });
          out.outcome = 'healed'; out.last = t; return out;
        }
        out.attempts.push({ target: r.target, id: alt.id, score: alt.score, by: 'rules (next best)', result: 'rejected: the rerun stayed red' });
      }
    }
    out.last = res;
    const clear = out.repairs.every((r) => r.margin >= H.MARGIN);
    if (res.status === 'fail' && clear) {
      out.outcome = 'real bug';
      out.reason = 'Every moved element was found with a clear lead over the next best, and the page still gives a wrong answer: "' + res.actual + '" instead of "' + res.expected + '". The test is right; the page is wrong.';
      out.attempts.forEach((a) => { if (a.result === 'kept for the rerun') a.result = 'kept: clear match, the check itself fails'; });
    } else {
      out.outcome = 'needs a person';
      out.reason = 'No repair made the test green, and at least one match was not clear enough to blame the page. A person should look.';
      out.attempts.forEach((a) => { if (a.result === 'kept for the rerun') a.result = 'not proven: the rerun stayed red'; });
    }
    return out;
  }

  // The test file after healing: only accepted repairs change a locator.
  function patchedTests(tests, results) {
    return tests.map((t) => {
      const r = results.find((x) => x.test === t.id);
      const map = r && r.outcome === 'healed' ? mapOf(Object.fromEntries(r.repairs.map((p) => [p.target, p]))) : {};
      return { id: t.id, name: t.name, steps: t.steps.map((s) => Object.assign({}, s, { locator: map[s.target] ? '#' + map[s.target] : '[data-test="' + s.target + '"]' })) };
    });
  }
  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  function junit(results, stop) {
    const bad = results.filter((r) => r.outcome === 'real bug' || r.outcome === 'needs a person' || r.outcome === 'failed').length;
    const cases = results.map((r) => '  <testcase classname="shop.checkout.stop' + stop + '" name="' + esc(r.test + ' ' + r.name) + '">' +
      (r.outcome === 'real bug' || r.outcome === 'failed' ? '<failure message="' + esc(r.reason) + '"/>' : r.outcome === 'needs a person' ? '<error message="' + esc(r.reason) + '"/>' : '') +
      (r.outcome === 'healed' ? '<system-out>' + esc('Healed: ' + r.repairs.map((p) => p.target + ' -> #' + p.id).join(', ')) + '</system-out>' : '') + '</testcase>').join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Self-Healing Tests, redesign stop ' + stop + '" tests="' + results.length + '" failures="' + bad + '">\n' + cases + '\n</testsuite>\n';
  }
  root.SH_ENGINE = { Robot, heal, patchedTests, junit };
})(window);
