import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { z } from 'zod';
import { createJevQaClient } from '../src/server/qa-jev.js';
import { selectQaReview, reviewChecks } from '../src/server/qa-review-plan.js';

const fixture = { request: '주간 매출 보고서를 작성해줘', report: '매출 합계와 전주 비교를 작성했습니다.' };
const config = { enabled: true, apiKey: 'synthetic-key', model: 'jev-1.13.0', timeoutMs: 100, minConfidence: 0.85 };
function answer(profile = 'data', confidence = 0.95) {
  return { model: 'jev-1.13.0', answers: { review_profile: { type: 'choice', choice: profile, confidence,
    probabilities: { code: Number(profile === 'code'), document: Number(profile === 'document'), data: Number(profile === 'data'), general: Number(profile === 'general') } } }, usage: { input_tokens: 123, output_tokens: 12 } };
}
async function withEndpoint(body: unknown, status: number, run: (endpoint: string, requests: unknown[]) => Promise<void>) {
  const requests: unknown[] = [];
  const server = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    requests.push({ method: req.method, authorization: req.headers.authorization, body: JSON.parse(data) });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}/v1/systemone`, requests); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test('Given eligible non-code work, When Jev chooses data, Then route to numeric verification', async () => {
  await withEndpoint(answer(), 200, async (endpoint, requests) => {
    const result = await selectQaReview({ ...fixture, codeChanges: 0 }, config, createJevQaClient(endpoint));
    assert.equal(result.profile, 'data');
    assert.equal(result.reason, 'jev-selected');
    assert.equal(result.model, 'jev-1.13.0');
    assert.equal(result.inputTokens, 123);
    assert.ok(reviewChecks(result.profile).includes('recalculate'));
    assert.ok(!reviewChecks(result.profile).includes('typecheck'));
    assert.equal(requests.length, 1);
    const received = z.object({ method: z.literal('POST'), authorization: z.literal('Bearer synthetic-key'),
      body: z.object({ model: z.literal('jev-1.13.0'), state: z.object({ request: z.string(), report: z.string() }),
        questions: z.object({ review_profile: z.object({ type: z.literal('choice'), criteria: z.object({ code: z.string(), document: z.string(), data: z.string(), general: z.string() }) }) }) }) }).parse(requests[0]);
    assert.deepEqual(received.body.state, fixture);
  });
});

test('Given document or general work, When selected, Then use the matching verification checks', async () => {
  for (const profile of ['document', 'general']) {
    await withEndpoint(answer(profile), 200, async (endpoint) => {
      const result = await selectQaReview({ ...fixture, codeChanges: 0 }, config, createJevQaClient(endpoint));
      assert.equal(result.profile, profile);
      assert.ok(reviewChecks(result.profile).includes('requirements'));
      assert.ok(!reviewChecks(result.profile).includes('typecheck'));
    });
  }
});

test('Given an unresponsive provider, When deadline expires, Then preserve QA', async () => {
  const server = createServer(() => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const result = await selectQaReview({ ...fixture, codeChanges: 0 }, config,
      createJevQaClient(`http://127.0.0.1:${address.port}`));
    assert.equal(result.profile, 'code');
    assert.equal(result.reason, 'timeout');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Given mandatory or disabled work, When selecting QA, Then no provider call and code checklist remains', async () => {
  await withEndpoint(answer(), 200, async (endpoint, requests) => {
    for (const codeChanges of [null, 1]) {
      const result = await selectQaReview({ ...fixture, codeChanges }, config, createJevQaClient(endpoint));
      assert.equal(result.profile, 'code');
      assert.equal(result.reason, 'code-review-floor');
    }
    for (const settings of [{ ...config, enabled: false }, { ...config, apiKey: '' }]) {
      const result = await selectQaReview({ ...fixture, codeChanges: 0 }, settings, createJevQaClient(endpoint));
      assert.equal(result.profile, 'code');
    }
    assert.equal(requests.length, 0);
  });
});

test('Given low confidence or malformed response, When selecting QA, Then retain legacy checklist', async () => {
  for (const body of [answer('data', 0.6), answer('skip'), {}, answer('data', 2)]) {
    await withEndpoint(body, 200, async (endpoint) => {
      const result = await selectQaReview({ ...fixture, codeChanges: 0 }, config, createJevQaClient(endpoint));
      assert.equal(result.profile, 'code');
      assert.notEqual(result.reason, 'jev-selected');
    });
  }
});

test('Given API failure, When selecting QA, Then fallback without retry or secret in metadata', async () => {
  await withEndpoint({ error: 'synthetic-key raw request secret' }, 429, async (endpoint, requests) => {
    const result = await selectQaReview({ ...fixture, codeChanges: 0 }, config, createJevQaClient(endpoint));
    assert.equal(result.profile, 'code');
    assert.equal(result.reason, 'http-error');
    assert.equal(requests.length, 1);
    assert.ok(!JSON.stringify(result).includes('synthetic-key'));
  });
});

test('Given missing context, When selecting QA, Then no provider call', async () => {
  await withEndpoint(answer(), 200, async (endpoint, requests) => {
    const result = await selectQaReview({ ...fixture, report: '', codeChanges: 0 }, config, createJevQaClient(endpoint));
    assert.equal(result.profile, 'code');
    assert.equal(requests.length, 0);
  });
});

// 2026-09-26 0단계 보정: 큰 보고서는 폴백 대신 마스킹 후 2,000자로 줄여 보낸다(jev-decisions/docs/data-handling.md 2장).
test('Given excessive context, When selecting QA, Then send a bounded payload once', async () => {
  await withEndpoint(answer(), 200, async (endpoint, requests) => {
    await selectQaReview({ ...fixture, report: 'x'.repeat(12001), codeChanges: 0 }, config, createJevQaClient(endpoint));
    assert.equal(requests.length, 1);
    const body = JSON.stringify(requests[0]);
    assert.ok(body.length < 6000, `payload not bounded: ${body.length}`);
  });
});
