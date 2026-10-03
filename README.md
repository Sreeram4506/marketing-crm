# AgencyDesk

AgencyDesk is the operating system for a digital marketing agency. It covers:

- clients, packages and deliverable quotas;
- GST billing and collections;
- the production board, shoots and a client approval portal;
- attendance, leave, end-of-day (EOD) reports and payroll;
- an audit trail that shows if anyone has tampered with it.

**Stack:**
- **Frontend:** a static site (`index.html`, `css/`, `js/`), hosted on **Vercel**.
- **API:** Node.js + Express in `server/`, hosted on **Render** (or Docker).
- **Database:** **MongoDB** (Atlas). Uploaded files are stored in MongoDB too (GridFS).
- **Email:** optional, via **Resend**.

Vercel forwards `/api/*` to Render, so the browser only talks to your own domain.

If no API is reachable (for example you open `index.html` directly), the app runs as a **demo mode**. Demo data lives in the browser, and you pick a sample person to sign in as.

---

## Who can do what

| Role | Sees | Can change |
|---|---|---|
| **Super Admin** | Everything | Everything, including settings, roles, sessions and 2FA resets |
| **Account / Project Manager** | Their own clients, their clients' invoices, team attendance and leave | Their clients, tasks and quotas, reminders, leave approvals for creative and shoot staff, client portal logins |
| **Creative Team** | Their own tasks, attendance, leave and EOD reports | Stage, asset, notes and revisions on their tasks; their own clock-in, breaks, EOD and leave requests |
| **Production / Shoot Crew** | Shoot tasks and their own records | Equipment checklist, raw-file handoff, stages |
| **Finance / Operations** | All invoices, payroll data | Invoices, payments, disputes, salary slips |
| **Client (portal)** | Their own company only: deliverables, invoices and receipts | Approve deliverables, request changes (with a comment), rate each month |

The **server** enforces all of this, record by record and field by field. The screens hiding things is just convenience.

---

## AI co-founder (voice or text)
Press the sparkle button (or **Ctrl/⌘ + J**) and talk or type. The co-founder runs on the **OpenAI API** (`gpt-5.5` by default). It acts as a business partner that watches the numbers and gives you its view, and it also does the work in AgencyDesk on your behalf.

- **Thinks like an owner:**
  - "How is the business really doing?"
  - "Which clients aren't worth what they cost us?"
  - "Can we take on another client without hiring?"
  - "What happens if we raise FitNation's fee by 10 thousand?"
  - "Who might churn, and how do we save them?"

  It runs a business review covering:
  - monthly recurring revenue and the 6-month trend;
  - collection rate and overdue money by client;
  - revenue concentration;
  - a health score for each client, with the reasons;
  - production effort compared with revenue for each client;
  - estimated margin per client, and payroll as a share of revenue (admins only);
  - team load and spare capacity;
  - leads, referrals and upcoming renewals.

  Then it gives a ranked recommendation, and it will push back on risky plans.
- **Watches for you:**
  - The sparkle button shows a badge with the number of things that need attention, such as overdue money, an at-risk client, an upcoming renewal, an overloaded designer or a payroll-heavy month.
  - Opening the panel lists those alerts; tap one to talk it through.
  - These alerts are worked out by rules on the server, so they cost nothing.
- **Daily briefing:** the first time a founder, manager or finance person opens the panel each day, it briefs them on the most important thing and recommends what to do.
- **Remembers:**
  - "Remember our goal is 5 lakh monthly revenue by March." Goals and agency notes carry into every future conversation, and progress is measured against them.
  - Personal preferences stay private to each person.
  - Admins can review and remove what it remembers in **Settings → What the co-founder remembers**.
- **Shows each person what fits their role:** designers and shoot crew get help with their own day, not company finances.
- **Look things up:** "What needs my attention today?", "How much is overdue and from whom?", "How is Apollo doing this month?", "Who's on leave today?"
- **Get work done:**
  - "Create a high-priority reel for Apollo, give it to Arjun, due Friday."
  - "Move my poster to internal review."
  - "Record 50 thousand from Spice Route by UPI."
  - "Approve Neha's leave."
  - "Clock me in." / "Going for lunch." / "Clock me out — finished the storyboards."
  - "Log Apollo's review: five stars, NPS nine." / "Draft a reminder for GreenLeaf." / "Open FitNation's billing."
