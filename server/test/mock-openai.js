/* A stand-in for the OpenAI Responses API used by the assistant tests. Replies are scripted per
   test and streamed as Server-Sent Events in the same format as the real API. Like the real API,
   it refuses Chat Completions requests that combine tools with reasoning for GPT-5.x models. */
const http = require('http');

function createMock() {
  const state = { queue: [], requests: [], errors: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      if (req.url.startsWith('/v1/chat/completions')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: `Function tools with reasoning_effort are not supported for ${json.model} in /v1/chat/completions. Please use /v1/responses instead.`, type: 'invalid_request_error' } }));
      }
      if (!req.url.startsWith('/v1/responses')) { res.writeHead(404); return res.end('{}'); }
      state.requests.push({ url: req.url, headers: req.headers, body: json });
      let next = state.queue.shift() || { text: 'OK.' };
      try {
        if (typeof next === 'function') next = next(json);
      } catch (e) {
        state.errors.push(e); // a scripted check failed: record it and answer so the request doesn't hang
        next = { text: 'MOCK CHECK FAILED: ' + e.message };
      }
      if (next.status) { res.writeHead(next.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: next.message, type: 'invalid_request_error' } })); }
      stream(res, next, json);
    });
  });
  return {
    state,
    reply: (...responses) => state.queue.push(...responses),
    text: (t) => ({ text: t }),
    tool: (name, input, lead) => ({ text: lead || '', tool_calls: [{ call_id: 'call_' + Math.random().toString(36).slice(2, 10), name, arguments: JSON.stringify(input) }] }),
    refusal: (r) => ({ refusal: r }),
    lastToolResult: (body) => { const m = body.input[body.input.length - 1]; return m && m.type === 'function_call_output' ? { ...m, data: JSON.parse(m.output) } : null; },
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => server.close(),
  };
}

let seq = 0;
function stream(res, msg, req) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'x-request-id': 'req_mock' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`);
  const base = { id: 'resp_mock', object: 'response', created_at: Math.floor(Date.now() / 1000), model: req.model, status: 'in_progress', output: [] };
  ev('response.created', { response: base });
  const output = [];
  if (req.reasoning) output.push({ type: 'reasoning', id: 'rs_' + seq, summary: [], encrypted_content: 'enc_mock' });
  if (msg.refusal) output.push({ type: 'message', id: 'msg_' + seq, role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: msg.refusal }] });
  if (msg.text) {
    const index = output.length;
    for (const piece of msg.text.match(/.{1,12}/gs)) ev('response.output_text.delta', { item_id: 'msg_x', output_index: index, content_index: 0, delta: piece, logprobs: [] });
    output.push({ type: 'message', id: 'msg_' + seq, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: msg.text, annotations: [] }] });
  }
  for (const c of msg.tool_calls || []) {
    const item = { type: 'function_call', id: 'fc_' + seq, call_id: c.call_id, name: c.name, arguments: c.arguments, status: 'completed' };
    ev('response.output_item.done', { output_index: output.length, item });
    output.push(item);
  }
  const final = { ...base, status: msg.incomplete ? 'incomplete' : 'completed', incomplete_details: msg.incomplete ? { reason: msg.incomplete } : null, output };
  ev(msg.incomplete ? 'response.incomplete' : 'response.completed', { response: final });
  res.end();
}

module.exports = { createMock };
