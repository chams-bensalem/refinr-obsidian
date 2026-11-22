// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { outputLanguage } from '../src/language';
import { languageError } from '../src/settings';

describe('outputLanguage', () => {
	it('uses the lang property of the note first, trimmed', () => {
		expect(outputLanguage({ lang: ' en ' }, 'fr')).toBe('en');
	});

	it('falls back to the default language of the settings', () => {
		expect(outputLanguage({ title: 'Spec' }, 'de')).toBe('de');
		expect(outputLanguage(null, ' es ')).toBe('es');
	});

	it('sends nothing without lang and without a default', () => {
		expect(outputLanguage({}, '')).toBeNull();
		expect(outputLanguage(undefined, '  ')).toBeNull();
	});

	it('ignores an empty or non-text lang', () => {
		expect(outputLanguage({ lang: '' }, 'fr')).toBe('fr');
		expect(outputLanguage({ lang: ['en'] }, '')).toBeNull();
		expect(outputLanguage({ lang: 42 }, 'fr')).toBe('fr');
	});

	it('sends an invalid lang as written: Refinr answers 400 with its own message', () => {
		expect(outputLanguage({ lang: 'english' }, 'fr')).toBe('english');
	});
});

describe('languageError', () => {
	it.each(['', 'en', 'FR', ' de '])('accepts %j', (value) => {
		expect(languageError(value)).toBeUndefined();
	});

	it.each(['english', 'e', 'fr-FR', '12'])('refuses %j', (value) => {
		expect(languageError(value)).toBe('Enter a two-letter language code, for example en or fr, or leave empty.');
	});
});
