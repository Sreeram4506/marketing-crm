/* The co-founder's analysis: business metrics and "what needs a founder's attention" signals,
   computed from the user's own role-filtered view (call shared bind(view) first). Pure rules,
   no AI call, so the signal badge in the app is free and instant. */
const S = require('../shared');

const MONEY_ROLES = ['admin', 'pm', 'finance'];
const sum = (xs, f) => xs.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function clientHealth(v, c, mk) {
  let score = 100;
  const why = [];
  const sentiment = { 'At-Risk': 25, Critical: 45, Neutral: 5 }[c.sentiment] || 0;
  if (sentiment) { score -= sentiment; if (sentiment > 5) why.push(`sentiment ${c.sentiment}`); }
  const b = S.burnRate(c, mk);
  if (b.label === 'Behind') { score -= 10; why.push(`deliverables behind (${b.q.pct}% done, ${b.exp}% expected)`); }
  if (b.label === 'At risk') { score -= 20; why.push(`deliverables well behind (${b.q.pct}% done, ${b.exp}% expected)`); }
  const late = v.tasks.filter((t) => t.clientId === c.id && S.isLate(t)).length;
  if (late) { score -= Math.min(15, late * 4); why.push(`${late} late task${late > 1 ? 's' : ''}`); }
  const fb = (c.feedback || []).slice().sort((x, y) => y.month.localeCompare(x.month));
  if (fb[0] && (fb[0].csat <= 3 || fb[0].nps <= 6)) { score -= 15; why.push(`last review CSAT ${fb[0].csat}/5, NPS ${fb[0].nps}`); }
  if (fb[0] && fb[1] && fb[0].nps < fb[1].nps - 1) { score -= 5; why.push('NPS falling'); }
  const overdue = v.invoices.filter((p) => p.clientId === c.id && p.status === 'Overdue');
  if (overdue.length) { const d = Math.max(...overdue.map((p) => S.daysOverdue(p))); score -= d > 30 ? 15 : 8; why.push(`payment ${d} days overdue`); }
  const revs = v.tasks.filter((t) => t.clientId === c.id && t.revisions > (t.maxRevisions || 2)).length;
  if (revs) { score -= 5; why.push(`${revs} task${revs > 1 ? 's' : ''} over the revision limit`); }
  return { score: Math.max(0, score), why };
}

