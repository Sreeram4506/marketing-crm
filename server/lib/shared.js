/* Loads the browser's business rules (js/core.js + js/seed.js) into a sandbox so
   the server uses exactly the same logic for invoices, GST, quotas, permissions
   and sample data. Nothing in those files touches the DOM at load time. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const EXPORTS = ['Store', 'Perm', 'DATA_VERSION', 'ROLES', 'generateInvoices', 'refreshPaymentStatuses', 'paymentStatus', 'buildSampleData',
  'remindersDue', 'balance', 'nextDue', 'fnv', 'todayISO', 'fmtDate', 'fmtMonth', 'inr', 'daysBetween', 'uid', 'nextInvoiceNo', 'stateCode', 'statusBlocker', 'reminderMessage',
  'CATEGORIES', 'CLIENT_STATUSES', 'SENTIMENTS', 'PAYMENT_TERMS', 'SHOOT_TYPES', 'SHOOT_LOCATIONS', 'PAYMENT_MODES', 'TASK_TYPES', 'PRIORITIES', 'TASK_STATUSES',
  'BREAK_TYPES', 'LEAVE_TYPES', 'LEAVE_STATUSES', 'EMPLOYEE_STATUSES', 'WORK_ARRANGEMENTS', 'DEPARTMENTS', 'QUOTA_TYPES', 'DONE_STATUSES', 'leaveDays',
  'quotaStatus', 'burnRate', 'expectedPct', 'isLate', 'isAtRisk', 'liveStatus', 'attendanceFor', 'openBreak', 'workedMs', 'leaveBalance', 'dayStatus',
  'newTask', 'taskType', 'planMonthFor', 'missedMilestone', 'daysOverdue', 'monthKey', 'addDays', 'addMonths', 'daysInMonth', 'fmtDateTime', 'inrShort', 'REVIEW_STATUSES', 'ONBOARDING_STEPS', 'payslip'];

function load() {
  const code = ['js/core.js', 'js/seed.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const context = vm.createContext({ console, Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, setTimeout, toast() {} });
  return vm.runInContext(`${code}\n;({ ${EXPORTS.join(', ')} })`, context, { filename: 'shared-core.js' });
}

module.exports = load();
