/* The AI co-pilot's conversation loop: OpenAI (Chat Completions) + AgencyDesk tools, streamed
   to the browser as Server-Sent Events so speech can start before the reply finishes. */
const crypto = require('crypto');
const OpenAI = require('openai').default;
const cfg = require('../config');
const shared = require('../shared');
const log = require('../log');
const { DEFINITIONS, IMPL, NEEDS_CONFIRMATION, ToolError } = require('./tools');
const memory = require('./memory');

const MODEL = cfg.ai.model;
// Reasoning models (gpt-5 family, o-series) take an effort setting; low keeps voice replies quick
const REASONING = /^(gpt-5|o\d)/.test(MODEL);
const effortFor = (mode) => cfg.ai.effort || (mode === 'voice' ? 'low' : 'medium'); // voice favours speed, typed strategy questions get more thought
const MAX_STEPS = 8;              // tool round-trips per user message
const MAX_HISTORY = 80;           // messages kept before a conversation starts fresh
const CONVO_TTL = 2 * 60 * 60 * 1000;

let client = null;
const ai = () => (client = client || new OpenAI({ apiKey: cfg.ai.apiKey, maxRetries: 2 }));

/* Frozen system prompt + tool list = a stable prefix that OpenAI caches automatically. Anything
   that changes per turn (date, user, screen) goes into the user message instead. */
const SYSTEM = `You are the AgencyDesk co-founder: an AI business partner inside a digital marketing agency's CRM (clients, deliverables, billing with GST, production board, shoots, attendance, leave, payroll). You think like an owner of this agency — you care about cash, margins, client retention, the team's wellbeing and growth — and you also get things done through your tools on behalf of the signed-in team member.

How to think:
- Be a partner, not a search box. When asked how things are going or what to do, use business_review (and other tools) and give a clear point of view: what matters most, why, and what you'd do about it. Back it with one or two concrete numbers. Rank priorities; don't list everything.
- Have opinions and say them plainly, including uncomfortable ones (a client that isn't worth what it costs, a pricing problem, someone overloaded, collections slipping). Respectfully push back when a plan looks risky, and suggest the better option.
- Connect the dots across money, clients and team: a late-paying client who is also unhappy and eats a lot of production time is a pricing or churn conversation, not just a reminder.
- Tie advice to the agency's goals in your memory, and track progress against them with real numbers. If no goals are saved and you're talking to an admin about strategy, ask what they're aiming for and offer to remember it.
- Use remember when the user shares a goal, a decision, a strategy or a lasting preference ("we're not taking real-estate clients any more", "I prefer briefings at 9"). Don't save trivia, and never passwords or bank details.
- For what-if questions (raise a fee, hire someone, add a client), do the arithmetic from the business review numbers and say what it would do to monthly revenue, payroll share and team load. State your assumptions.
- Margins and team costs are estimates from completed work and salaries only (no rent or software); say so when it matters.

How to act:
- Do things, don't describe how. When the user asks for an action, call the tool. Chain tools when needed (e.g. search, then update). Never claim something was done unless a tool confirmed it.
- Never invent numbers, names or dates. Every fact about the business comes from a tool result. If a tool says something isn't allowed for their role, tell them plainly.
- Resolve vague references yourself with search / get_client; ask a short question only when it's genuinely ambiguous.
- Some actions (recording payments, adding clients, approving or rejecting leave, bulk planning) come back as "needs confirmation" with a summary. Read the summary back in one sentence and ask "Shall I go ahead?". Only call confirm_action after the user clearly agrees in a new message. If they change details, propose the action again.
- Clocking out needs a one-line end-of-day summary; if they haven't said what they did, ask.
- Dates: convert "today", "tomorrow", "Friday", "next week" to YYYY-MM-DD using the date in the context. Money is Indian rupees; say amounts the Indian way (e.g. "1.2 lakh", "45 thousand").
- Use open_page when the user asks to see or open something, or when showing a screen clearly helps.
- For a daily briefing: lead with the single most important thing, then at most two more, each with the action you recommend; end by offering to do the first one.
- Match the person: founders and managers get strategy; designers, editors and shoot crew get help with their own day and work, not company finances.

How to speak:
- In voice mode your words are read aloud: two to four short sentences, natural spoken English, no markdown, no bullet points, no tables, no emoji, no IDs or URLs. Lead with the answer or your recommendation.
- In text mode be brief and direct; short lists are fine for priorities or several items. Use plain text with "- " for lists, no headings or tables.`;