/* Everything a founder would look at in a weekly review. Sections the role can't see are left out. */
function review(v, user) {
  const mk = S.monthKey(), today = S.todayISO();
  const money = MONEY_ROLES.includes(user.role), owner = user.role === 'admin';
  const live = v.clients.filter((c) => !c.archived && c.status !== 'Churned');
  const active = live.filter((c) => c.status === 'Active');
  const mrr = sum(active, (c) => c.package.monthlyFee);
  const out = { month: mk };

  if (money) {
    const months = [-5, -4, -3, -2, -1, 0].map((n) => S.addMonths(mk, n));
    const trend = months.map((m) => { const inv = v.invoices.filter((p) => p.month === m); return { month: m, invoiced: sum(inv, (p) => p.amountDue), collected: sum(inv, (p) => p.amountPaid) }; });
    const closed = trend.slice(-4, -1);
    const overdue = v.invoices.filter((p) => p.status === 'Overdue');
    out.revenue = {
      monthly_recurring_before_gst: mrr, annual_run_rate: mrr * 12, active_clients: active.length, avg_fee: active.length ? Math.round(mrr / active.length) : 0,
      last_6_months_incl_gst: trend,
      collection_rate_last_3_closed_months_pct: pct(sum(closed, (t) => t.collected), sum(closed, (t) => t.invoiced)),
      outstanding: sum(v.invoices, (p) => S.balance(p)), overdue_total: sum(overdue, (p) => S.balance(p)),
      overdue_by_client: Object.values(overdue.reduce((a, p) => { const n = (v.clients.find((c) => c.id === p.clientId) || {}).company || '?'; a[n] = a[n] || { client: n, amount: 0, max_days: 0 }; a[n].amount += S.balance(p); a[n].max_days = Math.max(a[n].max_days, S.daysOverdue(p)); return a; }, {})).sort((a, b) => b.amount - a.amount),
    };
    const top = active.slice().sort((a, b) => b.package.monthlyFee - a.package.monthlyFee)[0];
    if (top) out.revenue.biggest_client = { client: top.company, share_pct: pct(top.package.monthlyFee, mrr) };
  }

  // Production effort per client over the last 90 days, to see who costs the most to serve
  const since = S.addDays(today, -90);
  const doneRecent = v.tasks.filter((t) => S.DONE_STATUSES.includes(t.status) && (t.completedAt ? new Date(t.completedAt).toISOString().slice(0, 10) >= since : t.dueDate >= since));
  const people = v.users.filter((u) => u.role !== 'client' && u.status !== 'Inactive');
  const payroll = sum(people, (u) => Math.round((Number(u.ctc) || 0) / 12));
  const productionPay = sum(people.filter((u) => ['creative', 'shoot', 'pm'].includes(u.role)), (u) => Math.round((Number(u.ctc) || 0) / 12));

  if (user.role !== 'finance') {
    out.clients = live.map((c) => {
      const h = clientHealth(v, c, mk);
      const effort = doneRecent.filter((t) => t.clientId === c.id).length;
      const row = { client: c.company, status: c.status, health: h.score, concerns: h.why.length ? h.why : undefined, effort_share_pct: pct(effort, doneRecent.length) };
      if (money) { row.fee = c.package.monthlyFee; row.revenue_share_pct = pct(c.package.monthlyFee, mrr); }
      if (owner && productionPay && c.status === 'Active') { row.est_team_cost = Math.round((productionPay * effort) / (doneRecent.length || 1)); row.est_margin_pct = pct(c.package.monthlyFee - row.est_team_cost, c.package.monthlyFee); }
      if (c.package.endDate && c.package.endDate >= today && S.daysBetween(today, c.package.endDate) <= 60) row.contract_ends = c.package.endDate;
      return row;
    }).sort((a, b) => a.health - b.health);
  }

  if (owner && payroll) {
    out.costs = { monthly_payroll: payroll, payroll_pct_of_revenue: pct(payroll, mrr), contribution_before_overheads: mrr - payroll,
      note: 'Team cost per client is estimated from each client\'s share of completed work in the last 90 days (production staff pay only). Overheads such as rent and software are not tracked.' };
  }

  if (['admin', 'pm'].includes(user.role)) {
    const makers = people.filter((u) => ['creative', 'shoot'].includes(u.role));
    const load = makers.map((u) => { const open = v.tasks.filter((t) => t.assigneeId === u.id && !S.DONE_STATUSES.includes(t.status)); return { name: u.name, role: u.designation, open: open.length, late: open.filter((t) => S.isLate(t)).length, done_90d: doneRecent.filter((t) => t.assigneeId === u.id).length }; });
    const avg = load.length ? sum(load, (x) => x.open) / load.length : 0;
    out.team = { people: people.length, makers: load.sort((a, b) => b.open - a.open), avg_open_per_maker: +avg.toFixed(1),
      overloaded: load.filter((x) => x.open > avg * 1.5 || x.late >= 3).map((x) => x.name), has_slack: load.filter((x) => x.open < avg * 0.6).map((x) => x.name) };
  }

  if (user.role !== 'finance') {
    const refs = live.flatMap((c) => (c.referrals || []).filter((r) => r.status === 'Lead').map((r) => ({ name: r.name, referred_by: c.company, since: r.date })));
    out.pipeline = { leads: live.filter((c) => c.status === 'Lead').map((c) => ({ client: c.company, fee: money ? c.package.monthlyFee : undefined })), onboarding: live.filter((c) => c.status === 'Onboarding').map((c) => c.company), open_referrals: refs };
  }
  out.signals = signals(v, user, out);
  return out;
}

