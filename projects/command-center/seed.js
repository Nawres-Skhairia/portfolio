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
    T('t-a3', 'p-atlas', 'Invoice list and download', 'Priya Nair', 'High', 'In progress', -5, 7, ['t-a2'], 'm-a2'),
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
    T('t-c2', 'p-cobalt', 'Connect finance feed', 'Priya Nair', 'High', 'Blocked', -10, 5, []),
    T('t-c3', 'p-cobalt', 'Rebuild finance reports (6)', 'Tomás Ruiz', 'High', 'To do', 6, 6, ['t-c2'], 'm-c2'),
    T('t-c4', 'p-cobalt', 'Rebuild sales reports (6)', 'Sofia Klein', 'Medium', 'In progress', 5, 5, ['t-c1'], 'm-c2'),
    T('t-c5', 'p-cobalt', 'Reconcile old and new figures', 'Priya Nair', 'Critical', 'To do', 15, 4, ['t-c3', 't-c4']),
    T('t-c6', 'p-cobalt', 'Switch-over rehearsal', 'Jonas Berg', 'High', 'To do', 20, 2, ['t-c5'], 'm-c3'),
    T('t-d1', 'p-delta', 'Contract to account automation', 'Tomás Ruiz', 'High', 'Done', -40, 8, []),
    T('t-d2', 'p-delta', 'Welcome emails', 'Sofia Klein', 'Medium', 'Done', -30, 3, ['t-d1'], 'm-d1'),
    T('t-e1', 'p-ember', 'Two pricing page variants', 'Sofia Klein', 'Medium', 'To do', 38, 5, [], 'm-e1'),
    T('t-f1', 'p-fjord', 'Rotate shared admin passwords', 'Jonas Berg', 'Critical', 'Done', -40, 2, []),
    T('t-f2', 'p-fjord', 'Patch outdated web server', 'Jonas Berg', 'Critical', 'In progress', -14, 3, [], 'm-f1'),
    T('t-f3', 'p-fjord', 'Turn on two-step login for staff', 'Marc Olsen', 'High', 'To do', -8, 3, ['t-f1'], 'm-f1'),
    T('t-f4', 'p-fjord', 'Evidence pack for the auditor', 'Jonas Berg', 'Medium', 'To do', -3, 2, ['t-f2', 't-f3'], 'm-f2'),
    T('t-x1', 'p-cobalt', 'Data dictionary for new reports', 'Tomás Ruiz', 'Low', 'To do', 4, 2, []),
    T('t-x2', 'p-beacon', 'Update app store notes', 'Tomás Ruiz', 'Low', 'To do', 3, 1, []),
  ];
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
  return { version: 1, projects, milestones, tasks, risks };
}