const DONE_LABELS = { record_payment: 'Payment recorded', create_client: 'Client added', decide_leave: 'Leave decision saved', plan_month: 'Month planned' };
const TOOLS = DEFINITIONS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
const LABELS = {
  get_overview: 'Checking the business', search: 'Searching', get_client: 'Looking up the client', list_tasks: 'Checking tasks', list_invoices: 'Checking invoices', get_team: 'Checking the team',
  get_my_day: 'Checking your day', create_task: 'Creating task', update_task: 'Updating task', record_payment: 'Preparing payment', create_client: 'Preparing new client', update_client: 'Updating client',
  log_feedback: 'Logging feedback', request_leave: 'Requesting leave', decide_leave: 'Preparing leave decision', attendance: 'Updating attendance', draft_reminder: 'Drafting reminder', plan_month: 'Planning the month',
  open_page: 'Opening page', confirm_action: 'Carrying it out', business_review: 'Reviewing the business', remember: 'Remembering', forget: 'Forgetting',
};

/* ---------- Conversations (in memory; append-only so the cached prefix keeps matching) ---------- */
const convos = new Map();
setInterval(() => { const cut = Date.now() - CONVO_TTL; for (const [k, c] of convos) if (c.updatedAt < cut) convos.delete(k); }, 10 * 60 * 1000).unref();
function getConvo(id, user) {
  let c = id && convos.get(id);
  let reset = false;
  if (c && (c.userId !== user.id || c.messages.length > MAX_HISTORY)) { reset = c.userId === user.id; c = null; }
  if (!c) { c = { id: crypto.randomBytes(9).toString('hex'), userId: user.id, messages: [], pending: new Map(), turn: 0, updatedAt: Date.now() }; convos.set(c.id, c); }
  return { convo: c, reset };
}

function contextLine(user, { page, mode }) {
  const now = new Date();
  const when = now.toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `[Context, set by the app — not typed by the user] Now: ${when} (IST); today's date is ${shared.todayISO()}. User: ${user.name}, ${shared.ROLES[user.role].label}. Their screen: ${String(page || '#/dashboard').slice(0, 80)}. Reply mode: ${mode === 'voice' ? 'voice (spoken aloud)' : 'text'}.`;
}