/* Short, ranked list of things a co-founder would raise. `r` is a review() result (computed if missing). */
function signals(v, user, r) {
  r = r || review(v, user);
  const money = MONEY_ROLES.includes(user.role), out = [];
  const add = (severity, area, title, detail, ask) => out.push({ id: `${area}:${title}`.toLowerCase().replace(/[^a-z0-9:]+/g, '-').slice(0, 80), severity, area, title, detail, ask });
  if (money && r.revenue) {
    const od = r.revenue.overdue_by_client;
    if (od.length) {
      const worst = od[0];
      add(worst.max_days > 30 ? 'high' : 'medium', 'money', `${S.inrShort(r.revenue.overdue_total)} overdue`, `${od.length} client${od.length > 1 ? 's' : ''}; ${worst.client} owes ${S.inrShort(worst.amount)}, up to ${worst.max_days} days late.`, 'Which overdue payments should we chase first, and how?');
    }
    if (r.revenue.collection_rate_last_3_closed_months_pct && r.revenue.collection_rate_last_3_closed_months_pct < 85) add('medium', 'money', 'Collections slipping', `Only ${r.revenue.collection_rate_last_3_closed_months_pct}% of the last three months' billing has come in.`, 'Why are collections slipping and what should we change?');
    if (r.revenue.biggest_client && r.revenue.biggest_client.share_pct >= 30) add('medium', 'growth', 'Revenue concentration', `${r.revenue.biggest_client.client} is ${r.revenue.biggest_client.share_pct}% of monthly revenue.`, 'How risky is our dependence on our biggest client, and how do we reduce it?');
  }
  for (const c of r.clients || []) {
    if (c.health < 60 && c.status === 'Active') add(c.health < 40 ? 'high' : 'medium', 'clients', `${c.client} at risk`, (c.concerns || []).slice(0, 3).join('; '), `What's going wrong with ${c.client} and how do we save the account?`);
    if (c.contract_ends) add('medium', 'clients', `${c.client} renewal`, `Contract ends ${S.fmtDate(c.contract_ends)}.`, `How should we approach ${c.client}'s renewal? Is there an upsell?`);
    // Under-priced relative to the rest of the book: takes a clearly bigger share of production than of revenue
    if (c.revenue_share_pct !== undefined && c.status === 'Active' && c.effort_share_pct >= 10 && c.effort_share_pct >= c.revenue_share_pct * 1.4) add('medium', 'money', `${c.client} may be under-priced`, `Takes ${c.effort_share_pct}% of production work but brings ${c.revenue_share_pct}% of revenue.`, `Is ${c.client} worth what it costs us to serve? Should we reprice?`);
  }
  if (r.costs && r.costs.payroll_pct_of_revenue > 65) add('high', 'money', 'Payroll heavy', `Salaries are ${r.costs.payroll_pct_of_revenue}% of monthly revenue.`, 'Payroll is a big share of revenue — what are our options?');
  if (r.team && r.team.overloaded.length) add('medium', 'team', 'Team overloaded', `${r.team.overloaded.join(', ')} carr${r.team.overloaded.length > 1 ? 'y' : 'ies'} far more open work than the rest.`, 'Who is overloaded and how should we rebalance the work?');
  if (['admin', 'pm'].includes(user.role)) {
    const pend = v.leaves.filter((l) => l.status === 'Pending' && l.userId !== user.id).length;
    if (pend) add('low', 'team', `${pend} leave request${pend > 1 ? 's' : ''} waiting`, 'Pending your decision.', 'Show me the pending leave requests.');
  }
  if (r.pipeline && (r.pipeline.leads.length || r.pipeline.open_referrals.length)) {
    const n = r.pipeline.leads.length + r.pipeline.open_referrals.length;
    add('low', 'growth', `${n} open lead${n > 1 ? 's' : ''}`, [...r.pipeline.leads.map((l) => l.client), ...r.pipeline.open_referrals.map((x) => `${x.name} (referral)`)].slice(0, 4).join(', '), 'What should we do this week to close our open leads?');
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 8);
}

module.exports = { review, signals, clientHealth };
