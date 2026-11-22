// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { type CreationResult, parseCreation } from '../creation';
import { parsePreview, type Preview } from '../preview';
import { type HttpRequest, type HttpTransport, TimeoutError, withTimeout } from './http';

/** Why a call to Refinr failed. Each kind maps to an actionable message (see `connection.ts`). */
export type RefinrErrorKind =
	| 'network'
	| 'timeout'
	| 'unauthorized'
	| 'host-not-allowed'
	| 'cors'
	| 'too-large'
	| 'http'
	| 'invalid-response'
	/** 503 from Refinr 1.4.0 or later: quota or rate limit of its AI provider. */
	| 'rate-limited'
	/** 503 from Refinr 1.4.0 or later: its AI provider is temporarily overloaded. */
	| 'overloaded';

export interface RefinrError {
	kind: RefinrErrorKind;
	/** HTTP status, when a response was received. */
	status?: number;
	/** Safe, short detail: Refinr's `error` message, or the transport error. Never contains the API key. */
	detail?: string;
	/** Refinr's correlation id, to find the request in its logs. */
	correlationId?: string;
	/** Timeout that expired, for `timeout`. */
	timeoutMs?: number;
	/** Delay announced by Refinr before trying again (`retryAfterSeconds`), for `rate-limited` and `overloaded`. */
	retryAfterSeconds?: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: RefinrError };

export interface ServiceHealth {
	status: string;
	details: Record<string, string>;
}

/** `GET /api/v1/health`: `UP` or `DEGRADED`, and the status of each external dependency. */
export interface HealthReport {
	status: string;
	services: Record<string, ServiceHealth>;
}

/** `GET /api/v1/source`: active document source and the size limit of a document sent as text (title included). */
export interface SourceInfo {
	name: string;
	maxContentChars: number;
}

/** `GET /api/v1/tracker`: active issue tracker. */
export interface TrackerInfo {
	name: string;
}

/** `POST /api/v1/reassess-story`: the new verdict of the story. */
export interface Reassessment {
	issueKey: string;
	aiReady: boolean;
	reason: string;
}

export interface RefinrClientOptions {
	/** Base URL, already normalized by {@link normalizeBaseUrl}. */
	baseUrl: string;
	/** API key sent as `X-API-Key`, or null/empty when Refinr has none. Read at each call. */
	apiKey: () => string | null;
	transport: HttpTransport;
	/** Timeout of the checks (health, source, tracker). */
	checkTimeoutMs?: number;
}

export const DEFAULT_CHECK_TIMEOUT_MS = 30_000;
const CORS_REJECTION = 'Invalid CORS request';
const HOST_REJECTION = 'Host not allowed';
/** Messages of Refinr's 503 (`BacklogController`): matched in full, an other 503 stays a plain HTTP error. */
const RATE_LIMITED = 'The AI provider quota or rate limit was reached';
const OVERLOADED = 'The AI provider is temporarily overloaded';
const MAX_DETAIL_LENGTH = 300;