/* Runs one tool call; returns the role:'tool' message that answers it */
async function runTool(call, convo, ctx, send) {
  const name = call.name;
  send({ type: 'tool', id: call.id, name, label: LABELS[name] || name, status: 'running' });
  const result = (content) => ({ role: 'tool', tool_call_id: call.id, content: typeof content === 'string' ? content : JSON.stringify(content) });
  try {
    let input;
    try { input = call.arguments ? JSON.parse(call.arguments) : {}; } catch (e) { throw new ToolError('The tool arguments were not valid JSON — try the call again.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
    if (name === 'confirm_action') {
      const p = convo.pending.get(String(input.confirmation_id || ''));
      if (!p) throw new ToolError('No pending action with that id — propose it again.');
      if (p.turn >= convo.turn) throw new ToolError('The user has not replied yet. Ask them to confirm first, then wait for their answer.');
      convo.pending.delete(p.id);
      const fresh = await IMPL[p.tool](p.input, ctx); // re-validate against current data before acting
      const out = await fresh.run();
      send({ type: 'tool', id: call.id, name: p.tool, label: DONE_LABELS[p.tool] || LABELS[p.tool], status: 'done', summary: fresh.summary });
      return result({ ok: true, ...out });
    }
    if (!IMPL[name]) throw new ToolError(`Unknown tool ${name}`);
    const out = await IMPL[name](input, ctx);
    if (NEEDS_CONFIRMATION.has(name)) {
      const id = `c${crypto.randomBytes(4).toString('hex')}`;
      convo.pending.set(id, { id, tool: name, input, turn: convo.turn });
      send({ type: 'confirm', id, tool: name, summary: out.summary });
      send({ type: 'tool', id: call.id, name, label: LABELS[name], status: 'waiting', summary: out.summary });
      return result({ needs_confirmation: true, confirmation_id: id, summary: out.summary, instruction: 'Read this back to the user and ask them to confirm. Do not call confirm_action until they reply yes.' });
    }
    send({ type: 'tool', id: call.id, name, label: LABELS[name], status: 'done', summary: summarise(name, out) });
    return result(out);
  } catch (e) {
    const msg = e instanceof ToolError || e.status ? e.message : 'Something went wrong running that action.';
    if (!(e instanceof ToolError)) log.error('Assistant tool failed', { tool: name, error: e.message, stack: e.stack });
    send({ type: 'tool', id: call.id, name, label: LABELS[name] || name, status: 'error', summary: msg });
    return result({ error: msg });
  }
}
function summarise(name, out) {
  if (!out || typeof out !== 'object') return '';
  if (out.created && typeof out.created === 'object') return `${out.created.title} — ${out.created.client}`;
  if (name === 'update_task' && out.changes) return `${out.updated.title}: ${out.changes.join(', ')}`;
  if (out.requested) return out.requested;
  if (out.logged) return out.logged;
  if (out.clocked_in) return `Clocked in at ${out.clocked_in}`;
  if (out.clocked_out) return `Clocked out · ${out.hours}h`;
  if (out.on_break) return `On ${out.on_break.toLowerCase()}`;
  if (out.back_from) return `Back from ${out.back_from.toLowerCase()}`;
  if (out.updated) return `${out.updated}: ${(out.changes || []).join(', ')}`;
  if (out.opened) return out.page || out.opened;
  if (out.remembered) return out.remembered;
  if (out.forgot) return out.forgot;
  if (name === 'business_review' && out.signals) return out.signals.length ? `${out.signals.length} thing${out.signals.length > 1 ? 's' : ''} worth attention` : 'All looks healthy';
  if (typeof out.total === 'number') return `${out.total} found`;
  return '';
}

/* Streams one model step; returns the assembled text, tool calls and finish reason */
async function step(messages, mode, send) {
  const stream = await ai().chat.completions.create({
    model: MODEL,
    stream: true,
    max_completion_tokens: 16000,
    ...(REASONING ? { reasoning_effort: effortFor(mode) } : {}),
    prompt_cache_key: 'agencydesk-copilot',
    messages: [{ role: 'system', content: SYSTEM }, ...messages],
    tools: TOOLS,
  });
  let text = '', refusal = '', finish = null;
  const calls = [];
  for await (const chunk of stream) {
    const choice = chunk.choices && chunk.choices[0];
    if (!choice) continue;
    const d = choice.delta || {};
    if (d.content) { text += d.content; send({ type: 'text', delta: d.content }); }
    if (d.refusal) refusal += d.refusal;
    for (const tc of d.tool_calls || []) {
      const c = (calls[tc.index] = calls[tc.index] || { id: '', name: '', arguments: '' });
      if (tc.id) c.id = tc.id;
      if (tc.function && tc.function.name) c.name += tc.function.name;
      if (tc.function && tc.function.arguments) c.arguments += tc.function.arguments;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  return { text, refusal, finish, calls: calls.filter(Boolean) };
}

/* One user turn: stream the model, run tools, repeat until it answers */
async function chat({ user, ip, conversationId, message, mode, page, send }) {
  const { convo, reset } = getConvo(conversationId, user);
  convo.turn++;
  convo.updatedAt = Date.now();
  send({ type: 'start', conversationId: convo.id, reset });
  const ctx = { user, ip, changed: false, navigate: null };
  // Long-term memory rides along on the first turn and whenever it has changed since
  let mem = '';
  if (convo.memoryVersion !== memory.version) {
    mem = `\n[Your long-term memory]\n${memory.describe(await memory.list(user))}`;
    convo.memoryVersion = memory.version;
  }
  convo.messages.push({ role: 'user', content: `${contextLine(user, { page, mode })}${mem}\n\n${String(message).slice(0, 4000)}` });

  for (let n = 0; n < MAX_STEPS; n++) {
    const r = await step(convo.messages, mode, send);
    if (r.refusal || r.finish === 'content_filter') { send({ type: 'text', delta: "Sorry, I can't help with that one." }); break; }
    // A reply cut off mid tool call can't be completed; don't keep it in the history
    if (r.finish === 'length') { send({ type: 'text', delta: ' (That got cut off — try asking for less at once.)' }); break; }
    convo.messages.push({ role: 'assistant', content: r.text || null, ...(r.calls.length ? { tool_calls: r.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}) });
    if (!r.calls.length) break;
    for (const c of r.calls) convo.messages.push(await runTool(c, convo, ctx, send)); // sequential: writes must not race each other
    if (n === MAX_STEPS - 1) send({ type: 'text', delta: ' I had to stop there — that needed too many steps. Could you break it into smaller requests?' });
  }
  if (ctx.navigate) send({ type: 'navigate', route: ctx.navigate });
  send({ type: 'done', changed: ctx.changed, pending: [...convo.pending.values()].filter((p) => p.turn === convo.turn).map((p) => p.id) });
}

/* Friendly messages for API failures (typed SDK errors, most specific first) */
function describeError(e) {
  if (e instanceof OpenAI.AuthenticationError) return 'The AI key on the server is not valid. An admin needs to update OPENAI_API_KEY.';
  if (e instanceof OpenAI.PermissionDeniedError) return 'The AI key does not have access to this model.';
  if (e instanceof OpenAI.NotFoundError) return `The AI model "${MODEL}" isn't available on this OpenAI account. Set AI_MODEL to one you can use.`;
  if (e instanceof OpenAI.RateLimitError) return /quota/i.test(e.message || '') ? 'The OpenAI account has run out of credit. An admin needs to top it up.' : 'The AI is busy right now — please try again in a few seconds.';
  if (e instanceof OpenAI.BadRequestError) return 'The AI could not process that request.';
  if (e instanceof OpenAI.APIConnectionError) return 'Could not reach the AI service. Check the server’s internet connection.';
  if (e instanceof OpenAI.APIError) return `The AI service had a problem (${e.status || 'error'}). Please try again.`;
  return 'Something went wrong. Please try again.';
}

module.exports = { chat, describeError, MODEL };
