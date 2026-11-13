// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT

/** HTTP request sent to Refinr. Kept free of any Obsidian type so that the client can be tested without Obsidian. */
export interface HttpRequest {
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string;
}

/** HTTP response, whatever its status (the transport never throws on 4xx/5xx). */
export interface HttpResponse {
	status: number;
	text: string;
}

/** Sends a request; rejects only when no HTTP response was received (network error, invalid URL...). */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/** Raised by {@link withTimeout} when the plugin stops waiting. */
export class TimeoutError extends Error {
	constructor(readonly timeoutMs: number) {
		super(`No answer within ${Math.round(timeoutMs / 1000)} s`);
		this.name = 'TimeoutError';
	}
}

/**
 * Stops waiting for `promise` after `timeoutMs`. The underlying request is NOT cancelled (Obsidian's `requestUrl`
 * cannot be aborted): the server may still be processing it.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: number | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}
