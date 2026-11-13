// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Security rule: text produced by the language model (and any text from Refinr) is displayed as plain text only.
 * No source file may build DOM from HTML or render Markdown; ESLint (eslint-plugin-obsidianmd, no-unsanitized) also
 * rejects innerHTML-like assignments.
 */
const FORBIDDEN = [
	'innerHTML',
	'outerHTML',
	'insertAdjacentHTML',
	'document.write',
	'MarkdownRenderer',
	'sanitizeHTMLToDom',
	'DOMParser',
	'createContextualFragment',
];

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
	);
}

describe('plain-text rendering', () => {
	const files = sources(join(__dirname, '..', 'src'));

	it('finds the sources', () => {
		expect(files.some((file) => file.endsWith('preview-modal.ts'))).toBe(true);
	});

	it.each(FORBIDDEN)('no source uses %s', (api) => {
		const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(api));
		expect(offenders).toEqual([]);
	});
});