- **Voice:**
  - Tap the mic to speak. Replies are read aloud as they're written, and you can talk over the co-founder to interrupt it.
  - **Hands-free mode** (headset icon) keeps the conversation going without tapping.
  - Speech recognition works in Chrome, Edge and Safari; in Firefox you can type.
  - In Chrome, the microphone audio is converted to text by the browser maker's speech service.

**Safety built in:**
- **Same permissions as the person.** The co-founder acts with the speaking person's own permissions and saves through the same checked path as the app, so a designer can't move money by asking nicely.
- **Confirmation before risky actions.** Recording a payment, adding a client, approving or rejecting leave, and bulk planning all need a spoken "yes" or a tap on **Confirm**. The *server* enforces that the yes came in a later message, so a misheard word can't trigger it.
- **Audit trail.** Every action shows up in the audit trail marked "via AI assistant".
- **Admin switch.** Admins can turn the co-founder off in Settings.

**Turn it on:** add `OPENAI_API_KEY` (from https://platform.openai.com/api-keys) to Render → Environment. Usage is billed to that OpenAI account, which needs credit loaded; each person is limited to 40 messages per 10 minutes (`AI_RATE_LIMIT`). Spoken questions use low reasoning effort so replies are fast; typed questions get medium effort for more considered advice. Set `AI_REASONING_EFFORT` to use the same effort for both. To use a different model, for example a cheaper one, set `AI_MODEL`; any OpenAI chat model with tool calling works.

## Security
- **Passwords:**
  - Hashed with bcrypt.
  - Must be at least 10 characters with a number or symbol.
  - An account locks for 15 minutes after 8 wrong attempts.
  - Sign-in endpoints are rate-limited.
- **Two-factor authentication:** people use any authenticator app, with 8 one-time recovery codes. Admins can *require* 2FA per role (Settings → Email & security) and can reset a lost device.
- **Sessions:**
  - Sessions last 12 hours.
  - Changing or resetting a password, turning 2FA on or off, or **Sign out everywhere** instantly ends every other session.
  - Admins can end anyone's sessions, for example for a lost laptop or someone leaving.
- **Password reset and invites:** emailed one-time links. Reset links last 30 minutes and invite links 3 days. Only a hash of the token is stored.
- **Validation:** every record from the browser is type-checked, length-limited and stripped of unknown fields.
  - Links must be `http(s)://` links or AgencyDesk uploads, so a pasted `javascript:` link can't run.
  - A payment total is always calculated from the recorded payments; the browser can't simply set it.
- **Edit conflicts:** every record has a version number. If two people edit the same record at once, the second save is refused. They see the latest version and are asked to redo their change, so nothing is silently overwritten.
- **Files:**
  - Types are allow-listed, and the file's contents must match its type (magic-number check).
  - Maximum size is 10 MB by default.
  - Files are private. Downloads use signed links that expire after 10 minutes.
  - HR documents (NDA, contract, ID proof) are visible only to Admin and Finance.
  - Clients can open only the files attached to their own deliverables.
- **Browser hardening:**
  - A strict Content-Security-Policy: no inline scripts, and scripts load only from this site and jsDelivr.
  - HSTS, no framing by other sites, `nosniff`.
  - No `X-Powered-By` header.
- **Audit trail:** append-only and hash-chained, attributed by the server. The admin view checks its integrity on every load.
- **Other server-side guarantees:**
  - Clock-in IP addresses are recorded by the server.
  - Invoice numbers come from one server-side sequence.
  - Automations run on the server.

---

## Deploy: MongoDB Atlas + Render + Vercel

### 1. MongoDB Atlas
1. Create a cluster at https://cloud.mongodb.com in AWS Mumbai (`ap-south-1`) or Singapore.
   - The free **M0** tier (512 MB) is fine to start.
   - Use **M10+** in production for automatic backups.
2. **Database Access** → add a user with a strong password.
3. **Network Access** → add `0.0.0.0/0`. Render has no fixed outgoing IPs, so the database password is what protects the data.
4. **Connect → Drivers** → copy the `mongodb+srv://…` connection string.

### 2. Email (optional, recommended)
1. Create a free account at https://resend.com and verify your domain.
2. Create an API key.
3. Choose a sender, for example `BrightPixel <accounts@yourdomain.in>`.

Without email, everything still works: admins set passwords by hand, and reminders go through the webhook or are copied manually.

### 3. GitHub
```bash
git init
```
```bash
git add -A
```
```bash
git commit -m "AgencyDesk"
```
Then create a GitHub repository and push to it. **CI** (`.github/workflows/ci.yml`) runs the full test suite against MongoDB on every push.

### 4. Render (API)
1. **New → Blueprint**, then pick the repo (it uses `render.yaml`).
2. Fill in the settings it asks for:
   - `MONGODB_URI`
   - `APP_URL` (your Vercel URL)
   - `RESEND_API_KEY` and `EMAIL_FROM` (both optional)

   `JWT_SECRET` and `CRON_SECRET` are generated for you.
3. When it's live, `https://<service>.onrender.com/api/health` shows `{"ok":true,…}`.
4. **For real use, pick the Starter plan or above.** The free plan sleeps after 15 minutes idle, so the first request after that takes about 50 seconds, and scheduled jobs wait until someone opens the app.

### 5. Vercel (frontend)
1. Put your Render URL in `vercel.json` → `rewrites[0].destination`, then commit.
2. Import the repo on https://vercel.com/new. Choose Framework **Other**, leave the build command empty, and use the repo root as the output directory.
3. Open the Vercel URL. **Set up your workspace** creates the Super Admin.
4. Then turn on 2FA (shield icon, bottom left), and require it for Admin and Finance in Settings.

### 6. Schedule the automations
The server creates monthly invoices, marks invoices overdue, and sends payment reminders every hour while it's awake. To guarantee this even on a sleeping instance, call the cron endpoint hourly with a Render Cron Job or cron-job.org:
```
POST https://<service>.onrender.com/api/cron
Header: x-cron-secret: <CRON_SECRET>
```

### Alternative: one server with Docker
```bash
JWT_SECRET=$(openssl rand -hex 48) docker compose up -d --build
```
This runs MongoDB and the app on port 4000. Put it behind HTTPS, for example with Caddy or nginx. The image has a health check, runs as a non-root user and shuts down gracefully.

### Environment variables
| Name | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | yes | Database connection string |
| `JWT_SECRET` | yes | Signs sessions; 32+ random characters |
| `MONGODB_DB` | | Database name (default `agencydesk`) |
| `APP_URL` | for email | Public app URL, used in invite and reset links |
| `RESEND_API_KEY`, `EMAIL_FROM` | for email | Invites, password resets, emailed reminders, leave and approval notifications |
| `CRON_SECRET` | recommended | Protects `/api/cron` |
| `TZ` | | `Asia/Kolkata` (default): billing days, late arrivals and due dates use Indian time |
| `MAX_UPLOAD_MB` | | Upload limit (default 10) |
| `OPENAI_API_KEY` | for AI | Turns on the AI co-founder |
| `AI_MODEL` | | OpenAI model for the co-founder (default `gpt-5.5`) |
| `AI_REASONING_EFFORT` | | Override reasoning effort (default: low for voice, medium for typed) |
| `AI_RATE_LIMIT` | | Co-pilot messages per person per 10 minutes (default 40) |
| `ALLOWED_ORIGINS` | | Only if a frontend on another domain calls the API directly |
| `SERVE_FRONTEND` | | `false` makes the service API-only |

---

## Run locally
```bash
cp server/.env.example server/.env
```
Put a long random `JWT_SECRET` in `server/.env`. You can generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
```bash
npm install --prefix server
```
```bash
node server/index.js
```
Open http://localhost:4000. This needs MongoDB running locally, for example `brew services start mongodb-community`.

**Demo mode:** open `index.html` directly, or run `python3 -m http.server 5173`.

---

## Testing
```bash
MONGODB_URI=mongodb://127.0.0.1:27017 npm test --prefix server
```
There are 51 end-to-end tests: 36 for the app and 15 for the AI co-founder, which run against a scripted stand-in for the OpenAI API. Each run starts a real server against a throwaway database (dropped afterwards), with stand-ins for the webhook and email provider. They cover:
- **Setup and sign-in:** first-run setup, logins, rate limits, account lockout, weak passwords.
- **2FA:** enrolment, sign-in challenge, single-use recovery codes, requiring 2FA by role.
- **Sessions and email links:** "sign out everywhere", password-reset and invite links (single use), leave notifications.
- **Permissions:** what every role can read and write, including tampering attempts and the client portal.
- **Data integrity:** validation (dangerous links, bad values), edit-conflict detection.
- **Billing and HR rules:** GST, milestones, payments computed from transactions, disputes, invoice numbering when two are created at once, leave rules, attendance IP stamping.
- **Files:** type and content checks, HR-document privacy, signed downloads, client access.
- **Automations:** cron and reminder webhooks (no duplicates).
- **Security and audit:** security headers, audit-chain integrity.

---

## How the PRD maps to the app

| PRD | Where |
|---|---|
| **A1 Client profile, status, onboarding (5 steps)** | Clients → Add/Edit; Client 360 → Overview |
| **A2 Package and quota engine, shoot scope, ad budgets** | Client 360 → Deliverables, with a progress ring per type |
| **A3 Billing: terms, GST invoices, receipts, payment log, disputes** | Billing. CGST+SGST or IGST from the GSTINs; Advance, Net 15/30 or 50-50 terms; receipt uploads |
| **A4 CSAT/NPS, sentiment, referrals** | Client 360 → Feedback & NPS (clients can also rate from the portal) and Referrals |
| **B1 Employee profiles and documents** | Team & HR → person. NDA, contract and ID uploads are Admin/Finance only |
| **B2 Clock in/out, breaks, IP, status, leave** | My Day; Team & HR → Attendance, Leave |
| **C1 Tasks: client ➔ campaign ➔ task, 7-stage pipeline** | Tasks & Board (Board, Calendar, List); assets can be uploaded |
| **C2 Mandatory EOD, workload heatmap** | The EOD report is required to clock out; Team & HR → Workload, EOD reports |
| **Executive overview** | Dashboard |
| **Quota rollover, revision limits, shoot kit checklist** | Per-client rollover; revision counter with a billable flag; the checklist is enforced by the server |
| **Automated payment reminders** | 3 days before due and when overdue, sent by webhook (WhatsApp via Zapier, Make, Gupshup or Twilio) and/or email to the client |
| **Immutable audit trail** | Audit Trail (hash-chain integrity check) |
| **Salary slips** | Payroll: estimate from CTC and attendance, including loss of pay, PF, PT and TDS. Check with your CA |
| **Phase 2 client portal** | Client logins from Client 360 → Client portal access |

## Limitations
- **Run a single API instance** (Render's default). Writes are serialised in-process, which keeps invoice numbers and the audit chain consistent. Running several instances would need MongoDB transactions.
- **Data syncs about every 60 seconds.** Teammates' changes appear within a minute, or right away when someone returns to the tab. It isn't instant push.
- **WhatsApp messages go through your webhook tool.** Direct WhatsApp Business API sending needs approved templates.
- **Large raw footage should stay as Drive/Dropbox/NAS links.** Uploads suit documents and deliverables up to the size limit. Atlas M0 has 512 MB in total.
- **Payroll figures are estimates.** Statutory filings (PF/ESI/TDS returns) are out of scope.
- **Restores use Atlas backups.** The in-app export is a JSON copy for your records.

## Files
```
index.html                 Entry page (bump the ?v= numbers after editing JS/CSS)
vercel.json / .vercelignore  Vercel: /api proxy, security headers (CSP, HSTS…), keeps server code off Vercel
render.yaml                Render blueprint
Dockerfile / docker-compose.yml  Self-hosting
.github/workflows/ci.yml   Tests on every push
css/styles.css             Styling, light/dark, responsive
js/config.js               API location ('' = same origin)
js/api.js                  Server mode: sign-in, 2FA, reset, security, sync with conflict handling, uploads
js/core.js, js/seed.js     Business rules and sample data (shared with the server)
js/portal.js               Client portal
js/assistant.js            AI co-founder panel: signals badge, daily briefing, voice in/out, hands-free, confirmations
js/ui.js, dashboard.js, clients.js, tasks.js, payments.js, workspace.js, hr.js, reports.js, admin.js   Screens
server/index.js, app.js    Startup (config check, graceful shutdown) and the Express app (headers, limits, logging)
server/routes/             auth (login, 2FA, reset), data (read/sync/export), files, admin (passwords, invites, reminders, cron)
server/lib/                config, auth (sessions, lockout), totp, validate, policy (permissions), files (GridFS),
                           email, notify, automation, db (audit chain, write lock), shared (loads js/core.js in Node), log
server/test/               End-to-end tests (e2e.test.js, assistant.test.js) and the OpenAI API stand-in
```
MongoDB collections: `users`, `clients` (package, onboarding, feedback and referrals are stored inside each client), `invoices`, `tasks`, `attendance`, `leaves`, `eod`, `activity`, `meta` (settings), and `files.files` / `files.chunks` (uploads).
