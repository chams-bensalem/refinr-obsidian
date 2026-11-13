// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import type { HealthReport, RefinrClient, RefinrError, Result, SourceInfo, TrackerInfo } from './api/refinr-client';

/** State of the API key secret selected in the settings. Only its name is ever shown, never its value. */
export type SecretState = { kind: 'none' } | { kind: 'found' } | { kind: 'missing'; name: string };

export interface ConnectionCheck {
	baseUrl: string;
	secret: SecretState;
	health: Result<HealthReport>;
	/** Absent when Refinr could not be reached at all (no point asking again). */
	source?: Result<SourceInfo>;
	tracker?: Result<TrackerInfo>;
}

export interface ConnectionReport {
	ok: boolean;
	lines: string[];
}

/** What the plugin was doing when an error happened; the advice differs (an analysis may still be running). */
export type Operation = 'check' | 'analysis' | 'creation';

/** `GET /health`, then `/source` and `/tracker` (they need the API key, `/health` does not). */
export async function checkConnection(client: RefinrClient, secret: SecretState): Promise<ConnectionCheck> {
	const health = await client.health();
	if (!health.ok && isUnreachable(health.error)) {
		return { baseUrl: client.baseUrl, secret, health };
	}
	const [source, tracker] = await Promise.all([client.source(), client.tracker()]);
	return { baseUrl: client.baseUrl, secret, health, source, tracker };
}

export function buildConnectionReport(check: ConnectionCheck): ConnectionReport {
	const lines: string[] = [];
	const errors: string[] = [];
	let ok = true;

	if (check.secret.kind === 'missing') {
		ok = false;
		lines.push(
			`The secret "${check.secret.name}" selected for the API key was not found on this device: select or create it in the plugin settings.`,
		);
	}

	if (check.health.ok) {
		const down = Object.entries(check.health.value.services)
			.filter(([, service]) => service.status !== 'UP')
			.map(([name]) => name);
		if (check.health.value.status === 'UP') {
			lines.push(`Refinr is up (${check.baseUrl}).`);
		} else {
			ok = false;
			lines.push(
				`Refinr answers but is ${check.health.value.status.toLowerCase()}` +
					(down.length > 0 ? `: unavailable service(s): ${down.join(', ')}.` : '.'),
			);
		}
	} else {
		ok = false;
		errors.push(describeError(check.health.error, check.baseUrl, 'check', check.secret));
	}

	if (check.source !== undefined) {
		if (check.source.ok) {
			const limit = check.source.value.maxContentChars.toLocaleString('en-US');
			lines.push(`Source: ${check.source.value.name} (notes up to ${limit} characters, title included).`);
		} else {
			ok = false;
			errors.push(describeError(check.source.error, check.baseUrl, 'check', check.secret));
		}
	}
	if (check.tracker !== undefined) {
		if (check.tracker.ok) {
			lines.push(`Tracker: ${check.tracker.value.name}.`);
		} else {
			ok = false;
			errors.push(describeError(check.tracker.error, check.baseUrl, 'check', check.secret));
		}
	}

	// The same cause (e.g. a rejected API key) usually fails several calls: say it once.
	for (const error of errors) {
		if (!lines.includes(error)) {
			lines.push(error);
		}
	}
	return { ok, lines };
}

/** Actionable, user-facing message. Never contains the API key (only Refinr's own message and status). */
export function describeError(
	error: RefinrError,
	baseUrl: string,
	operation: Operation,
	secret: SecretState = { kind: 'none' },
): string {
	const ref = error.correlationId === undefined ? '' : ` (correlation id ${error.correlationId})`;
	switch (error.kind) {
		case 'network':
			return `Could not reach Refinr at ${baseUrl}${error.detail === undefined ? '' : `: ${error.detail}`}. Check the URL and that Refinr is running.`;
		case 'timeout':
			return timeoutMessage(error.timeoutMs ?? 0, operation);
		case 'unauthorized':
			return secret.kind === 'none'
				? `Refinr requires an API key (HTTP 401): select the secret holding it in the plugin settings.${ref}`
				: `Refinr rejected the API key (HTTP 401): check the secret selected in the plugin settings.${ref}`;
		case 'host-not-allowed':
			return `Refinr refused this host name (HTTP 403 "Host not allowed"): add it to REFINR_ALLOWED_HOSTS on the Refinr server.${ref}`;
		case 'cors':
			return 'Refinr refused the origin of the request (HTTP 403 "Invalid CORS request"): add app://obsidian.md to CORS_ALLOWED_ORIGINS on the Refinr server.';
		case 'too-large':
			return `Refinr refused the request: too large (HTTP 413)${error.detail === undefined ? '' : `: ${error.detail}`}.${ref}`;
		case 'invalid-response':
			return `Unexpected answer from ${baseUrl} (HTTP ${error.status ?? '?'}): is this the URL of a Refinr server?`;
		case 'http':
			return `Refinr answered HTTP ${error.status ?? '?'}${error.detail === undefined ? '' : `: ${error.detail}`}.${ref}`;
	}
}

function timeoutMessage(timeoutMs: number, operation: Operation): string {
	const seconds = Math.round(timeoutMs / 1000);
	const waited = seconds >= 120 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
	switch (operation) {
		case 'analysis':
			return `No answer from Refinr after ${waited}. Refinr may still be analysing the note: wait before starting again, or raise the analysis timeout in the plugin settings.`;
		case 'creation':
			return `No answer from Refinr after ${waited}. The issues may have been created anyway: check the tracker before trying again.`;
		case 'check':
			return `No answer from Refinr after ${waited}.`;
	}
}

function isUnreachable(error: RefinrError): boolean {
	return error.kind === 'network' || error.kind === 'timeout' || error.kind === 'invalid-response';
}
