import Ledger from './ledger.js';

const metrics = [
  { id: 'approved', label: '核定金額' },
  { id: 'paid', label: '已核銷金額' },
  { id: 'pending', label: '期末待核銷金額' },
  { id: 'remaining', label: '剩餘金額' }
];

function values(state, catalog, group, category) {
  const allocated = Ledger.allocated(state.budgets, group, category);
  const start = Ledger.start(catalog, state.startDates, group);
  const eligible = state.records.filter(r => r.group === group && r.category === category &&
    r.date && r.date >= start);
  const paid = eligible.reduce((n, r) => n + Ledger.cents(r.reimbursed), 0);
  return { allocated, paid, pending: allocated - paid };
}

function model(state, catalog, selectedGroups, selectedMetrics) {
  const groups = catalog.groups.filter(g => selectedGroups.includes(g));
  const columns = metrics.filter(m => selectedMetrics.includes(m.id));
  const sum = items => Object.fromEntries(metrics.map(m => [m.id, items.reduce((n, item) => n + item[m.id], 0)]));
  const rows = catalog.categories.map(c => {
    const approvedValue = catalog.categoryApproved?.[String(c.id)];
    if (!Number.isFinite(approvedValue)) throw new Error('尚未匯入完整的全計畫科目核定金額，請重新連線。');
    const byGroup = Object.fromEntries(catalog.groups.map(g => [g, values(state, catalog, g, c.id)]));
    const approved = Ledger.cents(approvedValue);
    const paidRaw = state.records.filter(r => r.category === c.id).reduce((n, r) => n + Ledger.cents(r.reimbursed), 0);
    const paid = paidRaw - (c.id === 9 ? Ledger.cents(catalog.projectTotals?.officeReclassifiedReimbursed || 0) : 0);
    const pending = Object.values(byGroup).reduce((n, v) => n + v.pending, 0);
    return { category: c.id, name: c.name, byGroup, total: { approved, paid, pending, remaining: approved - paid - pending } };
  });
  const totals = {
    byGroup: Object.fromEntries(catalog.groups.map(g => [g, { pending: rows.reduce((n, r) => n + r.byGroup[g].pending, 0) }])),
    total: sum(rows.map(r => r.total))
  };
  return { groups, columns, rows, totals };
}

function csv(result) {
  const escape = value => {
    let text = String(value ?? '');
    if (typeof value !== 'number' && /^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const header = ['費用項目', ...result.groups.map(g => `${g}／期末待核銷`), ...result.columns.map(m => m.label)];
  const line = (name, row) => [name, ...result.groups.map(g => row.byGroup[g].pending / 100), ...result.columns.map(m => row.total[m.id] / 100)];
  return '\uFEFF' + [header, ...result.rows.map(r => line(`${r.category} · ${r.name}`, r)), line('合計', result.totals)].map(row => row.map(escape).join(',')).join('\r\n');
}

export default { metrics, model, values, csv };
