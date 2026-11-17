// Made-up sample portfolio for "Orbis Studio", a fictional company. Dates are placed around today,
// so the demo always shows a realistic mix: on track, at risk, late, delivered and not started.
import { addDays } from './engine.js';

export function seed(today) {
  const d = n => addDays(today, n);
  const projects = [
    { id: 'p-atlas', name: 'Atlas', code: 'ATL', objective: 'Relaunch the customer portal so clients can self-serve invoices and requests.', description: 'New portal on the current customer accounts. Replaces three legacy screens.', owner: 'Lina Haddad', start: d(-70), deadline: d(35), status: 'Active', priority: 'Critical' },
    { id: 'p-beacon', name: 'Beacon', code: 'BCN', objective: 'Make the mobile app meet the accessibility standard (WCAG 2.2 AA).', description: 'Audit, fixes, and an accessibility check on every release.', owner: 'Marc Olsen', start: d(-40), deadline: d(60), status: 'Active', priority: 'High' },
    { id: 'p-cobalt', name: 'Cobalt', code: 'CBT', objective: 'Move reporting from the old warehouse to the new data platform.', description: 'Twelve reports, two data feeds, one switch-over weekend.', owner: 'Priya Nair', start: d(-55), deadline: d(25), status: 'Active', priority: 'High' },
    { id: 'p-delta', name: 'Delta', code: 'DLT', objective: 'Automate new-client onboarding from contract to first login.', description: 'Delivered. Kept for the record and for reporting.', owner: 'Tomás Ruiz', start: d(-120), deadline: d(-20), status: 'Completed', priority: 'Medium' },
    { id: 'p-ember', name: 'Ember', code: 'EMB', objective: 'Test a clearer pricing page with two variants.', description: 'Starts after Atlas goes live.', owner: 'Sofia Klein', start: d(20), deadline: d(80), status: 'Planned', priority: 'Low' },
    { id: 'p-fjord', name: 'Fjord', code: 'FJD', objective: 'Close the findings of the yearly security audit.', description: 'Nine findings, two rated high.', owner: 'Jonas Berg', start: d(-60), deadline: d(-4), status: 'Active', priority: 'Critical' },
  ];
  const milestones = [
    { id: 'm-a1', projectId: 'p-atlas', name: 'Design signed off', target: d(-45), done: true },
    { id: 'm-a2', projectId: 'p-atlas', name: 'Invoices module ready', target: d(-6), done: false },
    { id: 'm-a3', projectId: 'p-atlas', name: 'Pilot with 20 clients', target: d(14), done: false },
    { id: 'm-a4', projectId: 'p-atlas', name: 'Go-live', target: d(35), done: false },
    { id: 'm-b1', projectId: 'p-beacon', name: 'Audit report', target: d(-20), done: true },
    { id: 'm-b2', projectId: 'p-beacon', name: 'High-impact fixes released', target: d(10), done: false },
    { id: 'm-b3', projectId: 'p-beacon', name: 'AA conformance check', target: d(55), done: false },
    { id: 'm-c1', projectId: 'p-cobalt', name: 'Data feeds connected', target: d(-15), done: true },
    { id: 'm-c2', projectId: 'p-cobalt', name: 'Reports rebuilt', target: d(8), done: false },
    { id: 'm-c3', projectId: 'p-cobalt', name: 'Switch-over weekend', target: d(24), done: false },
    { id: 'm-d1', projectId: 'p-delta', name: 'Onboarding live', target: d(-22), done: true },
    { id: 'm-e1', projectId: 'p-ember', name: 'Variants designed', target: d(40), done: false },
    { id: 'm-f1', projectId: 'p-fjord', name: 'High findings closed', target: d(-12), done: false },
    { id: 'm-f2', projectId: 'p-fjord', name: 'Audit closure letter', target: d(-4), done: false },
  ];
  const T = (id, projectId, title, owner, priority, status, due, estimate, deps = [], milestoneId = '') => ({ id, projectId, title, owner, priority, status, due: d(due), estimate, deps, milestoneId });
  const tasks = [
    T('t-a1', 'p-atlas', 'Portal design system', 'Lina Haddad', 'High', 'Done', -48, 8, [], 'm-a1'),
    T('t-a2', 'p-atlas', 'Sign-in with existing accounts', 'Marc Olsen', 'Critical', 'Done', -30, 6, ['t-a1']),
    T('t-a3', 'p-atlas', 'Invoice list and download', 'Priya Nair', 'High', 'In review', -5, 7, ['t-a2'], 'm-a2'),
    T('t-a4', 'p-atlas', 'Request form with attachments', 'Lina Haddad', 'Medium', 'To do', 6, 5, ['t-a2']),
    T('t-a5', 'p-atlas', 'Pilot client invitations', 'Sofia Klein', 'Medium', 'To do', 12, 2, ['t-a3', 't-a4'], 'm-a3'),
    T('t-a6', 'p-atlas', 'Load test at 5,000 users', 'Jonas Berg', 'High', 'To do', 22, 4, ['t-a3']),
    T('t-a7', 'p-atlas', 'Go-live checklist and rollback plan', 'Lina Haddad', 'Critical', 'To do', 32, 3, ['t-a5', 't-a6'], 'm-a4'),
    T('t-b1', 'p-beacon', 'Audit all 42 screens', 'Marc Olsen', 'High', 'Done', -22, 6, [], 'm-b1'),
    T('t-b2', 'p-beacon', 'Fix colour contrast', 'Marc Olsen', 'High', 'Done', -6, 3, ['t-b1']),
    T('t-b3', 'p-beacon', 'Screen reader labels', 'Tomás Ruiz', 'High', 'In progress', 7, 5, ['t-b1'], 'm-b2'),
    T('t-b4', 'p-beacon', 'Larger touch targets', 'Tomás Ruiz', 'Medium', 'To do', 9, 3, ['t-b1'], 'm-b2'),
    T('t-b5', 'p-beacon', 'Accessibility check in every release', 'Jonas Berg', 'Medium', 'To do', 40, 4, ['t-b3', 't-b4']),
    T('t-c1', 'p-cobalt', 'Connect sales feed', 'Priya Nair', 'High', 'Done', -18, 4, [], 'm-c1'),
    T('t-c2', 'p-cobalt', 'Connect finance feed', 'Priya Nair', 'High', 'On hold', -10, 5, []),
    T('t-c3', 'p-cobalt', 'Rebuild finance reports (6)', 'Tomás Ruiz', 'High', 'To do', 6, 6, ['t-c2'], 'm-c2'),
    T('t-c4', 'p-cobalt', 'Rebuild sales reports (6)', 'Sofia Klein', 'Medium', 'In progress', 5, 5, ['t-c1'], 'm-c2'),
    T('t-c5', 'p-cobalt', 'Reconcile old and new figures', 'Priya Nair', 'Critical', 'To do', 15, 4, ['t-c3', 't-c4']),
    T('t-c6', 'p-cobalt', 'Switch-over rehearsal', 'Jonas Berg', 'High', 'To do', 20, 2, ['t-c5'], 'm-c3'),
    T('t-d1', 'p-delta', 'Contract to account automation', 'Tomás Ruiz', 'High', 'Done', -40, 8, []),
    T('t-d2', 'p-delta', 'Welcome emails', 'Sofia Klein', 'Medium', 'Done', -30, 3, ['t-d1'], 'm-d1'),
    T('t-e1', 'p-ember', 'Two pricing page variants', 'Sofia Klein', 'Medium', 'Backlog', 38, 5, [], 'm-e1'),
    T('t-e2', 'p-ember', 'Define the success measure', 'Sofia Klein', 'Low', 'Backlog', 30, 1, []),
    T('t-a8', 'p-atlas', 'Help pages for the portal', 'Marc Olsen', 'Low', 'Backlog', 30, 3, []),
    T('t-f1', 'p-fjord', 'Rotate shared admin passwords', 'Jonas Berg', 'Critical', 'Done', -40, 2, []),
    T('t-f2', 'p-fjord', 'Patch outdated web server', 'Jonas Berg', 'Critical', 'In progress', -14, 3, [], 'm-f1'),
    T('t-f3', 'p-fjord', 'Turn on two-step login for staff', 'Marc Olsen', 'High', 'To do', -8, 3, ['t-f1'], 'm-f1'),
    T('t-f4', 'p-fjord', 'Evidence pack for the auditor', 'Jonas Berg', 'Medium', 'To do', -3, 2, ['t-f2', 't-f3'], 'm-f2'),
    T('t-x1', 'p-cobalt', 'Data dictionary for new reports', 'Tomás Ruiz', 'Low', 'To do', 4, 2, []),
    T('t-x2', 'p-beacon', 'Update app store notes', 'Tomás Ruiz', 'Low', 'To do', 3, 1, []),
    T('t-x3', 'p-beacon', 'Review the help screen wording', 'Lina Haddad', 'Medium', 'In progress', 0, 1, []),
    T('t-x4', 'p-beacon', 'Read the accessibility audit summary', 'Lina Haddad', 'Low', 'To do', 0, 1, []),
    T('t-x5', 'p-cobalt', 'Agree the switch-over date with finance', 'Lina Haddad', 'High', 'To do', 2, 1, []),
    T('t-x6', 'p-fjord', 'Send the dated action plan to the auditor', 'Lina Haddad', 'Critical', 'To do', -1, 1, []),
    T('t-x7', 'p-cobalt', 'Write the switch-over notice', 'Lina Haddad', 'Medium', 'To do', 3, 2, []),
    T('t-x8', 'p-beacon', 'Approve the new colour palette', 'Lina Haddad', 'Low', 'Done', 0, 1, []),
  ];
  // keys, labels, board order, on-hold reasons, comments and history (all made up)
  const LABELS = { 't-a3': ['frontend', 'invoices'], 't-a4': ['frontend'], 't-a6': ['performance'], 't-a7': ['release'], 't-b3': ['accessibility'], 't-b4': ['accessibility', 'mobile'], 't-b5': ['accessibility', 'release'], 't-c2': ['data', 'access'], 't-c3': ['data', 'reports'], 't-c4': ['data', 'reports'], 't-c5': ['data'], 't-f2': ['security'], 't-f3': ['security'], 't-f4': ['security', 'audit'], 't-e1': ['experiment'], 't-x1': ['data', 'docs'], 't-a8': ['docs'] };
  const counters = {};
  tasks.forEach((t, i) => {
    const code = projects.find(p => p.id === t.projectId).code;
    counters[code] = (counters[code] || 0) + 1;
    t.key = code + '-' + counters[code];
    t.labels = LABELS[t.id] || [];
    t.rank = i + 1;
    t.comments = []; t.history = [{ at: d(-30) + 'T09:00', by: projects.find(p => p.id === t.projectId).owner, field: 'Created', from: '', to: t.key }];
    t.holdReason = ''; t.heldFrom = '';
  });
  const tk = id => tasks.find(t => t.id === id);
  Object.assign(tk('t-c2'), { holdReason: 'Waiting for finance to grant read access to the feed.', heldFrom: 'In progress' });
  tk('t-c2').history.push({ at: d(-9) + 'T14:20', by: 'Priya Nair', field: 'Status', from: 'In progress', to: 'On hold' });
  tk('t-c2').comments.push({ id: 'c-1', by: 'Priya Nair', at: d(-9) + 'T14:22', text: 'Access request sent to the finance team. No answer yet.' }, { id: 'c-2', by: 'Lina Haddad', at: d(-3) + 'T10:05', text: 'I will raise it at Thursday\'s steering meeting.' });
  tk('t-a3').history.push({ at: d(-2) + 'T16:40', by: 'Priya Nair', field: 'Status', from: 'In progress', to: 'In review' });
  tk('t-a3').comments.push({ id: 'c-3', by: 'Priya Nair', at: d(-2) + 'T16:41', text: 'Ready for review. Download works for PDF; CSV export comes in a second step.' });
  tk('t-f2').comments.push({ id: 'c-4', by: 'Jonas Berg', at: d(-5) + 'T11:30', text: 'The vendor patch needs a restart window. Planned for the weekend.' });
  tk('t-x8').history.push({ at: d(0) + 'T09:40', by: 'Lina Haddad', field: 'Status', from: 'In review', to: 'Done' });
  tk('t-f2').history.push({ at: d(-6) + 'T08:15', by: 'Jonas Berg', field: 'Assignee', from: 'Marc Olsen', to: 'Jonas Berg' });
  tk('t-a7').checklist = [
    { id: 'k-1', text: 'Backup of the old portal taken', done: true },
    { id: 'k-2', text: 'Rollback steps tried on the test copy', done: true },
    { id: 'k-3', text: 'Support team briefed', done: false },
    { id: 'k-4', text: 'Go or no-go call booked', done: false },
  ];
  tk('t-a5').checklist = [
    { id: 'k-5', text: 'Pick 30 pilot clients', done: true },
    { id: 'k-6', text: 'Write the invitation', done: false },
    { id: 'k-7', text: 'Send and track answers', done: false },
  ];
  // one link across projects: the finance data dictionary waits for the invoice screens in the client portal
  tk('t-x1').deps = ['t-a3'];

  const risks = [
    { id: 'r-1', projectId: 'p-atlas', title: 'Invoice data from the old system is incomplete', impact: 4, probability: 4, owner: 'Priya Nair', mitigation: 'Run a data check on 500 sample invoices before the pilot.', status: 'Mitigating' },
    { id: 'r-2', projectId: 'p-atlas', title: 'Pilot clients not available before the holidays', impact: 3, probability: 3, owner: 'Sofia Klein', mitigation: 'Invite 30 clients to keep 20.', status: 'Open' },
    { id: 'r-3', projectId: 'p-cobalt', title: 'Finance feed access still not granted', impact: 5, probability: 3, owner: 'Priya Nair', mitigation: '', status: 'Open' },
    { id: 'r-4', projectId: 'p-cobalt', title: 'Old and new totals differ', impact: 4, probability: 2, owner: 'Tomás Ruiz', mitigation: 'Reconcile line by line for one closed month.', status: 'Open' },
    { id: 'r-5', projectId: 'p-beacon', title: 'Third-party chat widget cannot be made accessible', impact: 3, probability: 2, owner: 'Marc Olsen', mitigation: 'Ask the vendor for their roadmap; plan a fallback contact link.', status: 'Open' },
    { id: 'r-6', projectId: 'p-fjord', title: 'Auditor rejects late evidence', impact: 5, probability: 4, owner: 'Jonas Berg', mitigation: 'Send a dated action plan this week.', status: 'Open' },
    { id: 'r-7', projectId: 'p-ember', title: 'Not enough traffic for a clear result', impact: 2, probability: 3, owner: 'Sofia Klein', mitigation: 'Run for four weeks instead of two.', status: 'Open' },
    { id: 'r-8', projectId: 'p-delta', title: 'Email provider limits', impact: 2, probability: 2, owner: 'Tomás Ruiz', mitigation: 'Raised the sending limit.', status: 'Closed' },
  ];
  const filters = [
    { id: 'f-1', name: 'Security work', query: { label: 'security' } },
    { id: 'f-2', name: 'Critical and high', query: { priority: ['Critical', 'High'] } },
  ];
  return { version: 2, me: 'Lina Haddad', projects, milestones, tasks, risks, filters };
}
