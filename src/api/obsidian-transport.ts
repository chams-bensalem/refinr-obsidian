// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { requestUrl } from 'obsidian';
import type { HttpTransport } from './http';

/**
 * The only network access of the plugin: Obsidian's `requestUrl` (no CORS restriction, desktop and mobile), with
 * `throw: false` so that 4xx/5xx answers are read and explained instead of turned into generic errors.
 */
export const obsidianTransport: HttpTransport = async (request) => {
	const response = await requestUrl({
		url: request.url,
		method: request.method,
		headers: request.headers,
		body: request.body,
		contentType: request.body === undefined ? undefined : 'application/json',
		throw: false,
	});
	return { status: response.status, text: response.text };
};
