// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, HttpResponse, HttpTransport } from '../src/api/http';
import { normalizeBaseUrl, RefinrClient } from '../src/api/refinr-client';

const BASE = 'http://localhost:8080';
const KEY = 'test-key-not-a-secret';

/** Transport answering from a table `path -> response`, recording every request. */
function fakeTransport(answers: Record<string, HttpResponse | Error>): HttpTransport & { requests: HttpRequest[] } {
	const requests: HttpRequest[] = [];
	const transport = (request: HttpRequest) => {
		requests.push(request);
		const answer = answers[request.url.slice(BASE.length)];
		if (answer === undefined) {
			return Promise.reject(new Error(`unexpected ${request.url}`));
		}
		return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
	};
	return Object.assign(transport, { requests });
}

function json(status: number, body: unknown): HttpResponse {
	return { status, text: JSON.stringify(body) };
}

function client(transport: HttpTransport, apiKey: string | null = null, checkTimeoutMs?: number): RefinrClient {
	return new RefinrClient({ baseUrl: BASE, apiKey: () => apiKey, transport, checkTimeoutMs });
}

afterEach(() => {
	vi.useRealTimers();
});

describe('successful answers (200)', () => {
	it('reads health, source (with maxContentChars) and tracker', async () => {
		const transport = fakeTransport({
			'/api/v1/health': json(200, {
				status: 'DEGRADED',
				services: { confluence: { status: 'UP' }, ai: { status: 'DOWN', provider: 'anthropic' } },
			}),
			'/api/v1/source': json(200, { name: 'Confluence', maxContentChars: 200000 }),
			'/api/v1/tracker': json(200, { name: 'Jira' }),
		});
		const refinr = client(transport);

		await expect(refinr.health()).resolves.toEqual({
			ok: true,
			value: {
				status: 'DEGRADED',
				services: {
					confluence: { status: 'UP', details: {} },
					ai: { status: 'DOWN', details: { provider: 'anthropic' } },
				},
			},
		});
		await expect(refinr.source()).resolves.toEqual({ ok: true, value: { name: 'Confluence', maxContentChars: 200000 } });
		await expect(refinr.tracker()).resolves.toEqual({ ok: true, value: { name: 'Jira' } });
		expect(transport.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
			`GET ${BASE}/api/v1/health`,
			`GET ${BASE}/api/v1/source`,
			`GET ${BASE}/api/v1/tracker`,
		]);
	});

	it('rejects a 200 that is not a Refinr answer', async () => {
		const transport = fakeTransport({
			'/api/v1/source': { status: 200, text: '<html>login</html>' },
			'/api/v1/tracker': json(200, { title: 'not refinr' }),
		});
		await expect(client(transport).source()).resolves.toEqual({ ok: false, error: { kind: 'invalid-response', status: 200 } });
		await expect(client(transport).tracker()).resolves.toEqual({ ok: false, error: { kind: 'invalid-response', status: 200 } });
	});

	it('rejects a source without a usable maxContentChars', async () => {
		const transport = fakeTransport({ '/api/v1/source': json(200, { name: 'Confluence', maxContentChars: 0 }) });
		const result = await client(transport).source();
		expect(result.ok).toBe(false);
	});
});

describe('API key', () => {
	it('sends X-API-Key only when a key is available', async () => {
		const withKey = fakeTransport({ '/api/v1/source': json(200, { name: 'XWiki', maxContentChars: 10 }) });
		await client(withKey, KEY).source();
		expect(withKey.requests[0]?.headers['X-API-Key']).toBe(KEY);

		for (const key of [null, '']) {
			const without = fakeTransport({ '/api/v1/source': json(200, { name: 'XWiki', maxContentChars: 10 }) });
			await client(without, key).source();
			expect(without.requests[0]?.headers).not.toHaveProperty('X-API-Key');
		}
	});

	it('never puts the key in an error detail', async () => {
		const transport = fakeTransport({ '/api/v1/source': new Error(`connect failed, header X-API-Key: ${KEY}`) });
		const result = await client(transport, KEY).source();
		expect(JSON.stringify(result)).not.toContain(KEY);
		expect(result).toEqual({ ok: false, error: { kind: 'network', detail: 'connect failed, header X-API-Key: ***' } });
	});
});

