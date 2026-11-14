/* Ask your spreadsheet: questions in plain English or French, answered with transparent rules.
   Two steps, kept separate on purpose:
     interpret(question, tables) -> plan   (understanding the words)
     execute(plan, tables)       -> result (doing the maths, always deterministic)
   A smarter "interpret" (for example an AI model) could later return the same plan shape
   without touching execute(), the charts or the "how I calculated it" steps. */
(function (global) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v) => typeof v === 'number' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.abs(v) < 10 ? 2 : Math.abs(v) < 1000 ? 1 : 0 }).format(v) : String(v);
  const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

  const SYN = {
    vente: 'sale', ventes: 'sale', chiffre: 'sale', ca: 'sale', revenue: 'sale', facture: 'invoice', bill: 'invoice',
    retard: 'late', overdue: 'late', montant: 'amount', commercial: 'rep', commerciaux: 'rep', vendeur: 'rep', salesperson: 'rep', seller: 'rep',
    customer: 'client', moi: 'month', mois: 'month', prime: 'bonus', objectif: 'target', goal: 'target', paye: 'paid', payee: 'paid', jour: 'day',
    echeance: 'due', nord: 'north', sud: 'south', ouest: 'west', statut: 'status', etat: 'status', paiement: 'payment', versement: 'payout',
    janvier: 'jan', january: 'jan', fevrier: 'feb', february: 'feb', mar: 'mar', march: 'mar', avril: 'apr', april: 'apr', mai: 'may',
    juin: 'jun', june: 'jun', juillet: 'jul', july: 'jul', aout: 'aug', august: 'aug', septembre: 'sep', september: 'sep', sept: 'sep',
    octobre: 'oct', october: 'oct', novembre: 'nov', november: 'nov', decembre: 'dec', december: 'dec', nom: 'name', employe: 'employee',
    ville: 'city', pay: 'country', produit: 'product', quantite: 'quantity', qty: 'quantity', prix: 'price', cout: 'cost', equipe: 'team', departement: 'department'
  };
  const STOP = new Set('the a an of in on at to for is are was were be and or with from this that what s de du des le la les l d un une et en au aux a est ce ces sont il elle ont avec sur dans pour'.split(' '));
  const FR_HINT = new Set('le la les des du quel quelle quels quelles combien par moyenne somme est plus moins qui chaque nombre ont sont total des une un retard mois ventes factures retards moyen montant'.split(' '));

  function stem(w) { return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w; }
  function tokens(text) {
    const raw = deaccent(String(text).toLowerCase()).replace(/[’']/g, ' ').replace(/(\d)[\s,](?=\d{3}\b)/g, '$1').replace(/[^a-z0-9.%>< ]+/g, ' ').split(/\s+/).filter(Boolean);
    return raw.map((w) => { const s = stem(w); return SYN[w] || SYN[s] || s; });
  }
  const sig = (toks) => toks.filter((t) => !STOP.has(t) && !/^\d+$/.test(t));

  const OPS = {
    avg: ['average', 'avg', 'mean', 'moyenne', 'moyen'],
    count: ['many', 'count', 'number', 'nombre', 'combien', 'nb'],
    sum: ['total', 'sum', 'somme', 'much'],
    max: ['most', 'highest', 'top', 'biggest', 'largest', 'max', 'maximum', 'best', 'greatest', 'plu', 'meilleur', 'first'],
    min: ['least', 'lowest', 'smallest', 'min', 'minimum', 'fewest', 'worst', 'moin', 'last']
  };
  const GROUP_TRIGGERS = new Set(['by', 'per', 'par', 'each', 'chaque', 'which', 'what', 'quel', 'quelle', 'quels', 'quelles', 'who', 'qui', 'every']);
  const CMP = [
    { re: /\b(?:at least|au moins|minimum)\s+(-?\d+(?:\.\d+)?)(k?)/, op: '>=' },
    { re: /\b(?:at most|au plus|maximum)\s+(-?\d+(?:\.\d+)?)(k?)/, op: '<=' },
    { re: /(?:\bover|\babove|\bmore than|\bgreater than|\bplus de|\bplus que|\bsuperieure? a|\bau dessus de|>)\s*(-?\d+(?:\.\d+)?)(k?)/, op: '>' },
    { re: /(?:\bunder|\bbelow|\bless than|\bfewer than|\bmoins de|\bmoins que|\binferieure? a|\ben dessous de|<)\s*(-?\d+(?:\.\d+)?)(k?)/, op: '<' }
  ];

  function colTokens(col) { if (!col._t) col._t = sig(tokens(col.name)); return col._t; }

  /* ---------- 1. understanding the question ---------- */
  function interpret(question, tables) {
    const qNorm = deaccent(question.toLowerCase()).replace(/[’']/g, ' ').replace(/(\d)[\s,](?=\d{3}\b)/g, '$1');
    const qt = tokens(question);
    const frScore = deaccent(question.toLowerCase()).split(/[^a-z]+/).filter((w) => FR_HINT.has(w)).length;
    const lang = frScore >= 2 || /^(quel|quelle|combien|qui|total des|moyenne)/.test(qNorm.trim()) ? 'fr' : 'en';

    // comparisons first, so "plus de 10" is not read as "most"
    const cmps = [];
    let qForOps = qNorm;
    CMP.forEach((c) => { const m = qForOps.match(c.re); if (m) { cmps.push({ op: c.op, value: parseFloat(m[1]) * (m[2] ? 1000 : 1), at: m.index }); qForOps = qForOps.replace(m[0], ' '); } });
    const opToks = tokens(qForOps);
    const has = (list) => list.some((w) => opToks.includes(w));
    const howMany = /how many|number of|nombre de|combien de/.test(qNorm);

    let best = null;
    tables.forEach((t) => {
      const used = new Set();
      const full = [], partial = [];
      t.cols.forEach((col) => {
        const ct = colTokens(col); if (!ct.length) return;
        const pos = ct.map((w) => qt.indexOf(w));
        const hit = pos.filter((p) => p >= 0).length;
        if (hit === ct.length) full.push({ col, pos: Math.min(...pos), n: ct.length });
        else if (hit) partial.push({ col, pos: Math.min(...pos.filter((p) => p >= 0)), frac: hit / ct.length });
      });
      // longer names win when they overlap ("Total payout" over "Sales" for "total payout")
      full.sort((a, b) => b.n - a.n);
      const fullKept = [];
      full.forEach((m) => { const ct = colTokens(m.col); if (ct.every((w) => used.has(w))) return; ct.forEach((w) => used.add(w)); fullKept.push(m); });

      // value filters on low-cardinality text columns
      const filters = [];
      t.cols.filter((c) => c.type === 'text' && c.unique <= 40).forEach((col) => {
        const vals = [...new Set(t.rows.map((r) => r[col.name]).filter((v) => typeof v === 'string' && v.trim()))];
        vals.forEach((v) => {
          const vt = tokens(v).filter((w) => !STOP.has(w));
          if (!vt.length || vt.some((w) => used.has(w))) return;
          let ok = vt.every((w) => qt.includes(w));
          if (!ok && vt.length === 1 && vt[0] === 'east') { const i = qt.indexOf('est'); ok = i > 0 && /^(region|zone|l)$/.test(qt[i - 1] || '') || (i >= 0 && i === qt.length - 1); }
          if (ok) { vt.forEach((w) => used.add(w)); filters.push({ col: col.name, op: '=', value: v, pos: qt.indexOf(vt[0]) }); }
        });
      });
      const score = fullKept.length * 3 + filters.length * 2 + partial.filter((p) => !colTokens(p.col).some((w) => used.has(w))).length;
      if (!best || score > best.score || (score === best.score && t.rows.length > best.t.rows.length)) best = { t, score, full: fullKept, partial, filters, used };
    });
    if (!best || best.score === 0) return { ok: false, lang, reason: 'nomatch' };
    const t = best.t;
    const colBy = (name) => t.cols.find((c) => c.name === name);

    // group by: a column right after a trigger word
    let groupBy = null;
    for (let i = 0; i < qt.length && !groupBy; i++) {
      if (!GROUP_TRIGGERS.has(qt[i])) continue;
      for (let j = i + 1; j <= i + 3 && j < qt.length; j++) {
        if (STOP.has(qt[j])) continue;
        const m = best.full.find((x) => colTokens(x.col).includes(qt[j]) && x.col.type !== 'number');
        if (m) { groupBy = { col: m.col.name, month: m.col.type === 'date' }; break; }
        if (qt[j] === 'month') { const d = t.cols.find((c) => c.type === 'date'); if (d) { groupBy = { col: d.name, month: true }; break; } }
        if ((qt[i] === 'who' || qt[i] === 'qui')) break;
      }
      if (!groupBy && (qt[i] === 'who' || qt[i] === 'qui')) {
        const person = t.cols.find((c) => c.type === 'text' && /rep|name|nom|employee|client|customer|person|owner|seller/i.test(c.name)) || t.cols.find((c) => c.type === 'text' && c.unique > 1 && c.unique < t.rows.length);
        if (person) groupBy = { col: person.name, month: false };
      }
    }

    // measure: a fully named number column (not used by the grouping)
    const nums = best.full.filter((x) => x.col.type === 'number');
    // comparisons bind to the number column mentioned nearest to them
    const filters = best.filters.map(({ col, op, value }) => ({ col, op, value }));
    const cmpCols = new Set();
    cmps.forEach((c) => {
      const charPos = c.at / Math.max(1, qNorm.length) * qt.length;
      const pick = nums.slice().sort((a, b) => Math.abs(a.pos - charPos) - Math.abs(b.pos - charPos))[0];
      if (pick) { filters.push({ col: pick.col.name, op: c.op, value: c.value }); cmpCols.add(pick.col.name); }
    });
    let measure = (nums.find((x) => !cmpCols.has(x.col.name)) || {}).col;
    let agg = has(OPS.avg) ? 'avg' : howMany ? 'count' : has(OPS.count) ? (measure ? 'sum' : 'count') : has(OPS.sum) ? 'sum' : null;
    let rank = has(OPS.max) ? 'desc' : has(OPS.min) ? 'asc' : null;
    if (!measure && (agg === 'sum' || agg === 'avg' || (rank && !groupBy))) {
      const p = best.partial.filter((x) => x.col.type === 'number' && !colTokens(x.col).some((w) => best.used.has(w) && !x.col.name)).sort((a, b) => b.frac - a.frac)[0];
      if (p && !(agg === null && filters.length && groupBy)) measure = p.col;
    }
    if (!measure && cmpCols.size && (agg === 'sum' || agg === 'avg')) measure = colBy([...cmpCols][0]);
    if (!agg) agg = measure ? (rank && !groupBy ? 'max' : 'sum') : 'count';
    if (agg === 'count') measure = howMany || !measure ? null : measure;
    if (agg === 'count' && measure) agg = 'sum';
    if (!groupBy && rank && measure && agg !== 'avg') agg = rank === 'desc' ? 'max' : 'min';
    if (!groupBy && !filters.length && agg === 'count' && !howMany) return { ok: false, lang, reason: 'vague', table: t.sheet };

    return { ok: true, lang, table: t.sheet, filters, groupBy, measure: measure ? measure.name : null, agg, rank };
  }

  /* ---------- 2. doing the maths ---------- */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function test(v, f) {
    if (f.op === '=') return typeof v === 'string' && v.trim().toLowerCase() === String(f.value).toLowerCase();
    if (typeof v !== 'number') return false;
    return f.op === '>' ? v > f.value : f.op === '<' ? v < f.value : f.op === '>=' ? v >= f.value : v <= f.value;
  }
  function aggregate(rows, measure, agg) {
    if (agg === 'count') return rows.length;
    const vals = rows.map((r) => r[measure]).filter((v) => typeof v === 'number' && isFinite(v));
    if (!vals.length) return 0;
    if (agg === 'sum') return vals.reduce((a, b) => a + b, 0);
    if (agg === 'avg') return vals.reduce((a, b) => a + b, 0) / vals.length;
    if (agg === 'max') return Math.max(...vals);
    return Math.min(...vals);
  }

  function execute(plan, tables) {
    const t = tables.find((x) => x.sheet === plan.table);
    const fr = plan.lang === 'fr';
    const L = (en, frText) => (fr ? frText : en);
    const how = [L(`Used the sheet <b>${esc(t.sheet)}</b> (${t.rows.length} rows).`, `Feuille utilisée : <b>${esc(t.sheet)}</b> (${t.rows.length} lignes).`)];
    let rows = t.rows;
    plan.filters.forEach((f) => {
      rows = rows.filter((r) => test(r[f.col], f));
      how.push(L(`Kept rows where <b>${esc(f.col)}</b> ${f.op === '=' ? 'is' : esc(f.op)} <b>${esc(typeof f.value === 'number' ? fmt(f.value) : f.value)}</b>: ${rows.length} left.`, `Lignes gardées où <b>${esc(f.col)}</b> ${f.op === '=' ? '=' : esc(f.op)} <b>${esc(typeof f.value === 'number' ? fmt(f.value) : f.value)}</b> : il en reste ${rows.length}.`));
    });
    const cond = plan.filters.length ? L(' where ', ' où ') + plan.filters.map((f) => `${esc(f.col)} ${f.op === '=' ? L('is', '=') : esc(f.op)} ${esc(typeof f.value === 'number' ? fmt(f.value) : f.value)}`).join(L(' and ', ' et ')) : '';
    const noun = /^[A-Za-z]+s$/.test(t.sheet) ? (fr ? L('', 'lignes (' + esc(t.sheet) + ')') : esc(t.sheet.toLowerCase())) : L('rows', 'lignes');
    const aggLabel = (a, m) => a === 'sum' && /^(total|sum|somme)\b/i.test(m || '') ? esc(m) : a === 'count' ? L('number of ' + noun, 'nombre de ' + noun) : (fr ? { sum: 'total', avg: 'moyenne', max: 'maximum', min: 'minimum' }[a] + ' ' + esc(m) : { sum: 'total', avg: 'average', max: 'highest', min: 'lowest' }[a] + ' ' + esc(m));
    const res = { plan, how, lang: plan.lang };

    if (!plan.groupBy) {
      const v = aggregate(rows, plan.measure, plan.agg);
      if (plan.agg === 'count') {
        how.push(L('Counted the rows.', 'Lignes comptées.'));
        res.answer = L(`<b>${fmt(v)}</b> ${noun}${cond}.`, `<b>${fmt(v)}</b> ${noun}${cond}.`);
        res.rows = rows.slice(0, 50); res.cols = t.cols.map((c) => c.name);
      } else {
        how.push(L(`Calculated the ${{ sum: 'sum', avg: 'average', max: 'maximum', min: 'minimum' }[plan.agg]} of <b>${esc(plan.measure)}</b> over ${rows.length} rows.`, `Calcul ${{ sum: 'de la somme', avg: 'de la moyenne', max: 'du maximum', min: 'du minimum' }[plan.agg]} de <b>${esc(plan.measure)}</b> sur ${rows.length} lignes.`));
        let extra = '';
        if (plan.agg === 'max' || plan.agg === 'min') {
          const hit = rows.find((r) => r[plan.measure] === v);
          const labelCols = t.cols.filter((c) => c.type === 'text').slice(0, 3);
          if (hit && labelCols.length) extra = ' (' + labelCols.map((c) => esc(hit[c.name])).filter(Boolean).join(', ') + ')';
          res.rows = hit ? [hit] : []; res.cols = t.cols.map((c) => c.name);
        }
        res.answer = L(`The ${aggLabel(plan.agg, plan.measure)}${cond} is <b>${fmt(v)}</b>${extra}.`, `${cap(aggLabel(plan.agg, plan.measure))}${cond} : <b>${fmt(v)}</b>${extra}.`);
      }
      return res;
    }

    // grouped
    const g = plan.groupBy;
    const groups = new Map();
    rows.forEach((r) => {
      let k = r[g.col];
      if (g.month) { if (!(k instanceof Date)) return; k = k.getFullYear() * 100 + k.getMonth(); }
      if (k === null || k === undefined || k === '') return;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
    let list = [...groups.entries()].map(([k, rs]) => ({ key: g.month ? (fr ? MONTHS_FR : MONTHS)[k % 100] + ' ' + Math.floor(k / 100) : String(k), sortKey: k, value: aggregate(rs, plan.measure, plan.agg), n: rs.length }));
    how.push(L(`Grouped by <b>${esc(g.col)}</b>${g.month ? ' (per month)' : ''}: ${list.length} groups.`, `Regroupement par <b>${esc(g.col)}</b>${g.month ? ' (par mois)' : ''} : ${list.length} groupes.`));
    how.push(plan.agg === 'count' ? L('Counted the rows in each group.', 'Lignes comptées dans chaque groupe.') : L(`Calculated the ${{ sum: 'sum', avg: 'average', max: 'maximum', min: 'minimum' }[plan.agg]} of <b>${esc(plan.measure)}</b> in each group.`, `Calcul ${{ sum: 'de la somme', avg: 'de la moyenne', max: 'du maximum', min: 'du minimum' }[plan.agg]} de <b>${esc(plan.measure)}</b> dans chaque groupe.`));
    const chrono = g.month || /^(month|mois)$/i.test(g.col);
    if (plan.rank || !chrono) { list.sort((a, b) => (plan.rank === 'asc' ? a.value - b.value : b.value - a.value)); how.push(plan.rank === 'asc' ? L('Sorted from lowest to highest.', 'Tri du plus petit au plus grand.') : L('Sorted from highest to lowest.', 'Tri du plus grand au plus petit.')); }
    else if (g.month) list.sort((a, b) => a.sortKey - b.sortKey);
    res.groups = list; res.groupCol = g.col; res.valueLabel = aggLabel(plan.agg, plan.measure);
    if (!list.length) { res.answer = L('No rows match this question.', 'Aucune ligne ne correspond à cette question.'); return res; }
    const top = list[0];
    const tie = list.length > 1 && list[1].value === top.value;
    const valTxt = (x) => plan.agg === 'count' ? `<b>${fmt(x.value)}</b> ${noun}` : `${plan.agg === 'sum' || plan.agg === 'avg' ? L(plan.agg === 'avg' ? 'an ' : 'a ', fr && plan.agg === 'avg' ? 'une ' : 'un ') : ''}${aggLabel(plan.agg, plan.measure)} ${L('of', 'de')} <b>${fmt(x.value)}</b>`;
    if (plan.rank) {
      const word = plan.rank === 'asc' ? L('comes last', 'arrive en dernier') : L('comes first', 'arrive en tête');
      res.answer = `<b>${esc(top.key)}</b> ${word}${tie ? L(' (tied)', ' (ex æquo)') : ''}, ${L('with', 'avec')} ${valTxt(top)}${cond}.`;
    } else {
      const hi = list.slice().sort((a, b) => b.value - a.value);
      res.answer = L(`${cap(res.valueLabel)} by ${esc(g.col)}${cond}: <b>${esc(hi[0].key)}</b> is highest (${fmt(hi[0].value)})`, `${cap(res.valueLabel)} par ${esc(g.col)}${cond} : <b>${esc(hi[0].key)}</b> est le plus élevé (${fmt(hi[0].value)})`) + (hi.length > 1 ? L(`, ${esc(hi[hi.length - 1].key)} lowest (${fmt(hi[hi.length - 1].value)}).`, `, ${esc(hi[hi.length - 1].key)} le plus bas (${fmt(hi[hi.length - 1].value)}).`) : '.');
    }
    return res;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function answer(question, tables) {
    if (!question.trim()) return { ok: false, lang: 'en', reason: 'empty' };
    const plan = interpret(question, tables);
    if (!plan.ok) return plan;
    const r = execute(plan, tables);
    r.ok = true;
    return r;
  }

  /* Suggested questions that actually work on this file. */
  function suggestions(tables) {
    const out = [];
    const known = ['Which client paid late most?', 'Quel client a le plus de retards ?', 'Total sales by region', 'Average commission per rep', 'Combien de factures en retard ?', 'Who earned the highest total payout?', 'Ventes par mois'];
    tables.filter((t) => !t.hidden).forEach((t) => {
      const text = t.cols.filter((c) => c.type === 'text' && c.unique > 1 && c.unique <= 12);
      const num = t.cols.filter((c) => c.type === 'number' && !/^(id|n°|no|number|#)$/i.test(c.name));
      if (text[0] && num[0]) out.push(`Total ${num[0].name.toLowerCase()} by ${text[0].name.toLowerCase()}`, `Which ${text[0].name.toLowerCase()} has the highest ${num[num.length > 1 ? 1 : 0].name.toLowerCase()}?`);
      if (text[1]) out.push(`Nombre de lignes par ${text[1].name.toLowerCase()}`);
    });
    const ok = [...known, ...out].filter((q, i, a) => a.indexOf(q) === i).filter((q) => { try { return answer(q, tables).ok; } catch (e) { return false; } });
    return ok.slice(0, 7);
  }

  global.XAsk = { answer, interpret, execute, suggestions, tokens };
})(window);
