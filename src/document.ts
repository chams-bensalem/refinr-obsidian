// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT

/** Java's `\s` (Refinr's `Pattern.compile("\\s+")`): ASCII whitespace only, unlike JavaScript's `\s`. */
const JAVA_WHITESPACE = new Set([' ', '\t', '\n', '\u000b', '\f', '\r']);

/** Collapses each run of Java whitespace into one space and trims the result, like Refinr does with the title. */
function normalizeTitle(title: string): string {
	let out = '';
	let pendingSpace = false;
	for (const char of title) {
		if (JAVA_WHITESPACE.has(char)) {
			pendingSpace = out !== '';
		} else {
			out += (pendingSpace ? ' ' : '') + char;
			pendingSpace = false;
		}
	}
	return out;
}

/**
 * The text whose size Refinr limits (`DocumentAnalysis.providedText`): `# <title>` + blank line + content, the title's
 * whitespace runs collapsed and trimmed; content alone when the title is empty.
 * (Java's `strip()` also trims Unicode spaces at the edges of the title: a difference of a few characters at most.)
 */
export function providedText(title: string, content: string): string {
	const heading = normalizeTitle(title);
	return heading === '' ? content : `# ${heading}\n\n${content}`;
}

/** Unicode code points, as Java's `String.codePointCount` (an emoji counts 1, not 2 UTF-16 units). */
export function codePointLength(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i++) {
		const unit = text.charCodeAt(i);
		// A high surrogate followed by a low surrogate is one code point.
		if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				i++;
			}
		}
		count++;
	}
	return count;
}

/** Size Refinr will count for this note, compared with `maxContentChars` from `GET /api/v1/source`. */
export function providedTextLength(title: string, content: string): number {
	return codePointLength(providedText(title, content));
}
