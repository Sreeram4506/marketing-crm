/* A stand-in for the OpenAI Chat Completions API used by the assistant tests. Replies are
   scripted per test and streamed as chunks in the same Server-Sent Events format as the real API. */
const http = require('http');

function createMock() {
  const state = { queue: [], requests: [], errors: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!req.url.startsWith('/v1/chat/completions')) { res.writeHead(404); return res.end('{}'); }
      const json = JSON.parse(body || '{}');
      state.requests.push({ url: req.url, headers: req.headers, body: json });
      let next = state.queue.shift() || { text: 'OK.' };
      try {
        if (typeof next === 'function') next = next(json);
      } catch (e) {
        state.errors.push(e); // a scripted check failed: record it and answer so the request doesn't hang
        next = { text: 'MOCK CHECK FAILED: ' + e.message };
      }
      if (next.status) { res.writeHead(next.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: next.message, type: 'invalid_request_error' } })); }
      stream(res, next, json.model);
    });
  });
  return {
    state,
    reply: (...responses) => state.queue.push(...responses),
    text: (t) => ({ text: t }),
    tool: (name, input, lead) => ({ text: lead || '', tool_calls: [{ id: 'call_' + Math.random().toString(36).slice(2, 10), name, arguments: JSON.stringify(input) }] }),
    refusal: (r) => ({ refusal: r }),
    lastToolResult: (body) => { const m = body.messages[body.messages.length - 1]; return m && m.role === 'tool' ? { ...m, data: JSON.parse(m.content) } : null; },
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => server.close(),
  };
}

function stream(res, msg, model) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'x-request-id': 'req_mock' });
  const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };
  const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  chunk({ role: 'assistant', content: '' });
  if (msg.refusal) chunk({ refusal: msg.refusal });
  for (const piece of (msg.text || '').match(/.{1,12}/gs) || []) chunk({ content: piece });
  (msg.tool_calls || []).forEach((c, index) => {
    chunk({ tool_calls: [{ index, id: c.id, type: 'function', function: { name: c.name, arguments: '' } }] });
    for (const piece of c.arguments.match(/.{1,20}/gs) || []) chunk({ tool_calls: [{ index, function: { arguments: piece } }] });
  });
  chunk({}, msg.finish_reason || (msg.tool_calls ? 'tool_calls' : 'stop'));
  res.write('data: [DONE]\n\n');
  res.end();
}

module.exports = { createMock };