describe('error answers', () => {
	const cases: Array<[string, HttpResponse, object]> = [
		[
			'400 keeps Refinr message and correlation id',
			json(400, { success: false, error: 'documentId is required', correlationId: 'c-400' }),
			{ kind: 'http', status: 400, detail: 'documentId is required', correlationId: 'c-400' },
		],
		[
			'401 is a rejected or missing key',
			json(401, { success: false, error: 'Missing or invalid API key', correlationId: 'c-401' }),
			{ kind: 'unauthorized', status: 401, detail: 'Missing or invalid API key', correlationId: 'c-401' },
		],
		[
			'403 Host not allowed (JSON from AllowedHostFilter)',
			json(403, { success: false, error: 'Host not allowed', correlationId: 'c-403' }),
			{ kind: 'host-not-allowed', status: 403, detail: 'Host not allowed', correlationId: 'c-403' },
		],
		['403 CORS rejection (plain text from Spring)', { status: 403, text: 'Invalid CORS request' }, { kind: 'cors', status: 403 }],
		[
			'413 is a request too large',
			json(413, { success: false, error: 'Request body too large' }),
			{ kind: 'too-large', status: 413, detail: 'Request body too large' },
		],
		['502 without JSON body', { status: 502, text: 'Bad Gateway' }, { kind: 'http', status: 502 }],
		[
			'502 with Refinr message',
			json(502, { success: false, error: 'LLM provider unavailable', correlationId: 'c-502' }),
			{ kind: 'http', status: 502, detail: 'LLM provider unavailable', correlationId: 'c-502' },
		],
	];

	it.each(cases)('%s', async (_, response, expected) => {
		const transport = fakeTransport({ '/api/v1/source': response });
		await expect(client(transport).source()).resolves.toEqual({ ok: false, error: expected });
	});

	it('another 403 stays a plain HTTP error', async () => {
		const transport = fakeTransport({ '/api/v1/source': json(403, { error: 'Forbidden' }) });
		await expect(client(transport).source()).resolves.toEqual({
			ok: false,
			error: { kind: 'http', status: 403, detail: 'Forbidden' },
		});
	});

	it('a network failure is reported with the transport message', async () => {
		const transport = fakeTransport({ '/api/v1/health': new Error('net::ERR_CONNECTION_REFUSED') });
		await expect(client(transport).health()).resolves.toEqual({
			ok: false,
			error: { kind: 'network', detail: 'net::ERR_CONNECTION_REFUSED' },
		});
	});
});

describe('timeout', () => {
	it('stops waiting after the check timeout', async () => {
		vi.useFakeTimers();
		const never: HttpTransport = () => new Promise<HttpResponse>(() => undefined);
		const pending = client(never, null, 5000).health();
		await vi.advanceTimersByTimeAsync(4999);
		let settled = false;
		void pending.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await expect(pending).resolves.toEqual({ ok: false, error: { kind: 'timeout', timeoutMs: 5000 } });
	});

	it('uses 30 s by default', async () => {
		vi.useFakeTimers();
		const never: HttpTransport = () => new Promise<HttpResponse>(() => undefined);
		const pending = client(never).tracker();
		await vi.advanceTimersByTimeAsync(30_000);
		await expect(pending).resolves.toEqual({ ok: false, error: { kind: 'timeout', timeoutMs: 30_000 } });
	});
});

describe('analyzePreview', () => {
	const PREVIEW = { success: true, message: 'Preview generated successfully', epics: [{ name: 'E', stories: [] }] };

	it('posts the note as text with the API key and parses the preview', async () => {
		const transport = fakeTransport({ '/api/v1/analyze-preview': json(200, PREVIEW) });
		const result = await client(transport, KEY).analyzePreview({ content: '# Body', title: 'Spec' }, 60_000);
		expect(result.ok && result.value.totals.epics).toBe(1);
		expect(transport.requests[0]).toEqual({
			url: `${BASE}/api/v1/analyze-preview`,
			method: 'POST',
			headers: { Accept: 'application/json', 'X-API-Key': KEY },
			body: '{"content":"# Body","title":"Spec"}',
		});
	});

	it('uses the analysis timeout, not the check timeout', async () => {
		vi.useFakeTimers();
		const never: HttpTransport = () => new Promise<HttpResponse>(() => undefined);
		const pending = client(never, null, 1000).analyzePreview({ content: 'x', title: 't' }, 1_560_000);
		await vi.advanceTimersByTimeAsync(1_559_999);
		let settled = false;
		void pending.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await expect(pending).resolves.toEqual({ ok: false, error: { kind: 'timeout', timeoutMs: 1_560_000 } });
	});

	it('reports 413 and 502 with Refinr messages', async () => {
		const tooLarge = fakeTransport({
			'/api/v1/analyze-preview': json(413, { success: false, error: 'The document exceeds the maximum size of 200000 characters' }),
		});
		await expect(client(tooLarge).analyzePreview({ content: 'x', title: 't' }, 1000)).resolves.toEqual({
			ok: false,
			error: { kind: 'too-large', status: 413, detail: 'The document exceeds the maximum size of 200000 characters' },
		});
		const unavailable = fakeTransport({ '/api/v1/analyze-preview': json(502, { success: false, error: 'LLM provider unavailable' }) });
		await expect(client(unavailable).analyzePreview({ content: 'x', title: 't' }, 1000)).resolves.toMatchObject({
			ok: false,
			error: { kind: 'http', status: 502, detail: 'LLM provider unavailable' },
		});
	});

	it('refuses an answer without epics', async () => {
		const transport = fakeTransport({ '/api/v1/analyze-preview': json(200, { success: true }) });
		await expect(client(transport).analyzePreview({ content: 'x', title: 't' }, 1000)).resolves.toEqual({
			ok: false,
			error: { kind: 'invalid-response', status: 200 },
		});
	});
});

describe('normalizeBaseUrl', () => {
	it.each([
		['http://localhost:8080', 'http://localhost:8080'],
		['  http://localhost:8080/  ', 'http://localhost:8080'],
		['https://refinr.example.org/base//', 'https://refinr.example.org/base'],
		['HTTP://LOCALHOST:8080', 'http://localhost:8080'],
	])('%s -> %s', (raw, expected) => {
		expect(normalizeBaseUrl(raw)).toBe(expected);
	});

	it.each(['', '   ', 'localhost:8080', 'ftp://host', 'file:///etc/passwd', 'http://user:pw@host', 'http://host/?a=1', 'http://host/#x', 'not a url'])(
		'refuses %j',
		(raw) => {
			expect(normalizeBaseUrl(raw)).toBeNull();
		},
	);
});
