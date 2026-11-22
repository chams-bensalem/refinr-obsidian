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

	it('adds the output language to the body when there is one (Refinr 1.4.0)', async () => {
		const transport = fakeTransport({ '/api/v1/analyze-preview': json(200, PREVIEW) });
		await client(transport).analyzePreview({ content: '# Body', title: 'Spec' }, 60_000, 'en');
		expect(transport.requests[0]?.body).toBe('{"content":"# Body","title":"Spec","language":"en"}');
	});

	it('shows the 400 of an invalid language with Refinr message', async () => {
		const transport = fakeTransport({
			'/api/v1/analyze-preview': json(400, { success: false, error: 'language must be an ISO 639-1 code (e.g. fr, en)' }),
		});
		await expect(client(transport).analyzePreview({ content: 'x', title: 't' }, 1000, 'english')).resolves.toEqual({
			ok: false,
			error: { kind: 'http', status: 400, detail: 'language must be an ISO 639-1 code (e.g. fr, en)' },
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

describe('createIssues', () => {
	const CREATION = { success: true, created: [{ type: 'epic', title: 'E', key: '#1', url: 'http://op/1' }], failed: [], epics: [{ name: 'E', jiraKey: '#1', stories: [] }] };
	const EPICS = [{ name: 'E', stories: [], unknownField: 'kept' }];

	it('posts the preview epics unchanged, with the project key encoded', async () => {
		const transport = fakeTransport({ '/api/v1/create-jira?projectKey=my%20proj': json(200, CREATION) });
		const result = await client(transport, KEY).createIssues(EPICS, 'my proj', 60_000);
		expect(result.ok && result.value.created.length).toBe(1);
		expect(transport.requests[0]).toMatchObject({ method: 'POST', body: JSON.stringify(EPICS), headers: { 'X-API-Key': KEY } });
	});

	it('adds the output language as a query parameter, with or without projectKey', async () => {
		const both = fakeTransport({ '/api/v1/create-jira?projectKey=DEMO&language=en': json(200, CREATION) });
		await expect(client(both).createIssues(EPICS, 'DEMO', 60_000, 'en')).resolves.toMatchObject({ ok: true });
		const only = fakeTransport({ '/api/v1/create-jira?language=fr': json(200, CREATION) });
		await expect(client(only).createIssues(EPICS, '', 60_000, 'fr')).resolves.toMatchObject({ ok: true });
	});

	it('omits projectKey for the default project', async () => {
		const transport = fakeTransport({ '/api/v1/create-jira': json(200, CREATION) });
		await expect(client(transport).createIssues(EPICS, '', 60_000)).resolves.toMatchObject({ ok: true });
	});

	it('reads the lists of a 207 and of a 502', async () => {
		const partial = fakeTransport({ '/api/v1/create-jira': json(207, { ...CREATION, success: false, failed: [{ type: 'story', title: 'S', reason: 'r' }] }) });
		await expect(client(partial).createIssues(EPICS, '', 1000)).resolves.toMatchObject({ ok: true, value: { failed: [{ reason: 'r' }] } });
		const nothing = fakeTransport({ '/api/v1/create-jira': json(502, { success: false, error: 'No issue could be created', created: [], failed: [{ type: 'epic', title: 'E', reason: 'boom' }], epics: [] }) });
		await expect(client(nothing).createIssues(EPICS, '', 1000)).resolves.toMatchObject({ ok: true, value: { created: [], failed: [{ reason: 'boom' }] } });
	});

	it('a 500 without lists and a 400 are errors', async () => {
		const failure = fakeTransport({ '/api/v1/create-jira': json(500, { success: false, error: 'Failed to create the issues' }) });
		await expect(client(failure).createIssues(EPICS, '', 1000)).resolves.toEqual({ ok: false, error: { kind: 'http', status: 500, detail: 'Failed to create the issues' } });
		const invalid = fakeTransport({ '/api/v1/create-jira?projectKey=x': json(400, { success: false, error: 'Invalid projectKey: x' }) });
		await expect(client(invalid).createIssues(EPICS, 'x', 1000)).resolves.toEqual({ ok: false, error: { kind: 'http', status: 400, detail: 'Invalid projectKey: x' } });
	});

	it('stops waiting after the timeout', async () => {
		vi.useFakeTimers();
		const never: HttpTransport = () => new Promise<HttpResponse>(() => undefined);
		const pending = client(never).createIssues(EPICS, '', 5000);
		await vi.advanceTimersByTimeAsync(5000);
		await expect(pending).resolves.toEqual({ ok: false, error: { kind: 'timeout', timeoutMs: 5000 } });
	});
});

describe('503 of Refinr 1.4.0 (AI provider quota or overload)', () => {
	it.each<[string, string, string]>([
		['rate-limited', 'The AI provider quota or rate limit was reached', 'rate-limited'],
		['overloaded', 'The AI provider is temporarily overloaded', 'overloaded'],
	])('%s, with the delay of retryAfterSeconds', async (_, message, kind) => {
		const transport = fakeTransport({
			'/api/v1/analyze-preview': json(503, { success: false, error: message, correlationId: 'c1', retryAfterSeconds: 42 }),
		});
		await expect(client(transport).analyzePreview({ content: 'x', title: 't' }, 1000)).resolves.toEqual({
			ok: false,
			error: { kind, status: 503, detail: message, correlationId: 'c1', retryAfterSeconds: 42 },
		});
	});

	it('without retryAfterSeconds (or with an unusable one), no delay', async () => {
		const transport = fakeTransport({
			'/api/v1/reassess-story': json(503, { success: false, error: 'The AI provider is temporarily overloaded', retryAfterSeconds: 'soon' }),
		});
		await expect(client(transport).reassessStory('#1', 'p', 1000)).resolves.toEqual({
			ok: false,
			error: { kind: 'overloaded', status: 503, detail: 'The AI provider is temporarily overloaded' },
		});
	});

	it('another 503 and the 502 of Refinr 1.3 stay plain HTTP errors', async () => {
		const other = fakeTransport({ '/api/v1/analyze-preview': json(503, { success: false, error: 'Service Unavailable' }) });
		await expect(client(other).analyzePreview({ content: 'x', title: 't' }, 1000)).resolves.toMatchObject({
			ok: false,
			error: { kind: 'http', status: 503 },
		});
		const old = fakeTransport({ '/api/v1/analyze-preview': json(502, { success: false, error: 'The AI provider is unavailable' }) });
		await expect(client(old).analyzePreview({ content: 'x', title: 't' }, 1000)).resolves.toMatchObject({
			ok: false,
			error: { kind: 'http', status: 502 },
		});
	});
});

describe('reassessStory', () => {
	it('posts the key and the precision, reads the new verdict', async () => {
		const transport = fakeTransport({ '/api/v1/reassess-story': json(200, { success: true, issueKey: '#15', aiReady: true, aiReadyReason: 'Now clear' }) });
		await expect(client(transport, KEY).reassessStory('#15', 'CSV, UTF-8', 60_000)).resolves.toEqual({
			ok: true,
			value: { issueKey: '#15', aiReady: true, reason: 'Now clear' },
		});
		expect(transport.requests[0]?.body).toBe('{"issueKey":"#15","precision":"CSV, UTF-8"}');
	});

	it('adds the output language to the body when there is one', async () => {
		const transport = fakeTransport({ '/api/v1/reassess-story': json(200, { success: true, issueKey: '#15', aiReady: false }) });
		await client(transport).reassessStory('#15', 'p', 1000, 'en');
		expect(transport.requests[0]?.body).toBe('{"issueKey":"#15","precision":"p","language":"en"}');
	});

	it.each<[string, HttpResponse | Error, object]>([
		['409 not awaiting validation', json(409, { success: false, error: 'Issue #15 is not awaiting validation (label validation-necessaire absent)' }), { kind: 'http', status: 409 }],
		['500 unknown key (Refinr has no 404)', json(500, { success: false, error: 'Failed to reassess the story', correlationId: 'c9' }), { kind: 'http', status: 500, correlationId: 'c9' }],
		['502 model unavailable', json(502, { success: false, error: 'The AI provider is unavailable' }), { kind: 'http', status: 502 }],
		['network error', new Error('net::ERR_CONNECTION_REFUSED'), { kind: 'network' }],
	])('%s', async (_, answer, expected) => {
		const transport = fakeTransport({ '/api/v1/reassess-story': answer });
		const result = await client(transport, KEY).reassessStory('#15', 'p', 1000);
		expect(result).toMatchObject({ ok: false, error: expected });
		expect(JSON.stringify(result)).not.toContain(KEY);
	});

	it('stops waiting after the timeout', async () => {
		vi.useFakeTimers();
		const never: HttpTransport = () => new Promise<HttpResponse>(() => undefined);
		const pending = client(never).reassessStory('#15', 'p', 2000);
		await vi.advanceTimersByTimeAsync(2000);
		await expect(pending).resolves.toEqual({ ok: false, error: { kind: 'timeout', timeoutMs: 2000 } });
	});
});

describe('validateStory (Refinr 1.4.0)', () => {
	it('posts the key only, reads the human verdict', async () => {
		const transport = fakeTransport({
			'/api/v1/validate-story': json(200, {
				success: true,
				issueKey: '#15',
				aiReady: true,
				aiReadyReason: 'validee par un humain, sans appel au modele',
				aiReadySource: 'human',
			}),
		});
		await expect(client(transport, KEY).validateStory('#15', 1000)).resolves.toEqual({
			ok: true,
			value: { issueKey: '#15', aiReady: true, reason: 'validee par un humain, sans appel au modele', source: 'human' },
		});
		expect(transport.requests[0]).toMatchObject({ method: 'POST', body: '{"issueKey":"#15"}', headers: { 'X-API-Key': KEY } });
	});

	it('refuses an answer that is not ai-ready', async () => {
		const transport = fakeTransport({ '/api/v1/validate-story': json(200, { success: true, issueKey: '#15', aiReady: false }) });
		await expect(client(transport).validateStory('#15', 1000)).resolves.toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
	});

	it('a Refinr older than 1.4.0 answers 404', async () => {
		const transport = fakeTransport({ '/api/v1/validate-story': json(404, { error: 'Not Found' }) });
		await expect(client(transport).validateStory('#15', 1000)).resolves.toMatchObject({ ok: false, error: { kind: 'http', status: 404 } });
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
