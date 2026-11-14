/* Process to App: turns a plain-language process description (English or French) into steps, roles and fields.
   understand(text) -> design. Everything downstream (diagram, data model, prototype, spec) only reads the design,
   so a smarter reader (for example an AI model) could later replace understand() without touching the rest. */
(function (global) {
  'use strict';

  const ROLES = [
    { key: 'ceo', re: /\b(ceo|general manager|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|dg)\b/i },
    { key: 'cfo', re: /\b(cfo|daf|directeur financier|directrice financi[eè]re|finance director)\b/i },
    { key: 'director', re: /\b(director|head of department|department head|directeur|directrice|direction)\b/i },
    { key: 'manager', re: /\b(line manager|manager|supervisor|team lead|responsable|chef d['’][ée]quipe|chef de service|sup[ée]rieur|n\+1)\b/i },
    { key: 'hr', re: /\b(human resources|hr|ressources humaines|rh)\b/i },
    { key: 'finance', re: /\b(finance|accounting|accountant|controller|comptabilit[ée]|comptable|contr[ôo]le de gestion)\b/i },
    { key: 'it', re: /\b(IT|IT team|helpdesk|service desk|informatique|DSI|support)\b/ },
    { key: 'purchasing', re: /\b(purchasing|procurement|buyer|achats|acheteur|acheteuse)\b/i },
    { key: 'legal', re: /\b(legal|lawyer|juridique|juriste)\b/i },
    { key: 'security', re: /\b(security|s[ée]curit[ée])\b/i },
    { key: 'employee', re: /\b(new employee|employee|staff member|worker|requester|applicant|salari[ée]e?|employ[ée]e?|collaborat(?:eur|rice)|demandeur|demandeuse|agent)\b/i },
    { key: 'customer', re: /\b(customer|client|cliente)\b/i }
  ];
  const W = (re) => new RegExp(re.source.replace(/\\b/g, '(?:(?<![\\wÀ-ÿ])(?=[\\wÀ-ÿ])|(?<=[\\wÀ-ÿ])(?![\\wÀ-ÿ]))'), re.flags);
  const ROLE_LABEL = { ceo: 'CEO', cfo: 'CFO', director: 'Director', manager: 'Manager', hr: 'HR', finance: 'Finance', it: 'IT', purchasing: 'Purchasing', legal: 'Legal', security: 'Security', employee: 'Employee', customer: 'Customer' };
  const ROLE_LABEL_FR = { ceo: 'DG', cfo: 'DAF', director: 'Directeur', manager: 'Responsable', hr: 'RH', finance: 'Comptabilité', it: 'Informatique', purchasing: 'Achats', legal: 'Juridique', security: 'Sécurité', employee: 'Salarié', customer: 'Client' };

  const TYPES = [
    { type: 'approve', re: /\b(approves?|approved|validates?|validated|signs? off|accepts?|authori[sz]es?|rejects?|approuve|valide|accepte|autorise|refuse|signe)\b|\bapprove\b|\bapprouver\b|\bvalider\b/i },
    { type: 'review', re: /\b(reviews?|checks?|verif(?:y|ies)|controls?|examines?|analy[sz]es?|v[ée]rifie|contr[ôo]le|examine|analyse|[ée]tudie)\b/i },
    { type: 'notify', re: /\b(is|are|gets?|est|sont)\s+(notified|informed|told|alerted|notifi[ée]e?s?|inform[ée]e?s?|pr[ée]venue?s?|avertie?s?)\b|\b(receives? (?:an? )?(?:email|notification|message)|re[çc]oit (?:un )?(?:mail|e-mail|message|notification))\b/i },
    { type: 'submit', re: /\b(submits?|requests?|asks? for|fills?(?: in| out)?|creates?|enters?|declares?|sends?|uploads?|soumet|demande|saisit|remplit|cr[ée]e|d[ée]clare|envoie|d[ée]pose)\b/i },
    { type: 'do', re: /\b(updates?|pays?|orders?|records?|prepares?|archives?|books?|creates? the account|sets? up|installs?|delivers?|reimburses?|refunds?|processes?|met [àa] jour|paie|paye|commande|enregistre|pr[ée]pare|archive|r[ée]serve|installe|livre|rembourse|traite|cr[ée]e le compte)\b/i }
  ];

  const FIELDS = [
    { re: /(start and end dates?|start date|end date|dates? de d[ée]but et de fin|date de d[ée]but|date de fin|\bdates\b|from .{1,20} to )/i, add: [['Start date', 'date'], ['End date', 'date']] },
    { re: /\bdates?\b|\bjour de\b/i, add: [['Date', 'date']] },
    { re: /\b(reason|motif|raison)\b/i, add: [['Reason', 'text']] },
    { re: /\b(justification|business case)\b/i, add: [['Justification', 'text']] },
    { re: /(amount|montant|\bcost\b|co[ûu]t|price|prix|budget|€|\btnd\b|\bdt\b|\$|\beur\b)/i, add: [['Amount', 'money']] },
    { re: /\b(receipts?|justificatifs?|attachments?|pi[èe]ces? jointes?|scan|invoice|facture)\b/i, add: [['Attachment', 'file']] },
    { re: /\b(suppliers?|fournisseurs?|vendors?)\b/i, add: [['Supplier', 'text']] },
    { re: /\b(quantity|quantit[ée]|qty)\b/i, add: [['Quantity', 'number']] },
    { re: /\b(items?|articles?|products?|produits?|equipment|mat[ée]riel)\b/i, add: [['Item', 'text']] },
    { re: /\b(applications?|software|logiciels?|outils?|system)\b/i, add: [['Application', 'text']] },
    { re: /\b(descriptions?|details|d[ée]tails)\b/i, add: [['Description', 'text']] },
    { re: /\b(projects?|projets?|cost cent(?:er|re))\b/i, add: [['Project', 'text']] },
    { re: /\b(type of leave|leave type|type de cong[ée])\b/i, add: [['Leave type', 'choice']] },
    { re: /\b(destination|trip|voyage|d[ée]placement)\b/i, add: [['Destination', 'text']] }
  ];

  ROLES.forEach((r) => { r.re = W(r.re); }); TYPES.forEach((t) => { t.re = W(t.re); }); FIELDS.forEach((f) => { f.re = W(f.re); });
  const isFrench = (t) => (t.toLowerCase().match(/\b(le|la|les|du|des|et|puis|doit|si|une|est|pour|avec)\b/g) || []).length >= 4;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function parseCondition(c) {
    const m = c.match(/(?:more than|over|above|greater than|exceeds?|exceeding|at least|plus de|au[- ]del[àa] de|sup[ée]rieure? [àa]|d[ée]passe|exc[èe]de|au moins)\s*([\d][\d\s.,]*)\s*(k\b)?\s*(€|eur(?:os?)?|tnd|dt|dinars?|\$|usd|days?|jours?|nights?|nuits?|hours?|heures?)?/i);
    if (!m) return null;
    let value = parseFloat(m[1].replace(/[\s,](?=\d{3}\b)/g, '').replace(',', '.')) * (m[2] ? 1000 : 1);
    const unit = (m[3] || '').toLowerCase();
    const days = /^(day|jour|night|nuit)/.test(unit) || (!unit && /\b(days?|jours?|leave|cong[ée])\b/i.test(c));
    const op = /at least|au moins/i.test(m[0]) ? '>=' : '>';
    return { field: days ? 'Number of days' : 'Amount', op, value, text: c.trim().replace(/[,.]$/, '') };
  }

  function understand(raw) {
    let text = String(raw || '').replace(/\s+/g, ' ').trim().replace(/(\d)[,\s\u202f](?=\d{3}\b)/g, '$1');
    const fr = isFrench(text);
    let title = '';
    const colon = text.match(/^([^:.]{2,50})\s?:\s*(.+)$/);
    if (colon) { title = colon[1].trim(); text = colon[2]; }
    const clauses = text
      .split(/(?<=[.;!?])\s+|\s*;\s*|\s*(?:->|→|=>)\s*|(?:,\s*|\s+and\s+|\s+et\s+)(?:then|puis|ensuite|after that|afterwards|finally|enfin)\s+/i)
      .flatMap((c) => c.split(/,?\s+(?:and|et)\s+(?=(?:the|le|la|les|l['’])\s?[\w-]+\s+(?:is|are|gets|est|sont|re[çc]oit|receives)\b)/i))
      .flatMap((c) => c.split(/,\s+(?=(?:the|le|la|l['’])\s?[\w-]+\s+(?:then\s+)?(?:approves|validates|checks|reviews|valide|approuve|v[ée]rifie)\b)/i))
      .map((c) => c.trim().replace(/[.;]+$/, ''))
      .filter(Boolean);

    const steps = [];
    const labels = {};
    let lastRole = null;
    clauses.forEach((c0) => {
      let c = c0;
      // rejection rule attached to the previous approval
      if (/^(s['’]il|si (?:il|elle) |if (?:he|she|they|it) |if rejected|if not approved|en cas de refus|when rejected|in case of rejection)/i.test(c) && /(refus|reject|not approved|declin)/i.test(c)) {
        const prev = [...steps].reverse().find((s) => s.type === 'approve');
        if (prev) prev.onReject = /(back|return|renvoy|retourn|correct|modif|amend|resubmit)/i.test(c) ? 'return' : 'reject';
        return;
      }
      // shorthand: "employee, manager, HR approves"
      const found = [];
      ROLES.forEach((r) => { const re = new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g'); let m; while ((m = re.exec(c))) found.push({ key: r.key, index: m.index, word: m[0] }); });
      found.sort((a, b) => a.index - b.index);
      const uniq = found.filter((f, i) => found.findIndex((g) => g.key === f.key) === i);
      if (uniq.length >= 3 && /,/.test(c)) {
        let rest = c; uniq.forEach((f) => { rest = rest.replace(f.word, ' '); });
        if (rest.replace(/[,\s]+|\b(and|et|then|puis|the|le|la)\b/gi, ' ').trim().split(/\s+/).filter(Boolean).length <= 2) {
          uniq.forEach((f, i) => {
            if (!labels[f.key]) labels[f.key] = (fr ? ROLE_LABEL_FR : ROLE_LABEL)[f.key] || cap(f.word);
            const type = i === 0 ? 'submit' : 'approve';
            steps.push({ roleKey: f.key, action: type === 'submit' ? (fr ? 'Soumet la demande' : 'Submits the request') : (fr ? 'Approuve ou refuse' : 'Approves or rejects'), type, cond: null, onReject: type === 'approve' ? 'reject' : null });
          });
          lastRole = uniq[uniq.length - 1].key;
          return;
        }
      }
      // condition
      let cond = null;
      const cm = c.match(/(?:^|,?\s)(?:if|when|only if|si|s['’]il|lorsque|quand|dans le cas o[ùu]|for amounts?|pour les? montants?)\b([^,]*?)(?:,|$)/i) || c.match(/(?:,?\s)((?:above|over|more than|plus de|au[- ]del[àa] de|sup[ée]rieure? [àa])\s+[\d][^,]*)(?:,|$)/i);
      if (cm) { cond = parseCondition(cm[0]); if (cond) c = c.replace(cm[0], ' ').trim(); }
      // role: the earliest role word in the clause
      let best = null;
      ROLES.forEach((r) => { const m = c.match(r.re); if (m && (!best || m.index < best.index)) best = { key: r.key, index: m.index, word: m[0] }; });
      // passive voice: "is approved by the manager" -> manager, already caught; "approved by X" with unknown X
      if (!best) { const by = c.match(/\b(?:by|par)\s+(?:the |le |la |l['’])?([A-Za-zÀ-ÿ][\w-]+(?:\s[A-Z][\w-]+)?)/); if (by) best = { key: by[1].toLowerCase(), index: by.index, word: by[1] }; }
      if (!best) { const subj = c.match(/^(?:the |a |an |le |la |l['’]|un |une )?([A-Z][\w-]+(?: [A-Z][\w-]+)?)\s+(?:must |should |then |doit |va )?[a-zàâçéèêëîïôûù]+/); if (subj && !/^(If|When|Si|Then|Puis|And|Et|The|Le|La)$/.test(subj[1])) best = { key: subj[1].toLowerCase(), index: 0, word: subj[1] }; }
      let type = null;
      for (const t of TYPES) if (t.re.test(c)) { type = t.type; break; }
      if (!type && !best) return;
      if (!type) type = steps.length ? 'do' : 'submit';
      if (type === 'submit' && steps.length) type = 'do';
      const key = best ? best.key : lastRole;
      if (!key) return;
      if (!labels[key]) labels[key] = best && !ROLE_LABEL[best.key] ? cap(best.word) : (fr ? ROLE_LABEL_FR[key] : ROLE_LABEL[key]) || cap(key);
      lastRole = key;
      // action label: clause without the role words, articles, modal verbs and condition
      let action = c;
      if (best) action = action.replace(best.word, ' ');
      action = action.replace(/^\W*(?:then|puis|ensuite|and|et|also|aussi|finally|enfin)\b/i, ' ')
        .replace(/\b(?:the|a|an|his|her|their|le|la|les|l['’]|son|sa|ses|leur|un|une|new|nouveau|nouvelle)\b\s*/gi, (m, i) => (i < 4 ? '' : m))
        .replace(/^\s*(?:must|should|needs to|has to|will|then|doit|devra|va|aussi|also|then)\b\s*/gi, '')
        .replace(/\b(?:must|should|doit|devra)\s+(?:also\s+|aussi\s+)?/gi, '')
        .replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').replace(/^(?:also|aussi|then|puis)\s+/i, '').replace(/\s+(?:then|puis|ensuite)\s+/i, ' ');
      if (type === 'notify') action = fr ? 'Est notifié' : 'Gets notified';
      if (!action || action.length < 3) action = { submit: fr ? 'Soumet la demande' : 'Submits the request', approve: fr ? 'Approuve ou refuse' : 'Approves or rejects', review: fr ? 'Vérifie' : 'Reviews', do: fr ? 'Traite' : 'Processes', notify: fr ? 'Est notifié' : 'Gets notified' }[type];
      if (/^approve$/i.test(action)) action = 'Also approves';
      if (/^approuver$/i.test(action)) action = 'Approuve aussi';
      if (action.length > 70) action = action.slice(0, 67).replace(/\s+\S*$/, '') + '…';
      steps.push({ roleKey: key, action: cap(action), type, cond, onReject: type === 'approve' ? (/(back|return|renvoy|retourn|correct)/i.test(c) ? 'return' : 'reject') : null });
    });
    if (steps.length && steps[0].type !== 'submit') steps.unshift({ roleKey: steps[0].type === 'approve' ? 'employee' : steps[0].roleKey, action: fr ? 'Soumet la demande' : 'Submits the request', type: 'submit', cond: null, onReject: null });
    if (steps.length && !labels[steps[0].roleKey]) labels[steps[0].roleKey] = (fr ? ROLE_LABEL_FR : ROLE_LABEL)[steps[0].roleKey] || cap(steps[0].roleKey);

    // fields
    const fields = [];
    const addF = (name, type, calc) => { if (!fields.some((f) => f.name === name)) fields.push({ name, type, calc: calc || null }); };
    const all = (title + ' ' + text);
    let hasDates = false;
    FIELDS.forEach((f, i) => { if (i === 1 && hasDates) return; if (f.re.test(all)) { f.add.forEach(([n, t]) => addF(n, t)); if (i === 0) hasDates = true; } });
    steps.forEach((s) => { if (!s.cond) return; if (s.cond.field === 'Number of days') { if (!hasDates) { addF('Start date', 'date'); addF('End date', 'date'); hasDates = true; } addF('Number of days', 'number', 'days'); } else addF('Amount', 'money'); });
    if (!hasDates && /\b(leave|cong[ée]s?|absence|holiday|vacation)\b/i.test(all)) { addF('Start date', 'date'); addF('End date', 'date'); hasDates = true; }
    if (hasDates && /\b(leave|cong[ée]|absence|holiday|vacation|days|jours)\b/i.test(all)) addF('Number of days', 'number', 'days');
    if (!fields.length) addF(fr ? 'Description' : 'Description', 'text');

    if (!title) title = guessTitle(all, fr);
    const roles = [];
    steps.forEach((s) => { if (!roles.some((r) => r.key === s.roleKey)) roles.push({ key: s.roleKey, label: labels[s.roleKey] || cap(s.roleKey) }); });
    return { title: cap(title), fr, steps, fields, roles };
  }

  function guessTitle(t, fr) {
    const m = t.match(/\b(leave|holiday|expense|purchase|travel|access|equipment|training|overtime|invoice|cong[ée]s?|note de frais|achat|d[ée]placement|acc[èe]s|mat[ée]riel|formation|facture)\b/i);
    if (!m) return fr ? 'Demande' : 'Request';
    const w = m[1].toLowerCase();
    const fixed = { 'note de frais': 'Note de frais', facture: 'Validation de facture', invoice: 'Invoice approval' };
    if (fixed[w]) return fixed[w];
    return fr ? 'Demande de ' + w : w + ' request';
  }

  global.ProcessReader = { understand, parseCondition, ROLE_LABEL };
})(window);