/** `http(s)://host[:port][/path]` without trailing slash, or null when the URL is unusable. */
export function normalizeBaseUrl(raw: string): string | null {
	const value = raw.trim();
	if (value === '') {
		return null;
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
		return null;
	}
	if (url.search !== '' || url.hash !== '') {
		return null;
	}
	return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

export class RefinrClient {
	constructor(private readonly options: RefinrClientOptions) {}

	get baseUrl(): string {
		return this.options.baseUrl;
	}

	health(): Promise<Result<HealthReport>> {
		return this.get('/api/v1/health', parseHealth);
	}

	source(): Promise<Result<SourceInfo>> {
		return this.get('/api/v1/source', parseSource);
	}

	tracker(): Promise<Result<TrackerInfo>> {
		return this.get('/api/v1/tracker', parseTracker);
	}

	/**
	 * `POST /api/v1/analyze-preview` with a document provided as text. Can take minutes (language model): when
	 * `timeoutMs` expires, the plugin stops waiting but Refinr may still be analyzing.
	 */
	analyzePreview(
		document: { content: string; title: string },
		timeoutMs: number,
		language: string | null = null,
	): Promise<Result<Preview>> {
		const body = language === null ? document : { ...document, language };
		return this.send('POST', '/api/v1/analyze-preview', JSON.stringify(body), timeoutMs, parsePreview);
	}

	/**
	 * `POST /api/v1/create-jira` with the preview's `epics`, unchanged. The answer is read whatever its status when it
	 * holds the creation lists (200, 207 and 502 do): what was created matters, not the status code.
	 */
	createIssues(epics: unknown[], projectKey: string, timeoutMs: number, language: string | null = null): Promise<Result<CreationResult>> {
		const params = [
			...(projectKey === '' ? [] : [`projectKey=${encodeURIComponent(projectKey)}`]),
			...(language === null ? [] : [`language=${encodeURIComponent(language)}`]),
		];
		const query = params.length === 0 ? '' : `?${params.join('&')}`;
		return this.send('POST', `/api/v1/create-jira${query}`, JSON.stringify(epics), timeoutMs, parseCreation, true);
	}

	/** `POST /api/v1/reassess-story`: calls the language model, then updates the issue (comment + verdict). */
	reassessStory(issueKey: string, precision: string, timeoutMs: number, language: string | null = null): Promise<Result<Reassessment>> {
		const body = language === null ? { issueKey, precision } : { issueKey, precision, language };
		return this.send('POST', '/api/v1/reassess-story', JSON.stringify(body), timeoutMs, parseReassessment);
	}

	private get<T>(path: string, parse: (json: unknown) => T | null): Promise<Result<T>> {
		return this.send('GET', path, undefined, this.options.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS, parse);
	}

	private async send<T>(
		method: HttpRequest['method'],
		path: string,
		body: string | undefined,
		timeoutMs: number,
		parse: (json: unknown) => T | null,
		parseErrorBodies = false,
	): Promise<Result<T>> {
		const headers: Record<string, string> = { Accept: 'application/json' };
		const key = this.options.apiKey();
		if (key !== null && key !== '') {
			headers['X-API-Key'] = key;
		}
		const request: HttpRequest = { url: this.options.baseUrl + path, method, headers };
		if (body !== undefined) {
			request.body = body;
		}
		let status: number;
		let text: string;
		try {
			const response = await withTimeout(this.options.transport(request), timeoutMs);
			status = response.status;
			text = response.text;
		} catch (e) {
			if (e instanceof TimeoutError) {
				return failure({ kind: 'timeout', timeoutMs: e.timeoutMs });
			}
			return failure({ kind: 'network', detail: shorten(errorMessage(e), key) });
		}
		if (status >= 200 && status < 300) {
			const value = parse(parseJson(text));
			return value === null ? failure({ kind: 'invalid-response', status }) : { ok: true, value };
		}
		if (parseErrorBodies) {
			const value = parse(parseJson(text));
			if (value !== null) {
				return { ok: true, value };
			}
		}
		return failure(classifyError(status, text, key));
	}
}

/** Maps a non-2xx answer to an error kind, keeping Refinr's own message and correlation id. */
export function classifyError(status: number, text: string, apiKey: string | null = null): RefinrError {
	const body = parseJson(text);
	const apiError = isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
	const correlationId = isRecord(body) && typeof body.correlationId === 'string' ? body.correlationId : undefined;
	const detail = apiError === undefined ? undefined : shorten(apiError, apiKey);
	const base = { status, ...(detail === undefined ? {} : { detail }), ...(correlationId === undefined ? {} : { correlationId }) };
	if (status === 401) {
		return { kind: 'unauthorized', ...base };
	}
	if (status === 403 && text.trim() === CORS_REJECTION) {
		return { kind: 'cors', ...base };
	}
	if (status === 403 && apiError === HOST_REJECTION) {
		return { kind: 'host-not-allowed', ...base };
	}
	if (status === 413) {
		return { kind: 'too-large', ...base };
	}
	if (status === 503 && (apiError === RATE_LIMITED || apiError === OVERLOADED)) {
		const delay = isRecord(body) ? body.retryAfterSeconds : undefined;
		const retry = typeof delay === 'number' && Number.isInteger(delay) && delay > 0 ? { retryAfterSeconds: delay } : {};
		return { kind: apiError === RATE_LIMITED ? 'rate-limited' : 'overloaded', ...base, ...retry };
	}
	return { kind: 'http', ...base };
}

function failure<T>(error: RefinrError): Result<T> {
	return { ok: false, error };
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Bounded, single-line detail; the API key is masked in case a transport error echoes the request. */
function shorten(message: string, apiKey: string | null): string {
	let safe = message.replace(/\s+/g, ' ').trim();
	if (apiKey !== null && apiKey !== '') {
		safe = safe.split(apiKey).join('***');
	}
	return safe.length > MAX_DETAIL_LENGTH ? `${safe.slice(0, MAX_DETAIL_LENGTH)}…` : safe;
}

function parseHealth(json: unknown): HealthReport | null {
	if (!isRecord(json) || typeof json.status !== 'string') {
		return null;
	}
	const services: Record<string, ServiceHealth> = {};
	if (isRecord(json.services)) {
		for (const [name, raw] of Object.entries(json.services)) {
			if (!isRecord(raw) || typeof raw.status !== 'string') {
				return null;
			}
			const details: Record<string, string> = {};
			for (const [key, value] of Object.entries(raw)) {
				if (key !== 'status' && typeof value === 'string') {
					details[key] = value;
				}
			}
			services[name] = { status: raw.status, details };
		}
	}
	return { status: json.status, services };
}

function parseSource(json: unknown): SourceInfo | null {
	if (!isRecord(json) || typeof json.name !== 'string' || typeof json.maxContentChars !== 'number') {
		return null;
	}
	if (!Number.isInteger(json.maxContentChars) || json.maxContentChars <= 0) {
		return null;
	}
	return { name: json.name, maxContentChars: json.maxContentChars };
}

function parseReassessment(json: unknown): Reassessment | null {
	if (!isRecord(json) || typeof json.issueKey !== 'string' || typeof json.aiReady !== 'boolean') {
		return null;
	}
	return { issueKey: json.issueKey, aiReady: json.aiReady, reason: typeof json.aiReadyReason === 'string' ? json.aiReadyReason : '' };
}

function parseTracker(json: unknown): TrackerInfo | null {
	if (!isRecord(json) || typeof json.name !== 'string') {
		return null;
	}
	return { name: json.name };
}
