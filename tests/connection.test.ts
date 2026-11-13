// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { HttpRequest, HttpResponse } from '../src/api/http';
import { type RefinrError, RefinrClient } from '../src/api/refinr-client';
import { buildConnectionReport, checkConnection, describeError, type ConnectionCheck } from '../src/connection';

const BASE = 'http://localhost:8080';
const UP = { ok: true as const, value: { status: 'UP', services: { confluence: { status: 'UP', details: {} } } } };
const SOURCE = { ok: true as const, value: { name: 'Confluence', maxContentChars: 200000 } };
const TRACKER = { ok: true as const, value: { name: 'Jira' } };

function failed(error: RefinrError) {
	return { ok: false as const, error };
}

describe('buildConnectionReport', () => {
	it('everything up', () => {
		const report = buildConnectionReport({ baseUrl: BASE, secret: { kind: 'none' }, health: UP, source: SOURCE, tracker: TRACKER });
		expect(report).toEqual({
			ok: true,
			lines: [
				'Refinr is up (http://localhost:8080).',
				'Source: Confluence (notes up to 200,000 characters, title included).',
				'Tracker: Jira.',
			],
		});
	});

	it('degraded lists the services that are down', () => {
		const health = {
			ok: true as const,
			value: { status: 'DEGRADED', services: { jira: { status: 'DOWN', details: {} }, ai: { status: 'UP', details: {} } } },
		};
		const report = buildConnectionReport({ baseUrl: BASE, secret: { kind: 'none' }, health, source: SOURCE, tracker: TRACKER });
		expect(report.ok).toBe(false);
		expect(report.lines[0]).toBe('Refinr answers but is degraded: unavailable service(s): jira.');
	});

	it('the same error on source and tracker is reported once', () => {
		const unauthorized = failed({ kind: 'unauthorized', status: 401 });
		const report = buildConnectionReport({
			baseUrl: BASE,
			secret: { kind: 'found' },
			health: UP,
			source: unauthorized,
			tracker: unauthorized,
		});
		expect(report.ok).toBe(false);
		expect(report.lines).toEqual([
			'Refinr is up (http://localhost:8080).',
			'Refinr rejected the API key (HTTP 401): check the secret selected in the plugin settings.',
		]);
	});

	it('a missing secret is reported by name only', () => {
		const check: ConnectionCheck = {
			baseUrl: BASE,
			secret: { kind: 'missing', name: 'refinr-api-key' },
			health: UP,
			source: SOURCE,
			tracker: TRACKER,
		};
		const report = buildConnectionReport(check);
		expect(report.ok).toBe(false);
		expect(report.lines[0]).toContain('"refinr-api-key"');
	});

	it('unreachable: only the health error', () => {
		const report = buildConnectionReport({
			baseUrl: BASE,
			secret: { kind: 'none' },
			health: failed({ kind: 'network', detail: 'net::ERR_CONNECTION_REFUSED' }),
		});
		expect(report).toEqual({
			ok: false,
			lines: [
				'Could not reach Refinr at http://localhost:8080: net::ERR_CONNECTION_REFUSED. Check the URL and that Refinr is running.',
			],
		});
	});
});

describe('describeError', () => {
	it.each<[RefinrError, string]>([
		[{ kind: 'unauthorized', status: 401, correlationId: 'c1' }, 'Refinr requires an API key (HTTP 401): select the secret holding it in the plugin settings. (correlation id c1)'],
		[{ kind: 'host-not-allowed', status: 403 }, 'Refinr refused this host name (HTTP 403 "Host not allowed"): add it to REFINR_ALLOWED_HOSTS on the Refinr server.'],
		[{ kind: 'cors', status: 403 }, 'Refinr refused the origin of the request (HTTP 403 "Invalid CORS request"): add app://obsidian.md to CORS_ALLOWED_ORIGINS on the Refinr server.'],
		[{ kind: 'too-large', status: 413, detail: 'Document too long' }, 'Refinr refused the request: too large (HTTP 413): Document too long.'],
		[{ kind: 'http', status: 502, detail: 'LLM provider unavailable' }, 'Refinr answered HTTP 502: LLM provider unavailable.'],
		[{ kind: 'invalid-response', status: 200 }, 'Unexpected answer from http://localhost:8080 (HTTP 200): is this the URL of a Refinr server?'],
	])('%j', (error, expected) => {
		expect(describeError(error, BASE, 'check')).toBe(expected);
	});

	it('timeout of an analysis says Refinr may still be analysing', () => {
		expect(describeError({ kind: 'timeout', timeoutMs: 1_560_000 }, BASE, 'analysis')).toBe(
			'No answer from Refinr after 26 min. Refinr may still be analysing the note: wait before starting again, or raise the analysis timeout in the plugin settings.',
		);
	});

	it('timeout of a creation says to check the tracker before retrying', () => {
		expect(describeError({ kind: 'timeout', timeoutMs: 60_000 }, BASE, 'creation')).toBe(
			'No answer from Refinr after 60 s. The issues may have been created anyway: check the tracker before trying again.',
		);
	});

	it('timeout of a check', () => {
		expect(describeError({ kind: 'timeout', timeoutMs: 30_000 }, BASE, 'check')).toBe('No answer from Refinr after 30 s.');
	});
});

describe('checkConnection', () => {
	function clientAnswering(answers: Record<string, HttpResponse | Error>, seen: string[]): RefinrClient {
		return new RefinrClient({
			baseUrl: BASE,
			apiKey: () => null,
			transport: (request: HttpRequest) => {
				const path = request.url.slice(BASE.length);
				seen.push(path);
				const answer = answers[path];
				return answer === undefined || answer instanceof Error
					? Promise.reject(answer ?? new Error('unexpected'))
					: Promise.resolve(answer);
			},
		});
	}

	it('calls health, source and tracker', async () => {
		const seen: string[] = [];
		const check = await checkConnection(
			clientAnswering(
				{
					'/api/v1/health': { status: 200, text: '{"status":"UP","services":{}}' },
					'/api/v1/source': { status: 200, text: '{"name":"Confluence","maxContentChars":200000}' },
					'/api/v1/tracker': { status: 200, text: '{"name":"OpenProject"}' },
				},
				seen,
			),
			{ kind: 'none' },
		);
		expect(seen.sort()).toEqual(['/api/v1/health', '/api/v1/source', '/api/v1/tracker']);
		expect(buildConnectionReport(check).ok).toBe(true);
	});

	it('stops after health when Refinr is unreachable', async () => {
		const seen: string[] = [];
		const check = await checkConnection(clientAnswering({ '/api/v1/health': new Error('ECONNREFUSED') }, seen), { kind: 'none' });
		expect(seen).toEqual(['/api/v1/health']);
		expect(check.source).toBeUndefined();
		expect(check.tracker).toBeUndefined();
	});
});
