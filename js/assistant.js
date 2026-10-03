/* ==========================================================================
   assistant.js — AI co-founder: a business partner you talk or type to. It
   watches the numbers (signals badge, daily briefing), gives strategic advice,
   remembers the agency's goals, and acts in AgencyDesk on your behalf.
   Voice in: browser speech recognition (Chrome, Edge, Safari).
   Voice out: browser speech synthesis, spoken sentence-by-sentence while
   the reply is still streaming. Hands-free mode keeps the conversation going.
   ========================================================================== */

const Assistant = {
  el: null, open: false, busy: false, convoId: null, msgs: [], handsFree: false, muted: false,
  rec: null, listening: false, lastMode: 'text', speakQueue: [], speakBuf: '', speaking: false, quietStrikes: 0, abort: null, signals: [],

  available() {
    const u = Store.currentUser && Store.currentUser();
    return Api.mode === 'server' && u && u.role !== 'client' && Api.info.aiEnabled;
  },
  storage(key, val) {
    try { if (val === undefined) return JSON.parse(sessionStorage.getItem('agencyDesk.ai.' + key)); sessionStorage.setItem('agencyDesk.ai.' + key, JSON.stringify(val)); } catch (e) { return null; }
  },

  /* Called after every screen render */
  async mount() {
    if (Api.mode !== 'server') return;
    if (Api.info.aiEnabled === undefined) { try { Object.assign(Api.info, await Api.req('GET', '/setup-status')); } catch (e) { return; } }
    if (!this.available()) return this.unmount();
    if (this.el) return;
    this.handsFree = false;
    this.muted = !!this.storage('muted');
    this.convoId = this.storage('convo');
    this.msgs = this.storage('msgs') || [];
    const root = document.createElement('div');
    root.className = 'ai-root';
    root.innerHTML = `
      <button class="ai-fab" aria-label="Open AI co-founder (Ctrl+J)" title="AI co-founder (Ctrl+J)">${icon('sparkle')}<span class="ai-fab-ring"></span><span class="ai-badge" hidden></span></button>
      <section class="ai-panel" role="dialog" aria-label="AI co-founder" hidden>
        <header class="ai-head">
          <div class="ai-title"><span class="ai-orb"></span><div><b>Co-founder</b><span class="ai-state" aria-live="polite">Ready</span></div></div>
          <div class="ai-head-actions">
            <button class="icon-btn ai-hf" title="Hands-free conversation" aria-pressed="false" aria-label="Hands-free conversation">${aiIcon('headset')}</button>
            <button class="icon-btn ai-mute" title="Voice replies" aria-pressed="${!this.muted}" aria-label="Voice replies">${aiIcon(this.muted ? 'mute' : 'speaker')}</button>
            <button class="icon-btn ai-new" title="New conversation" aria-label="New conversation">${icon('restore')}</button>
            <button class="icon-btn ai-close" title="Close" aria-label="Close">${icon('x')}</button>
          </div>
        </header>
        <div class="ai-log" aria-live="polite"></div>
        <form class="ai-input">
          <button type="button" class="ai-mic" aria-label="Hold or tap to talk" title="Tap to talk">${aiIcon('mic')}<span class="ai-mic-ring"></span></button>
          <input name="q" autocomplete="off" placeholder="Ask for advice, or tell me to do something…" aria-label="Message the co-founder">
          <button type="submit" class="icon-btn ai-send" aria-label="Send">${icon('send')}</button>
        </form>
      </section>`;
    document.body.appendChild(root);
    this.el = root;
    const $r = (s) => root.querySelector(s);
    $r('.ai-fab').onclick = () => this.toggle(true);
    $r('.ai-close').onclick = () => this.toggle(false);
    $r('.ai-new').onclick = () => this.reset();
    $r('.ai-mute').onclick = () => { this.muted = !this.muted; this.storage('muted', this.muted); if (this.muted) this.stopSpeaking(); this.syncButtons(); };
    $r('.ai-hf').onclick = () => this.setHandsFree(!this.handsFree);
    $r('.ai-mic').onclick = () => (this.listening ? this.stopListening() : this.listen());
    $r('.ai-input').onsubmit = (e) => { e.preventDefault(); const q = $r('[name=q]').value.trim(); if (q) { $r('[name=q]').value = ''; this.send(q, 'text'); } };
    root.addEventListener('click', (e) => {
      const s = e.target.closest('[data-suggest]'); if (s) this.send(s.dataset.suggest, 'text');
      const b = e.target.closest('[data-briefing]'); if (b) this.briefing();
      const c = e.target.closest('[data-confirm]'); if (c) { c.closest('.ai-confirm').classList.add('decided'); this.send(c.dataset.confirm === 'yes' ? 'Yes, go ahead.' : 'No, cancel that.', this.lastMode); }
    });
    if (!this.recognitionSupported()) $r('.ai-mic').hidden = true, $r('.ai-hf').hidden = true;
    this.renderLog();
    if (this.storage('open')) this.toggle(true);
    this.loadSignals();
  },
  /* What needs attention right now — rules on the server, no AI call, so it's free to refresh */
  async loadSignals() {
    try { this.signals = (await Api.req('GET', '/assistant/signals')).signals || []; } catch (e) { this.signals = []; }
    if (!this.el) return;
    const n = this.signals.filter((x) => x.severity !== 'low').length, badge = this.el.querySelector('.ai-badge');
    badge.hidden = !n; badge.textContent = n > 9 ? '9+' : n;
    badge.classList.toggle('hot', this.signals.some((x) => x.severity === 'high'));
    this.el.querySelector('.ai-fab').title = n ? `AI co-founder — ${n} thing${n > 1 ? 's' : ''} worth your attention (Ctrl+J)` : 'AI co-founder (Ctrl+J)';
    if (!this.msgs.length) this.renderLog();
  },
  /* Founders and managers get a briefing the first time they open the panel each day */
  briefingKey() { return 'agencyDesk.ai.briefed.' + Store.currentUser().id; },
  briefedToday() { try { return localStorage.getItem(this.briefingKey()) === todayISO(); } catch (e) { return true; } },
  briefing() {
    try { localStorage.setItem(this.briefingKey(), todayISO()); } catch (e) {}
    this.send('Give me my daily briefing: what matters most today and what you recommend.', 'text', 'Daily briefing');
  },
  unmount() { this.stopListening(); this.stopSpeaking(); if (this.abort) this.abort.abort(); if (this.el) { this.el.remove(); this.el = null; } this.open = false; },
  reset() {
    this.stopSpeaking(); this.convoId = null; this.msgs = []; this.storage('convo', null); this.storage('msgs', []);
    this.renderLog(); this.el.querySelector('[name=q]').focus();
  },
  toggle(show) {
    if (!this.el) return;
    this.open = show;
    this.storage('open', show);
    this.el.querySelector('.ai-panel').hidden = !show;
    this.el.querySelector('.ai-fab').hidden = show;
    if (show) {
      setTimeout(() => this.el && this.el.querySelector('[name=q]').focus(), 30);
      if (['admin', 'pm', 'finance'].includes(Store.currentUser().role) && !this.busy && !this.briefedToday()) this.briefing();
    }
    else { this.setHandsFree(false); this.stopListening(); this.stopSpeaking(); }
  },
  setState(text, cls = '') {
    if (!this.el) return;
    const s = this.el.querySelector('.ai-state'); s.textContent = text;
    this.el.querySelector('.ai-panel').dataset.state = cls;
    this.el.querySelector('.ai-fab').dataset.state = cls;
  },
  syncButtons() {
    if (!this.el) return;
    const hf = this.el.querySelector('.ai-hf'), mu = this.el.querySelector('.ai-mute');
    hf.setAttribute('aria-pressed', this.handsFree); hf.classList.toggle('on', this.handsFree);
    mu.setAttribute('aria-pressed', !this.muted); mu.innerHTML = aiIcon(this.muted ? 'mute' : 'speaker');
  },
  setHandsFree(on) {
    this.handsFree = on;
    this.quietStrikes = 0;
    this.syncButtons();
    if (on) { if (this.muted) { this.muted = false; this.storage('muted', false); this.syncButtons(); } this.speak('I’m listening.', true); }
    else this.stopListening();
  },

  /* ---------- Conversation log ---------- */
  suggestions() {
    const r = Store.currentUser().role;
    return {
      admin: ['How is the business really doing?', 'Which clients aren’t worth what they cost us?', 'Can we take on another client without hiring?', 'Who might churn, and how do we save them?', 'Set a goal: 5 lakh monthly revenue by March'],
      pm: ['How are my clients doing this month?', 'Which account is most at risk, and what should I do?', 'Is anyone on my team overloaded?', 'Create a reel for Apollo due this Friday'],
      creative: ['Clock me in', 'What’s due today?', 'Move my latest poster to internal review', 'I’m going for lunch'],
      shoot: ['What shoots are coming up?', 'Clock me in', 'Which shoots are missing raw files?'],
      finance: ['Why are collections slipping?', 'Which overdue payments should I chase first?', 'Draft a reminder for the oldest overdue invoice', 'Record 50,000 from Spice Route by UPI'],
    }[r] || [];
  },
  renderLog() {
    if (!this.el) return;
    const log = this.el.querySelector('.ai-log');
    if (!this.msgs.length) {
      const u = Store.currentUser(), lead = ['admin', 'pm', 'finance'].includes(u.role);
      const sig = this.signals.slice(0, 5);
      log.innerHTML = `<div class="ai-empty"><span class="ai-orb big"></span><h3>Hi ${esc(firstName(u.name))}, ${lead ? 'here’s what I’m watching' : 'what can I do for you?'}</h3>
        ${sig.length ? `<div class="ai-signals">${sig.map((x) => `<button class="ai-signal ${x.severity}" data-suggest="${esc(x.ask)}"><i></i><span><b>${esc(x.title)}</b><small>${esc(x.detail)}</small></span>${icon('chevronR')}</button>`).join('')}</div>` : ''}
        ${lead ? '<button class="btn btn-sm btn-primary ai-brief-btn" data-briefing="1">' + icon('sparkle') + 'Brief me on today</button>' : ''}
        <p class="muted small">${lead ? 'Ask me how the business is doing, what to fix first, or what-ifs like raising a fee or hiring. I can also do the work: tasks, payments, leave, reminders.' : 'Talk or type. I can look things up, create and move tasks, handle leave and attendance, and open any page.'}${this.recognitionSupported() ? ' Tap the mic, or turn on hands-free mode to keep chatting.' : ''}</p>
        <div class="ai-suggest">${this.suggestions().map((s) => `<button class="chip-btn" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
      return;
    }
    log.innerHTML = this.msgs.map((m) => this.msgHtml(m)).join('');
    log.scrollTop = log.scrollHeight;
  },
  msgHtml(m) {
    if (m.role === 'user') return `<div class="ai-msg user"><div class="ai-bubble">${esc(m.text)}</div></div>`;
    const tools = (m.tools || []).map((t) => `<div class="ai-tool ${t.status}">${t.status === 'running' ? '<span class="ai-spin"></span>' : t.status === 'error' ? icon('alert') : t.status === 'waiting' ? icon('clock') : icon('check')}<span><b>${esc(t.label)}</b>${t.summary ? ` · ${esc(t.summary)}` : ''}</span></div>`).join('');
    const confirms = (m.confirms || []).map((c) => `<div class="ai-confirm ${c.decided ? 'decided' : ''}"><div>${icon('shield')} <b>Please confirm</b></div><p>${esc(c.summary)}</p>
      <div class="row-actions"><button class="btn btn-sm" data-confirm="no">Cancel</button><button class="btn btn-sm btn-primary" data-confirm="yes">${icon('check')}Confirm</button></div></div>`).join('');
    return `<div class="ai-msg bot">${tools}${m.text ? `<div class="ai-bubble">${formatAi(m.text)}</div>` : ''}${confirms}${m.error ? `<div class="ai-error">${icon('alert')} ${esc(m.error)}</div>` : ''}${!m.text && !m.error && m.pending ? '<div class="ai-bubble ai-typing"><i></i><i></i><i></i></div>' : ''}</div>`;
  },
  save() { this.storage('msgs', this.msgs.slice(-40)); },

  /* ---------- Sending & streaming ---------- */
  async send(text, mode, label) {
    if (this.busy) { if (this.abort) this.abort.abort(); }
    this.stopSpeaking(); this.stopListening();
    this.lastMode = mode;
    this.msgs.forEach((m) => (m.confirms || []).forEach((c) => (c.decided = true)));
    this.msgs.push({ role: 'user', text: label || text });
    const bot = { role: 'bot', text: '', tools: [], confirms: [], pending: true };
    this.msgs.push(bot);
    this.renderLog();
    this.busy = true; this.setState('Thinking…', 'thinking');
    try { await Api.flush(); } catch (e) {} // save any edits first so the co-pilot sees them
    const ctl = new AbortController(); this.abort = ctl;
    let changed = false, navigate = null;
    const speakIt = mode === 'voice' && !this.muted;
    try {
      const res = await fetch(Api.base + '/api/assistant', { method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Api.token },
        body: JSON.stringify({ message: text, conversationId: this.convoId, mode, page: location.hash }) });
      if (!(res.headers.get('content-type') || '').includes('event-stream')) {
        const j = await res.json().catch(() => ({}));
        if (res.status === 401) { Api.signOut('Please sign in again.'); return; }
        throw new Error(j.error || `The co-pilot isn’t available right now (${res.status}).`);
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith('data: ')) continue;
          const ev = JSON.parse(chunk.slice(6));
          if (ev.type === 'start') { this.convoId = ev.conversationId; this.storage('convo', ev.conversationId); if (ev.reset) toast('Started a fresh conversation — the last one got long.', 'warn'); }
          else if (ev.type === 'text') { bot.text += ev.delta; if (speakIt) this.feedSpeech(ev.delta); this.setState(speakIt && this.speaking ? 'Speaking…' : 'Replying…', speakIt ? 'speaking' : 'thinking'); }
          else if (ev.type === 'tool') {
            const t = bot.tools.find((x) => x.id === ev.id);
            if (t) Object.assign(t, ev); else bot.tools.push({ ...ev });
            this.setState(ev.status === 'running' ? `${ev.label}…` : 'Thinking…', 'thinking');
          } else if (ev.type === 'confirm') bot.confirms.push({ id: ev.id, summary: ev.summary });
          else if (ev.type === 'navigate') navigate = ev.route;
          else if (ev.type === 'error') bot.error = ev.message;
          else if (ev.type === 'done') changed = ev.changed;
          this.renderLog();
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') { bot.text = bot.text || '(stopped)'; }
      else bot.error = e.message;
    } finally {
      bot.pending = false; this.busy = false; this.abort = null;
      this.renderLog(); this.save();
      if (speakIt) this.feedSpeech('', true);
      if (bot.error && speakIt) this.speak(bot.error);
    }
    if (changed) { try { await Store.load(); } catch (e) {} this.loadSignals(); }
    if (navigate && navigate !== location.hash) location.hash = navigate;
    else if (changed) Router.render();
    if (!this.speaking) this.afterReply();
  },
  /* Hands-free: start listening again once the reply has been spoken */
  afterReply() {
    this.setState('Ready', '');
    if (this.handsFree && this.open) setTimeout(() => { if (this.handsFree && !this.busy && !this.speaking) this.listen(); }, 250);
  },

  /* ---------- Voice in ---------- */
  recognitionSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
  listen() {
    if (!this.recognitionSupported() || this.listening) return;
    this.stopSpeaking(); // barge-in: talking over the co-pilot stops it
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new R();
    rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    const input = this.el.querySelector('[name=q]');
    let finalText = '';
    rec.onstart = () => { this.listening = true; this.setState('Listening…', 'listening'); this.el.querySelector('.ai-mic').classList.add('on'); };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
      input.value = (finalText + interim).trim();
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Microphone access is blocked — allow it in the browser’s address bar, then try again.', 'error'); this.setHandsFree(false); }
      else if (e.error === 'no-speech') { if (this.handsFree && ++this.quietStrikes >= 2) { this.setHandsFree(false); toast('Hands-free paused — tap the mic when you need me.'); } }
      else if (e.error !== 'aborted') toast('Couldn’t hear that clearly — try again or type it.', 'warn');
    };
    rec.onend = () => {
      this.listening = false; this.rec = null;
      if (!this.el) return;
      this.el.querySelector('.ai-mic').classList.remove('on');
      const said = (finalText || input.value).trim();
      if (said) { this.quietStrikes = 0; input.value = ''; this.send(said, 'voice'); }
      else { this.setState('Ready', ''); if (this.handsFree && this.open && !this.busy) setTimeout(() => this.listen(), 300); }
    };
    this.rec = rec;
    try { rec.start(); } catch (e) { this.listening = false; }
  },
  stopListening() { if (this.rec) { try { this.rec.abort(); } catch (e) {} this.rec = null; } this.listening = false; if (this.el) this.el.querySelector('.ai-mic').classList.remove('on'); },

  /* ---------- Voice out ---------- */
  voice() {
    if (this._voice !== undefined) return this._voice;
    const vs = speechSynthesis.getVoices();
    if (!vs.length) return null;
    const score = (v) => (v.lang === 'en-IN' ? 40 : /^en-(GB|US|AU)/.test(v.lang) ? 20 : /^en/.test(v.lang) ? 10 : 0)
      + (/natural|neural|premium|enhanced/i.test(v.name) ? 15 : 0) + (/google/i.test(v.name) ? 8 : 0) + (/samantha|veena|rishi|aria|jenny|neerja|prabhat/i.test(v.name) ? 6 : 0) + (v.localService ? 1 : 0);
    this._voice = vs.slice().sort((a, b) => score(b) - score(a))[0] || null;
    return this._voice;
  },
  /* Speak finished sentences while the rest of the reply is still arriving */
  feedSpeech(delta, flush = false) {
    if (!('speechSynthesis' in window)) return;
    this.speakBuf += delta;
    const re = /[^.!?\n]+[.!?]+(?=\s|$)|[^\n]+\n/g;
    let m, last = 0;
    while ((m = re.exec(this.speakBuf))) { this.speak(m[0]); last = re.lastIndex; }
    this.speakBuf = this.speakBuf.slice(last);
    if (flush && this.speakBuf.trim()) { this.speak(this.speakBuf); this.speakBuf = ''; }
  },
  speak(text, isPrompt = false) {
    if (!('speechSynthesis' in window) || (this.muted && !isPrompt)) return;
    const clean = String(text).replace(/https?:\/\/\S+/g, '').replace(/[*_#`>|~]/g, '').replace(/₹\s?/g, 'rupees ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    const v = this.voice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-IN';
    u.rate = 1.05; u.pitch = 1;
    u.onstart = () => { this.speaking = true; this.setState('Speaking…', 'speaking'); };
    u.onend = u.onerror = () => {
      this.speakQueue.shift();
      if (!this.speakQueue.length) { this.speaking = false; if (!this.busy) this.afterReply(); }
    };
    this.speakQueue.push(u);
    this.speaking = true;
    speechSynthesis.speak(u);
  },
  stopSpeaking() { this.speakQueue = []; this.speakBuf = ''; this.speaking = false; if ('speechSynthesis' in window) speechSynthesis.cancel(); },
};

/* Plain text with light formatting: line breaks and "- " lists only */
function formatAi(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-•] (.+)(?:\n|$)/gm, '<span class="ai-li">$1</span>').replace(/\n/g, '<br>');
}
function aiIcon(name) {
  const p = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    speaker: '<path d="M4 10v4h4l5 4V6L8 10zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 10v4h4l5 4V6L8 10zM17 10l4 4M21 10l-4 4"/>',
  }[name];
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { Assistant._voice = undefined; };
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j' && Assistant.el) { e.preventDefault(); Assistant.toggle(!Assistant.open); }
  if (e.key === 'Escape' && Assistant.open && !Modal.el) Assistant.toggle(false);
});
