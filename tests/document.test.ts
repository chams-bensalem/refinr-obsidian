// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { codePointLength, providedText, providedTextLength } from '../src/document';

// Same computation as Refinr's DocumentAnalysis.providedText (title as a level-1 heading, size in code points).
describe('providedText', () => {
	it('puts the title as a heading before the content', () => {
		expect(providedText('My spec', 'Body')).toBe('# My spec\n\nBody');
	});

	it('collapses and trims the whitespace of the title', () => {
		expect(providedText('  My \t spec\n', 'Body')).toBe('# My spec\n\nBody');
	});

	it('sends the content alone when the title is empty or blank', () => {
		expect(providedText('', 'Body')).toBe('Body');
		expect(providedText(' \t ', 'Body')).toBe('Body');
	});

	it('keeps non-ASCII spaces inside the title (Java \\s is ASCII only)', () => {
		expect(providedText('A B', 'x')).toBe('# A B\n\nx');
	});
});

describe('codePointLength', () => {
	it.each([
		['', 0],
		['abc', 3],
		['é', 1],
		['😀', 1],
		['a😀b', 3],
		['👍🏽', 2],
	])('%j has %d code points', (text, expected) => {
		expect(codePointLength(text)).toBe(expected);
	});

	it('counts a lone surrogate as one code point (as Java does)', () => {
		expect(codePointLength('\ud83d')).toBe(1);
	});
});

describe('providedTextLength', () => {
	it('counts the heading, the blank line and the content', () => {
		// "# T\n\n" = 5 characters + "😀😀" = 2 code points
		expect(providedTextLength('T', '😀😀')).toBe(7);
		expect('# T\n\n😀😀'.length).toBe(9);
	});

	it('equals the content length without a title', () => {
		expect(providedTextLength('', 'x'.repeat(200_000))).toBe(200_000);
	});
});
