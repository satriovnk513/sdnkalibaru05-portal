// Run: node --test tests/*.test.mjs
// Exercises api/chat.js with a mocked fetch — never calls the real Gemini API.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'test-key-not-real';
delete process.env.VERCEL_ENV;
const { default: handler } = await import('../api/chat.js');

const ORIGIN = 'https://sdnkalibaru05.sch.id';
let ipCounter = 0;

function mockFetch(responses) {
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, payload: JSON.parse(options.body) });
        const next = responses[Math.min(calls.length - 1, responses.length - 1)];
        return { ok: next.status === 200, status: next.status, json: async () => next.body };
    };
    return calls;
}

async function call({ method = 'POST', origin = ORIGIN, body, ip } = {}) {
    const result = { headers: {} };
    const res = {
        setHeader(k, v) { result.headers[k.toLowerCase()] = v; },
        status(n) { result.status = n; return this; },
        json(obj) { result.body = obj; return this; },
        end() { return this; }
    };
    const headers = { 'x-forwarded-for': ip || `10.0.0.${++ipCounter}` };
    if (origin) headers.origin = origin;
    await handler({ method, headers, body }, res);
    return result;
}

const ok = { status: 200, body: { candidates: [{ content: { parts: [{ text: 'Halo ' }, { text: 'dunia' }] } }] } };
const userMsg = { messages: [{ role: 'system', content: 'Kamu KaliBot' }, { role: 'user', content: 'Halo' }] };

test('rejects requests from other origins without calling Gemini', async () => {
    const calls = mockFetch([ok]);
    const r = await call({ origin: 'https://evil.example', body: userMsg });
    assert.equal(r.status, 403);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(calls.length, 0);
});

test('rejects requests without an Origin header', async () => {
    const calls = mockFetch([ok]);
    const r = await call({ origin: null, body: userMsg });
    assert.equal(r.status, 403);
    assert.equal(calls.length, 0);
});

test('rejects invalid or empty message payloads', async () => {
    const calls = mockFetch([ok]);
    for (const body of [{}, { messages: [] }, { messages: [{ role: 'hacker', content: 'x' }] },
        { messages: [{ role: 'system', content: 'only system' }] },
        { messages: [{ role: 'user', content: 'x'.repeat(24001) }] },
        { messages: Array.from({ length: 21 }, () => ({ role: 'user', content: 'hi' })) }]) {
        const r = await call({ body });
        assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(calls.length, 0);
});

test('valid request: server picks model, caps output, joins all text parts', async () => {
    const calls = mockFetch([ok]);
    const r = await call({ body: { ...userMsg, model: 'some-expensive-model', max_tokens: 999999 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.choices[0].message.content, 'Halo dunia');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(calls[0].payload.generationConfig.maxOutputTokens, 4096);
    assert.equal(calls[0].payload.systemInstruction.parts[0].text, 'Kamu KaliBot');
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
});

test('falls back to the next model on 503 and stops on success', async () => {
    const calls = mockFetch([{ status: 503, body: { error: { message: 'high demand' } } }, ok]);
    const r = await call({ body: userMsg });
    assert.equal(r.status, 200);
    assert.equal(calls.length, 2);
});

test('does not retry a plain 400 and hides upstream details', async () => {
    const calls = mockFetch([{ status: 400, body: { error: { message: 'API key not valid', status: 'INVALID_ARGUMENT' } } }]);
    const r = await call({ body: userMsg });
    assert.equal(r.status, 502);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(r.body.error.message, /API key/);
});

test('rate-limits a single IP after 20 requests', async () => {
    mockFetch([ok]);
    const ip = '203.0.113.7';
    for (let i = 0; i < 20; i++) assert.equal((await call({ body: userMsg, ip })).status, 200);
    const r = await call({ body: userMsg, ip });
    assert.equal(r.status, 429);
    assert.ok(r.headers['retry-after']);
});

test('preflight only succeeds for allowed origins', async () => {
    assert.equal((await call({ method: 'OPTIONS' })).status, 204);
    assert.equal((await call({ method: 'OPTIONS', origin: 'https://evil.example' })).status, 403);
});
