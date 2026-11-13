// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import type { RefinrError } from './api/refinr-client';
import { fallbackCause } from './verdict';

/**
 * Answer of `POST /api/v1/create-jira` (Refinr `BacklogController.creationResponse`): 200 complete, 207 partial, 502
 * nothing created — always with `created`, `failed` and `epics`. What counts is the content (`created[]`), not the
 * status code.
 */
export interface CreatedIssue {
	type: string;
	title: string;
	key: string;
	url: string | null;
}

export interface FailedIssue {
	type: string;
	title: string;
	reason: string;
}

export type CreatedVerdict = 'ai-ready' | 'validation-necessaire';

export interface CreatedEpic {
	title: string;
	key: string;
	url: string | null;
}

export interface CreatedStory {
	title: string;
	key: string;
	url: string | null;
	/** Verdict computed again by Refinr at creation (may differ from the preview), as written in the tracker. */
	verdict: CreatedVerdict;
	reason: string;
	/** Refinr's fallback verdict (no reliable verdict, e.g. AI unavailable): validation-necessaire by default. */
	fallback: boolean;
}

export interface CreationResult {
	created: CreatedIssue[];
	failed: FailedIssue[];
	epics: CreatedEpic[];
	stories: CreatedStory[];
}

/** Creation answer with its lists, or null when the body is not a creation answer (e.g. a 500 without lists). */
export function parseCreation(json: unknown): CreationResult | null {
	if (!isRecord(json) || !Array.isArray(json.created) || !Array.isArray(json.failed)) {
		return null;
	}
	const created: CreatedIssue[] = [];
	for (const raw of json.created) {
		if (isRecord(raw) && typeof raw.key === 'string' && raw.key !== '') {
			created.push({ type: text(raw.type), title: text(raw.title), key: raw.key, url: httpUrl(raw.url) });
		}
	}
	const failed: FailedIssue[] = json.failed.filter(isRecord).map((raw) => ({
		type: text(raw.type),
		title: text(raw.title),
		reason: text(raw.reason),
	}));
	// Story URLs are only in created[] (Refinr does not set them in epics[]): joined by key, never by title.
	const urlByKey = new Map(created.map((issue) => [issue.key, issue.url]));
	const epics: CreatedEpic[] = [];
	const stories: CreatedStory[] = [];
	for (const epic of Array.isArray(json.epics) ? json.epics.filter(isRecord) : []) {
		if (typeof epic.jiraKey === 'string' && epic.jiraKey !== '') {
			epics.push({ title: text(epic.name), key: epic.jiraKey, url: urlByKey.get(epic.jiraKey) ?? httpUrl(epic.jiraUrl) });
		}
		for (const story of Array.isArray(epic.stories) ? epic.stories.filter(isRecord) : []) {
			if (typeof story.jiraKey === 'string' && story.jiraKey !== '') {
				stories.push({
					title: text(story.title),
					key: story.jiraKey,
					url: urlByKey.get(story.jiraKey) ?? httpUrl(story.jiraUrl),
					// Refinr's rule: only an explicit true is ai-ready.
					verdict: story.aiReady === true ? 'ai-ready' : 'validation-necessaire',
					reason: text(story.aiReadyReason),
					fallback: story.aiReady !== true && fallbackCause(text(story.aiReadyReason)) !== null,
				});
			}
		}
	}
	return { created, failed, epics, stories };
}

/** Chromium network errors raised before the request was sent: nothing can have been created. */
const NOT_SENT =
	/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_ADDRESS_UNREACHABLE|ERR_ADDRESS_INVALID|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_ACCESS_DENIED|ERR_INVALID_URL|ERR_CERT_|ERR_SSL_|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/;

/**
 * Whether a failed creation certainly created nothing: the request could not leave (connection refused, unknown
 * host…), or Refinr refused it before creating (400 invalid project, 401 key, 403 host/CORS, 413 size). Anything else
 * (timeout, connection lost after sending, 5xx without lists, unreadable answer) is unknown: the issues may exist.
 */
export function nothingCreated(error: RefinrError): boolean {
	switch (error.kind) {
		case 'network':
			return error.detail !== undefined && NOT_SENT.test(error.detail);
		case 'unauthorized':
		case 'host-not-allowed':
		case 'cors':
		case 'too-large':
			return true;
		case 'http':
			return error.status === 400;
		case 'timeout':
		case 'invalid-response':
			return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Only http(s) URLs are kept (they become links). */
function httpUrl(value: unknown): string | null {
	return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}
