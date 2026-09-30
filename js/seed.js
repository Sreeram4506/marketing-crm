/* ==========================================================================
   seed.js — sample data, dated relative to today so the demo always looks live
   ========================================================================== */

function buildSampleData() {
  let seed = 20260928;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const cur = monthKey(), prev = addMonths(cur, -1), prev2 = addMonths(cur, -2), next = addMonths(cur, 1);
  const today = todayISO();
  const now = Date.now();
  const mkStart = (monthsAgo, day = 1) => addMonths(cur, -monthsAgo) + '-' + pad(day);

  const settings = {
    agencyName: 'BrightPixel Digital', agencyAddress: '4th Floor, Cyber Towers, HITEC City, Hyderabad, Telangana 500081',
    agencyEmail: 'accounts@brightpixel.in', agencyPhone: '+91 98480 00000', gstin: '36ABCDE1234F1Z5', sac: '998361',
    gstRate: 18, bankDetails: 'HDFC Bank · A/c 50200012345678 · IFSC HDFC0001234', upiId: 'brightpixel@hdfcbank',
    invoicePrefix: 'BPD', invoiceSeq: 0, dueDays: 7, billingStartMonth: prev2, maxRevisions: 2,
    workStart: '10:00', workEnd: '19:00', graceMinutes: 15, halfDayHours: 4.5, weekOff: [0], pfEnabled: true,
    captureIp: false, webhookUrl: '', autoWebhook: false, overloadThreshold: 8, attendanceStartDate: addDays(today, -42),
  };

  const U = (id, name, role, designation, department, extra = {}) => ({
    id, name, role, designation, department, email: name.split(' ')[0].toLowerCase() + '@brightpixel.in',
    phone: '98480 ' + String(10000 + Math.floor(rand() * 89999)), workArrangement: 'Full-Time In-Office', status: 'Active',
    joinDate: mkStart(6 + Math.floor(rand() * 30), 1 + Math.floor(rand() * 27)),
    emergencyContact: { name: '', phone: '' }, ctc: 0, bank: { holder: name, account: '', ifsc: '' },
    idProof: { type: 'PAN', number: '', verified: false }, docs: { nda: '', contract: '' },
    leaveQuota: { casual: 12, sick: 8, pto: 12 }, ...extra,
  });
  const users = [
    U('u_admin', 'Priya Sharma', 'admin', 'Founder & CEO', 'Management', { ctc: 2400000, idProof: { type: 'PAN', number: 'ABCPS1234K', verified: true } }),
    U('u_pm1', 'Rahul Verma', 'pm', 'Senior Account Manager', 'Management', { ctc: 960000, idProof: { type: 'Aadhaar', number: 'XXXX XXXX 4821', verified: true }, docs: { nda: 'https://drive.google.com/nda-rahul', contract: 'https://drive.google.com/contract-rahul' } }),
    U('u_pm2', 'Sneha Reddy', 'pm', 'Project Manager', 'Management', { ctc: 840000, workArrangement: 'Hybrid', idProof: { type: 'PAN', number: 'BQRPR5521M', verified: true } }),
    U('u_des1', 'Arjun Nair', 'creative', 'Graphic Designer', 'Design', { ctc: 540000, idProof: { type: 'Aadhaar', number: 'XXXX XXXX 1190', verified: true } }),
    U('u_des2', 'Kavya Iyer', 'creative', 'Senior Designer', 'Design', { ctc: 660000, workArrangement: 'Hybrid', idProof: { type: 'PAN', number: 'CKIPK7781Q', verified: false } }),
    U('u_ed1', 'Imran Shaikh', 'creative', 'Video Editor', 'Video', { ctc: 600000, idProof: { type: 'Aadhaar', number: 'XXXX XXXX 7734', verified: true } }),
    U('u_wr1', 'Neha Gupta', 'creative', 'Content Writer', 'Copy', { ctc: 420000, workArrangement: 'Fully Remote' }),
    U('u_ads1', 'Karthik Subramanian', 'creative', 'Performance Marketer', 'Ads', { ctc: 720000, idProof: { type: 'PAN', number: 'DKSPS3321L', verified: true } }),
    U('u_sh1', 'Aditya Menon', 'shoot', 'Cinematographer', 'Shoot', { ctc: 480000, workArrangement: 'Freelancer / Contractor', idProof: { type: 'Passport', number: 'P1234567', verified: true } }),
    U('u_fin', 'Vikram Rao', 'finance', 'Finance & Operations Lead', 'Accounts', { ctc: 780000, idProof: { type: 'PAN', number: 'EVRPR8890A', verified: true } }),
  ];
  users.forEach((u) => {
    u.emergencyContact = { name: 'Family contact', phone: '9' + String(800000000 + Math.floor(rand() * 199999999)) };
    u.bank.account = u.bank.account || 'XXXXXX' + String(1000 + Math.floor(rand() * 8999));
    u.bank.ifsc = 'HDFC0001234';
  });

  const pkg = (o) => ({ name: 'Growth', monthlyFee: 0, billingCycle: '1', billingDay: 1, paymentTerms: '100% Advance', startDate: '', endDate: '', isActive: true,
    quotas: {}, shootType: 'NONE', shootsPerMonth: 0, shootLocation: 'On-site (client premises)', rawFootageLink: '', metaAdBudget: 0, googleAdBudget: 0, rollover: false, ...o });
  const doneSteps = (n) => ONBOARDING_STEPS.map((_, i) => (i < n ? { done: true, date: mkStart(7, 2 + i * 3) } : { done: false, date: '' }));
  const C = (o) => ({ secondaryContact: { name: '', phone: '', email: '' }, whatsappGroup: '', address: '', gstin: '', services: [], notes: '',
    sentiment: 'Neutral', referredBy: null, referrals: [], feedback: [], assets: { logo: '', guidelines: '', fonts: '' }, archived: false, createdAt: now, ...o });

  const clients = [
    C({ id: 'c_apollo', company: 'Apollo Dental Care', contact: 'Dr. Ramesh Iyer', email: 'ramesh@apollodental.in', phone: '98490 12345', whatsapp: '919849012345',
      secondaryContact: { name: 'Lakshmi (Front desk)', phone: '98490 55555', email: 'frontdesk@apollodental.in' }, whatsappGroup: 'https://chat.whatsapp.com/ApolloDentalBPD',
      address: 'Road No. 12, Banjara Hills, Hyderabad, Telangana 500034', gstin: '36AAACA1111B1Z2', category: 'Health & Wellness', status: 'Active', managerId: 'u_pm1',
      services: ['Social Media Management', 'Photo / Video Shoots', 'SEO'], sentiment: 'Delighted', onboarding: doneSteps(5),
      assets: { logo: 'https://drive.google.com/apollo/logo', guidelines: 'https://drive.google.com/apollo/brand-book.pdf', fonts: 'Poppins, Lora' },
      notes: 'Monthly review on the first Monday. Every medical claim must be approved by Dr. Iyer.',
      package: pkg({ name: 'Clinic Growth Pro', monthlyFee: 95000, billingDay: 1, paymentTerms: '100% Advance', startDate: mkStart(9), endDate: mkStart(-3, 28),
        quotas: { poster: 12, reel: 6, story: 8, blog: 2, shoot: 2 }, shootType: 'CAMERA_DSLR', shootsPerMonth: 2, shootLocation: 'On-site (client premises)',
        rawFootageLink: 'https://drive.google.com/apollo/raw' }),
      referrals: [{ id: 'r1', name: 'SmileCare Orthodontics', date: mkStart(2, 14), status: 'Lead', credit: 5000, creditApplied: false, notes: 'Dr. Iyer’s colleague — intro call pending' }] }),
    C({ id: 'c_spice', company: 'Spice Route Restaurants', contact: 'Anil Kapoor', email: 'anil@spiceroute.in', phone: '98765 43210', whatsapp: '919876543210',
      whatsappGroup: 'https://chat.whatsapp.com/SpiceRouteBPD', address: 'Jubilee Hills Road No. 36, Hyderabad, Telangana 500033', gstin: '36AAECS4455D1Z1',
      category: 'Hospitality', status: 'Active', managerId: 'u_pm1', services: ['Social Media Management', 'Performance Ads (Meta)', 'Video Production'],
      sentiment: 'Neutral', onboarding: doneSteps(5), notes: 'Owner prefers WhatsApp. Weekend specials go live every Friday 6 PM.',
      package: pkg({ name: 'Restaurant Buzz', monthlyFee: 85000, billingDay: 1, paymentTerms: 'Net 15', startDate: mkStart(8), endDate: mkStart(-4, 28),
        quotas: { poster: 12, reel: 4, story: 8, video: 1, ad: 1, shoot: 1 }, shootType: 'MOBILE_PHONE', shootsPerMonth: 1, shootLocation: 'On-site (client premises)',
        metaAdBudget: 40000, rollover: true, rawFootageLink: 'https://drive.google.com/spice/raw' }),
      referrals: [{ id: 'r2', name: 'GreenLeaf Realty', date: mkStart(14, 20), status: 'Converted', credit: 10000, creditApplied: true, notes: '₹10,000 credit applied on invoice' }] }),
    C({ id: 'c_green', company: 'GreenLeaf Realty', contact: 'Meera Joshi', email: 'meera@greenleafrealty.com', phone: '99887 76655', whatsapp: '919988776655',
      address: 'Plot 44, Baner, Pune, Maharashtra 411045', gstin: '27AAACG2222C1Z9', category: 'Real Estate', status: 'Active', managerId: 'u_pm2',
      services: ['Social Media Management', 'SEO', 'Performance Ads (Meta)', 'Google Ads', 'Newsletters'], sentiment: 'Neutral', onboarding: doneSteps(5),
      referredBy: { type: 'client', clientId: 'c_spice', name: 'Spice Route Restaurants' }, notes: 'Lead-gen focus. Weekly lead report every Monday.',
      package: pkg({ name: 'Lead Engine', monthlyFee: 120000, billingDay: 5, billingCycle: 'custom', paymentTerms: '50-50 Milestone', startDate: mkStart(14), endDate: mkStart(-10, 28),
        quotas: { poster: 10, reel: 3, blog: 2, ad: 2, newsletter: 1, shoot: 1 }, shootType: 'HYBRID', shootsPerMonth: 1, shootLocation: 'Outdoor',
        metaAdBudget: 150000, googleAdBudget: 100000, rawFootageLink: 'https://drive.google.com/greenleaf/raw' }) }),
    C({ id: 'c_fit', company: 'FitNation Gyms', contact: 'Rohit Malhotra', email: 'rohit@fitnation.in', phone: '90000 12345', whatsapp: '919000012345',
      address: 'Phoenix Mall, Whitefield, Bengaluru, Karnataka 560066', gstin: '29AAFCF9988E1Z4', category: 'Health & Wellness', status: 'Active', managerId: 'u_pm2',
      services: ['Social Media Management', 'Video Production', 'Photo / Video Shoots'], sentiment: 'At-Risk', onboarding: doneSteps(5),
      notes: 'Unhappy with reel turnaround last month. Payments usually late — remind 3 days before due.',
      package: pkg({ name: 'Fitness Reels', monthlyFee: 55000, billingDay: 10, billingCycle: 'custom', paymentTerms: 'Net 15', startDate: mkStart(5), endDate: mkStart(-1, 25),
        quotas: { poster: 8, reel: 6, video: 2, shoot: 2 }, shootType: 'MOBILE_PHONE', shootsPerMonth: 2, shootLocation: 'On-site (client premises)' }) }),
    C({ id: 'c_edu', company: 'BrightMinds Academy', contact: 'Suresh Pillai', email: 'suresh@brightminds.edu.in', phone: '93333 44444', whatsapp: '919333344444',
      address: 'MG Road, Kochi, Kerala 682016', gstin: '32AABCB7766F1Z8', category: 'Education & EdTech', status: 'On Hold', managerId: 'u_pm1',
      services: ['Performance Ads (Meta)', 'SEO'], sentiment: 'Neutral', onboarding: doneSteps(5), notes: 'On hold during exam season. Resumes next admission cycle.',
      package: pkg({ name: 'Admissions Push', monthlyFee: 45000, billingDay: 20, billingCycle: 'custom', paymentTerms: '100% Advance', startDate: mkStart(10), endDate: mkStart(-2, 28),
        quotas: { poster: 6, blog: 2, ad: 2 } }) }),
    C({ id: 'c_urban', company: 'UrbanThreads', contact: 'Zoya Merchant', email: 'zoya@urbanthreads.co', phone: '97000 88888', whatsapp: '919700088888',
      address: 'Linking Road, Bandra West, Mumbai, Maharashtra 400050', gstin: '27AAGCU3344H1Z2', category: 'E-Commerce', status: 'Onboarding', managerId: 'u_pm2',
      services: ['Social Media Management', 'Performance Ads (Meta)', 'Photo / Video Shoots'], sentiment: 'Delighted',
      onboarding: ONBOARDING_STEPS.map((_, i) => (i < 2 ? { done: true, date: addDays(today, -10 + i * 4) } : { done: false, date: '' })),
      referredBy: { type: 'partner', clientId: '', name: 'Mumbai D2C Founders Club' }, notes: 'Waiting on Meta Business Manager access.',
      package: pkg({ name: 'D2C Launch', monthlyFee: 70000, billingDay: 1, paymentTerms: '100% Advance', startDate: next + '-01', endDate: addMonths(next, 11) + '-28',
        quotas: { poster: 15, reel: 5, ad: 3, shoot: 1 }, shootType: 'CAMERA_DSLR', shootsPerMonth: 1, shootLocation: 'Studio', metaAdBudget: 200000 }) }),
    C({ id: 'c_zen', company: 'Zen Yoga Studio', contact: 'Ananya Rao', email: 'ananya@zenyoga.in', phone: '96666 22222', whatsapp: '919666622222',
      address: 'Indiranagar, Bengaluru, Karnataka 560038', category: 'Health & Wellness', status: 'Lead', managerId: 'u_pm1', services: ['Social Media Management'],
      sentiment: 'Neutral', onboarding: ONBOARDING_STEPS.map(() => ({ done: false, date: '' })), referredBy: { type: 'client', clientId: 'c_apollo', name: 'Apollo Dental Care' },
      notes: 'Proposal sent for ₹30,000/month starter plan. Follow up Friday.',
      package: pkg({ name: 'Starter (proposed)', monthlyFee: 30000, quotas: { poster: 8, reel: 2 } }) }),
  ];

  const data = { version: DATA_VERSION, settings, users, clients, invoices: [], tasks: [], attendance: [], leaves: [], eod: [], activity: [], session: null };

  /* ---------- Invoices ---------- */
  generateInvoices(data, today);
  const edu = clients.find((c) => c.id === 'c_edu');
  [prev2, prev].forEach((mk) => data.invoices.push(makeInvoice(data, edu, { mk, issueDate: billingDateFor(edu, mk), subtotal: 45000 })));
  const inv = (cid, mk) => data.invoices.find((p) => p.clientId === cid && p.month === mk);
  const pay = (cid, mk, amount, mode, ref, afterDays = 3) => {
    const p = inv(cid, mk); if (!p) return;
    const amt = amount === 'full' ? balance(p) : amount === 'half' ? p.schedule[0].amount : amount;
    let date = addDays(p.issueDate, afterDays); if (date > today) date = today;
    p.transactions.push({ id: uid('txn'), date, amount: amt, mode, ref, note: '', receipt: '', by: 'u_fin' });
    p.amountPaid += amt;
  };
  pay('c_apollo', prev2, 'full', 'Bank Transfer', 'NEFT/HDFCN5100221', 1);
  pay('c_spice', prev2, 'full', 'UPI', 'UPI/4182736451', 9);
  pay('c_green', prev2, 'full', 'Bank Transfer', 'NEFT/ICIC00229103', 12);
  pay('c_fit', prev2, 'full', 'Razorpay', 'pay_OZx81kLmQ2', 14);
  pay('c_edu', prev2, 'full', 'Bank Transfer', 'IMPS/33810294', 4);
  pay('c_apollo', prev, 'full', 'Bank Transfer', 'NEFT/HDFCN5210044', 2);
  pay('c_spice', prev, 'full', 'UPI', 'UPI/4190023311', 11);
  pay('c_green', prev, 'half', 'Bank Transfer', 'NEFT/ICIC00310077', 5);
  pay('c_apollo', cur, 'full', 'UPI', 'UPI/5610048822', 2);
  pay('c_spice', cur, 50000, 'UPI', 'UPI/4201188200', 6);
  pay('c_green', cur, 'half', 'Bank Transfer', 'NEFT/ICIC00400021', 4);
  const fitCur = inv('c_fit', cur);
  if (fitCur) fitCur.dispute = { open: true, reason: 'Client says 2 reels from last month were never delivered; holding payment until reconciled.', raisedAt: now - 3 * 86400000, by: 'u_fin' };

  /* ---------- Tasks ---------- */
  const titles = {
    poster: ['Festive offer poster', 'Testimonial quote card', 'Did-you-know fact post', 'Service highlight', 'Team spotlight', 'Before / after post', 'FAQ graphic', 'Weekend special', 'Tips post', 'Event announcement', 'Poll post', 'Milestone post'],
    carousel: ['5 myths carousel', 'Step-by-step guide carousel', 'Price list carousel'],
    reel: ['Trending audio reel', 'Behind-the-scenes reel', 'Day-in-the-life reel', 'Transformation reel', 'Quick tips reel', 'Offer teaser reel'],
    story: ['Poll story', 'Countdown story', 'Q&A story', 'Offer story', 'Review story', 'BTS story', 'Menu story', 'Link story'],
    video: ['Brand film edit', 'YouTube explainer'],
    blog: ['SEO blog: complete guide', 'SEO blog: top 10 myths', 'SEO blog: buyer checklist'],
    ad: ['Lead-gen ad creative set', 'Retargeting ad creative'],
    newsletter: ['Monthly newsletter'],
    shoot: ['Monthly content shoot', 'Reels shoot day'],
  };
  const assigneeFor = (type, i) => ({ poster: ['u_des1', 'u_des2'][i % 2], carousel: 'u_des2', story: 'u_des1', ad: 'u_des2', reel: 'u_ed1', video: 'u_ed1', blog: 'u_wr1', newsletter: 'u_wr1', script: 'u_wr1', adcopy: 'u_ads1', shoot: 'u_sh1', shootprep: 'u_sh1' }[type]);
  const share = { c_apollo: 0.92, c_spice: 0.85, c_green: 0.8, c_fit: 0.4 };
  const pushTask = (c, mk, type, title, i, status, due) => {
    const done = DONE_STATUSES.includes(status);
    const t = newTask({ clientId: c.id, campaign: mk, title, type, priority: PRIORITIES[(i + type.length) % 4], assigneeId: assigneeFor(type, i), reviewerId: c.managerId,
      dueDate: due, publishDate: ['poster', 'carousel', 'reel', 'story', 'video', 'blog'].includes(type) ? addDays(due, 1) : '', status,
      link: done || REVIEW_STATUSES.includes(status) ? `https://drive.google.com/${c.id}/${mk}/${type}-${i + 1}` : '',
      revisions: done ? Math.floor(rand() * 3) : REVIEW_STATUSES.includes(status) ? Math.floor(rand() * 2) : 0,
      completedAt: done ? Math.min(now - 3600000, parseISO(due).getTime() + 15 * 3600000) : null, completedBy: done ? assigneeFor(type, i) : '',
      createdAt: parseISO(mk + '-01').getTime(), updatedAt: now - Math.floor(rand() * 5) * 86400000 });
    if (type === 'shoot') {
      t.shoot = defaultShoot(c);
      t.shoot.date = due; t.shoot.time = pick(['09:30', '11:00', '15:00']); t.shoot.crewIds = ['u_sh1', 'u_ed1'];
      t.title = `${title} — ${c.package.shootLocation.split(' ')[0]}`;
      const readyAll = TASK_STATUSES.indexOf(status) >= 2;
      SHOOT_CHECKLIST.forEach((k, n) => (t.shoot.checklist[k.key] = readyAll || n < 3));
      if (done) t.shoot.rawLink = c.package.rawFootageLink;
    }
    data.tasks.push(t);
    return t;
  };
  const activeClients = clients.filter((c) => c.status === 'Active');
  activeClients.forEach((c) => {
    [prev, cur].forEach((mk) => {
      const days = daysInMonth(mk);
      QUOTA_TYPES.forEach((q) => {
        let n = Number(c.package.quotas[q.key]) || 0;
        if (c.id === 'c_spice' && mk === prev && q.key === 'reel') n -= 1; // one reel left unmade → rolls over
        if (c.id === 'c_fit' && mk === prev && q.key === 'reel') n -= 2;   // the disputed missing reels
        for (let i = 0; i < n; i++) {
          const day = Math.max(1, Math.min(days, Math.round(((i + 1) / (n + 1)) * days)));
          const due = mk + '-' + pad(day);
          const type = q.key === 'poster' && i % 4 === 3 ? 'carousel' : q.key;
          let status;
          if (mk < cur) status = i % 3 ? 'Published' : 'Ready to Publish';
          else if (due < today) status = rand() < share[c.id] ? (i % 3 ? 'Published' : 'Ready to Publish') : pick(['Design / Editing', 'Internal Review', 'Client Approval']);
          else if (daysBetween(today, due) <= 3) status = pick(['Design / Editing', 'Internal Review', 'Scripting / Brief', 'Client Approval']);
          else status = pick(['Backlog', 'Scripting / Brief', 'Design / Editing']);
          pushTask(c, mk, type, titles[type][i % titles[type].length], i, status, due);
        }
      });
      // Supporting tasks (not counted in quota)
      if (c.package.quotas.reel) pushTask(c, mk, 'script', 'Reel scripts batch', 0, 'Published', mk + '-03');
      if (c.package.metaAdBudget) pushTask(c, mk, 'adcopy', 'Meta ad copy variations', 0, mk < cur ? 'Published' : 'Ready to Publish', mk + '-06');
    });
  });
  // Next month's early planning for Apollo
  const apollo = clients[0];
  pushTask(apollo, next, 'script', 'Root canal awareness reel script', 0, 'Scripting / Brief', next + '-04');
  pushTask(apollo, next, 'reel', 'Reel #4 on root canal awareness', 3, 'Backlog', next + '-08');
  pushTask(apollo, next, 'shootprep', 'Shoot prep: shot list & props', 0, 'Backlog', next + '-05');
  pushTask(apollo, next, 'shoot', 'Monthly content shoot', 0, 'Backlog', next + '-06');
  // Over-limit revisions example
  const revTask = data.tasks.find((t) => t.clientId === 'c_fit' && t.type === 'reel' && t.campaign === cur && REVIEW_STATUSES.includes(t.status));
  if (revTask) { revTask.revisions = 3; revTask.billable = true; }

  /* ---------- Leaves ---------- */
  const L = (userId, type, from, to, status, reason, backupId = '', halfDay = false, decidedBy = 'u_admin') => data.leaves.push({
    id: uid('lv'), userId, type, from, to, halfDay, reason, backupId, status, decidedBy: status === 'Pending' ? '' : decidedBy,
    decidedAt: status === 'Pending' ? null : now - 5 * 86400000, createdAt: now - 8 * 86400000 });
  L('u_des2', 'casual', today, today, 'Approved', 'Family function', 'u_des1');
  L('u_ed1', 'sick', addDays(today, -18), addDays(today, -17), 'Approved', 'Fever', 'u_des2', false, 'u_pm2');
  L('u_des1', 'casual', addDays(today, -9), addDays(today, -9), 'Approved', 'Bank work (half day)', '', true, 'u_pm1');
  L('u_wr1', 'pto', addDays(today, 6), addDays(today, 8), 'Pending', 'Sister’s wedding in Jaipur', 'u_ads1');
  L('u_sh1', 'casual', addDays(today, 11), addDays(today, 11), 'Pending', 'Personal errand', '');
  L('u_ads1', 'pto', addDays(today, -25), addDays(today, -24), 'Rejected', 'Short trip', '', false, 'u_admin');
  L('u_ads1', 'unpaid', addDays(today, -14), addDays(today, -14), 'Approved', 'Extended weekend', '');

  /* ---------- Attendance (last ~6 weeks) ---------- */
  const t2ms = (iso, h, m) => { const d = parseISO(iso); d.setHours(h, m, 0, 0); return d.getTime(); };
  users.forEach((u) => {
    dateRange(addDays(today, -42), today).forEach((d) => {
      if ((settings.weekOff || [0]).includes(parseISO(d).getDay())) return;
      if (u.joinDate && d < u.joinDate) return;
      const lv = leaveOn(u.id, d, data);
      if (lv && !lv.halfDay) return;
      const isToday = d === today;
      if (isToday && (u.id === 'u_wr1' || u.id === 'u_admin')) return; // not clocked in yet (try it!)
      const r = rand();
      if (!isToday && r < 0.04) return; // absent
      const late = r > 0.84;
      const inH = late ? 10 : 9, inM = late ? 20 + Math.floor(rand() * 35) : 35 + Math.floor(rand() * 24);
      const clockIn = t2ms(d, inH, inM);
      if (isToday && clockIn > now) return;
      const half = (lv && lv.halfDay) || (!isToday && r > 0.975 && r <= 0.985);
      const outMs = half ? clockIn + (4 * 60 + Math.floor(rand() * 30)) * 60000 : t2ms(d, 18, 40 + Math.floor(rand() * 50));
      const a = { id: uid('att'), userId: u.id, date: d, clockIn, clockOut: null, breaks: [], ip: '192.168.1.' + (20 + users.indexOf(u)), eodId: '' };
      const lunch = { type: 'Lunch', start: t2ms(d, 13, 30 + Math.floor(rand() * 15)), end: null };
      lunch.end = lunch.start + (35 + Math.floor(rand() * 20)) * 60000;
      const tea = { type: 'Short break', start: t2ms(d, 16, 30 + Math.floor(rand() * 20)), end: null };
      tea.end = tea.start + (10 + Math.floor(rand() * 10)) * 60000;
      if (!half) [lunch, tea].forEach((b) => { if (!isToday || b.start < now) a.breaks.push({ ...b, end: isToday && b.end > now ? null : b.end }); });
      if (!isToday || outMs < now) a.clockOut = outMs;
      if (isToday && u.id === 'u_ed1' && now > clockIn + 3600000 && !a.clockOut && !openBreak(a)) a.breaks.push({ type: 'Short break', start: now - 8 * 60000, end: null });
      data.attendance.push(a);
    });
  });

  /* ---------- EOD reports for creative staff ---------- */
  data.attendance.filter((a) => a.clockOut && a.date <= today && ['u_des1', 'u_des2', 'u_ed1', 'u_wr1', 'u_ads1', 'u_sh1'].includes(a.userId) && a.date >= addDays(today, -12)).forEach((a) => {
    const mine = data.tasks.filter((t) => t.assigneeId === a.userId);
    const doneT = mine.filter((t) => t.completedAt && toISO(new Date(t.completedAt)) === a.date);
    const pend = mine.filter((t) => !DONE_STATUSES.includes(t.status)).slice(0, 2);
    const e = { id: uid('eod'), userId: a.userId, date: a.date, completedIds: doneT.map((t) => t.id),
      completedSummary: doneT.length ? doneT.map((t) => `${t.title} (${(clients.find((c) => c.id === t.clientId) || {}).company})`).join('; ') : pick(['Worked on revisions for pending items', 'Research and moodboards for next week', 'Edits and exports in progress']),
      pending: pend.map((t) => ({ taskId: t.id, reason: pick(['Waiting on client feedback', 'Assets not received', 'Needs internal review', 'In progress']), eta: addDays(a.date, 1 + Math.floor(rand() * 3)) })),
      blockers: rand() < 0.25 ? 'Waiting on brand assets from client' : '', loggedAt: a.clockOut };
    data.eod.push(e);
    a.eodId = e.id;
  });

  /* ---------- Feedback (CSAT / NPS) ---------- */
  const fb = { c_apollo: [[5, 10, 'Loved the dental myth carousel series'], [5, 9, 'Great month — patient enquiries up']],
    c_spice: [[4, 8, 'Good reels, want faster story turnaround'], [4, 8, 'Weekend specials performing well']],
    c_green: [[4, 7, 'Leads good, quality could improve'], [3, 7, 'Wants more site-visit videos']],
    c_fit: [[3, 6, 'Reel turnaround slow'], [2, 4, 'Missing 2 reels — escalated to founder']] };
  Object.entries(fb).forEach(([cid, rows]) => {
    const c = clients.find((x) => x.id === cid);
    rows.forEach(([csat, nps, note], i) => c.feedback.push({ id: uid('fb'), month: [prev2, prev][i], csat, nps, notes: note, by: c.managerId, date: addMonths([prev2, prev][i], 1) + '-03' }));
  });

  /* ---------- Audit trail (oldest first so the hash chain is in order) ---------- */
  [
    [30, 'u_admin', 'Priya Sharma', 'Workspace created', 'AgencyDesk set up with sample data', '', ''],
    [9, 'u_pm2', 'Sneha Reddy', 'Client added', 'UrbanThreads added as Onboarding (D2C Launch, ₹70,000/month)', 'client', 'c_urban'],
    [7, 'u_pm2', 'Sneha Reddy', 'Onboarding step completed', 'UrbanThreads — Brand questionnaire / intake form submitted', 'client', 'c_urban'],
    [5, 'u_fin', 'Vikram Rao', 'Payment recorded', 'GreenLeaf Realty milestone 1 received via Bank Transfer', 'payment', 'c_green'],
    [3, 'u_fin', 'Vikram Rao', 'Invoice disputed', 'FitNation Gyms — client says 2 reels missing', 'payment', 'c_fit'],
    [2, 'u_pm2', 'Sneha Reddy', 'Sentiment changed', 'FitNation Gyms Neutral → At-Risk', 'client', 'c_fit'],
    [1, 'u_ed1', 'Imran Shaikh', 'Task status changed', 'Trending audio reel (Apollo Dental Care) Internal Review → Client Approval', 'task', 'c_apollo'],
  ].forEach(([daysAgo, userId, userName, action, details, entity, clientId]) => appendAudit(data, { ts: now - daysAgo * 86400000, userId, userName, action, details, entity, entityId: clientId, clientId }));

  refreshPaymentStatuses(data);
  data.session = { userId: null };
  return data;
}
