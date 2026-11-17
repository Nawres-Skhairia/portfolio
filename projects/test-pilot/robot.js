// The test robot: really types and clicks in the booking form, which lives in its own frame.
// It only follows test steps from the checked plan. It never decides pass or fail: core.js does.
(function (root) {
  'use strict';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function Robot(frame, cursor, stage) {
    this.frame = frame; this.cursor = cursor; this.stage = stage; this.delay = 500; this.bug = 0;
  }

  // Fresh form for every test, so one test can never affect the next.
  Robot.prototype.open = function () {
    const frame = this.frame, bug = this.bug;
    return new Promise((resolve) => {
      frame.addEventListener('load', function done() { frame.removeEventListener('load', done); resolve(); });
      frame.src = 'form.html?bug=' + bug + '&t=' + Date.now();
    });
  };
  Robot.prototype.doc = function () { return this.frame.contentDocument; };
  Robot.prototype.q = function (name) { return this.doc().querySelector('[data-test="' + name + '"]'); };

  // Moves the drawn cursor over an element of the form and highlights it.
  Robot.prototype.point = async function (el) {
    const s = this.stage.getBoundingClientRect(), f = this.frame.getBoundingClientRect(), r = el.getBoundingClientRect();
    this.cursor.hidden = false;
    this.cursor.style.transform = 'translate(' + Math.round(f.left - s.left + r.left + Math.min(28, r.width / 2)) + 'px,' + Math.round(f.top - s.top + r.top + r.height / 2) + 'px)';
    el.classList.add('robot');
    await sleep(this.delay);
    el.classList.remove('robot');
  };
  Robot.prototype.type = async function (name, value) {
    const el = this.q(name);
    await this.point(el);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  Robot.prototype.click = async function (name, twice) {
    const el = this.q(name);
    await this.point(el);
    el.click();
    if (twice) el.click();
    await sleep(60);
  };
  Robot.prototype.read = function () {
    const st = this.q('result').dataset.state;
    const t = (n) => (this.q(n).textContent || '').trim();
    return {
      outcome: st === 'accepted' ? 'accepted' : st === 'refused' ? 'refused' : 'no answer',
      message: st === 'refused' ? t('error') : '',
      summary: st === 'accepted' ? { date: t('sum-date'), time: t('sum-time'), guests: t('sum-guests') } : null,
      bookings: Number(t('count')) || 0
    };
  };

  // Runs one checked test. Returns what the form really did, plus a step log.
  Robot.prototype.run = async function (test, base) {
    const log = [];
    const work = (async () => {
      await this.open();
      const d = this.doc();
      // Start from a valid booking (fictional data), filled instantly.
      ['date', 'time', 'guests', 'email'].forEach((k) => { d.querySelector('[data-test="' + k + '"]').value = base[k]; });
      log.push('Form opened with a valid booking: ' + base.date + ', ' + base.time + ', ' + base.guests + ' guests, ' + base.email + '.');
      if (test.value === 'tonight') { await this.click('tonight'); log.push('Pressed "Tonight at 19:30".'); }
      else if (test.field !== 'booking') { await this.type(test.field, test.value); log.push('Typed ' + test.field + ' = ' + (test.value === '' ? '(empty)' : test.value) + '.'); }
      const before = this.read().bookings;
      await this.click('book', test.technique === 'state');
      log.push(test.technique === 'state' ? 'Double-clicked "Book a table".' : 'Pressed "Book a table".');
      await sleep(Math.min(this.delay, 200));
      const a = this.read();
      a.bookingsAdded = a.bookings - before;
      log.push('Form answered: ' + a.outcome + (a.message ? ' ("' + a.message + '")' : '') + (a.summary ? ', summary ' + a.summary.date + ' ' + a.summary.time + ' ' + a.summary.guests + ' guests' : '') + '; bookings made: ' + a.bookings + '.');
      return a;
    })();
    const timeout = sleep(5000 + this.delay * 6).then(() => ({ timedOut: true, outcome: 'no answer' })); // R7
    const actual = await Promise.race([work, timeout]);
    if (actual.timedOut) log.push('No answer within the time limit.');
    return { actual, log };
  };

  root.TP_Robot = Robot;
})(window);
