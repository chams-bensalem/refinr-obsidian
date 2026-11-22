// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT

/** Frontmatter property of a note that sets the output language of its backlog. */
export const LANGUAGE_PROPERTY = 'lang';

/**
 * Output language sent to Refinr for a note: its `lang` property when it is a non-empty text, otherwise the plugin's
 * default language, otherwise null (nothing sent: Refinr applies its own setting, then detects the language). The
 * value is sent as written (trimmed): Refinr validates it and answers 400 with its own message when it is not an
 * ISO 639-1 code. A Refinr server older than 1.4.0 ignores it.
 */
export function outputLanguage(frontmatter: Record<string, unknown> | null | undefined, defaultLanguage: string): string | null {
	const lang = frontmatter?.[LANGUAGE_PROPERTY];
	if (typeof lang === 'string' && lang.trim() !== '') {
		return lang.trim();
	}
	const fallback = defaultLanguage.trim();
	return fallback === '' ? null : fallback;
}
