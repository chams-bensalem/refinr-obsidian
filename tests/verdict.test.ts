// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { fallbackCause, isFallback, verdictSource } from '../src/verdict';

// Wording of Refinr's ReadinessPolicy.unavailable(cause): the only signal of a fallback verdict in the REST contract.
describe('fallbackCause', () => {
	it.each([
		['verdict indisponible (no verdict) : validation humaine necessaire', 'no verdict'],
		['verdict indisponible (LlmException) : validation humaine necessaire', 'LlmException'],
		['  verdict indisponible (a (nested) cause) : validation humaine necessaire\n', 'a (nested) cause'],
	])('%j → %j', (reason, cause) => {
		expect(fallbackCause(reason)).toBe(cause);
	});

	it.each(['', 'Format not decided', 'verdict indisponible', 'Le verdict indisponible (x) : validation humaine necessaire, see above'])(
		'a real reason %j is not a fallback',
		(reason) => {
			expect(fallbackCause(reason)).toBeNull();
		},
	);
});

const FALLBACK = 'verdict indisponible (no verdict) : validation humaine necessaire';

describe('isFallback', () => {
	it('uses aiReadySource when Refinr sends it (1.4.0 or later), whatever the reason says', () => {
		expect(isFallback(false, 'Format not decided', 'fallback')).toBe(true);
		expect(isFallback(false, FALLBACK, 'model')).toBe(false);
		expect(isFallback(false, FALLBACK, 'human')).toBe(false);
	});

	it('falls back to the wording of the reason for an older Refinr (no or unknown aiReadySource)', () => {
		expect(isFallback(false, FALLBACK, undefined)).toBe(true);
		expect(isFallback(false, 'Format not decided', undefined)).toBe(false);
		expect(isFallback(false, FALLBACK, 'something-new')).toBe(true);
	});

	it('an ai-ready story is never a fallback', () => {
		expect(isFallback(true, FALLBACK, 'fallback')).toBe(false);
	});
});

describe('verdictSource', () => {
	it.each(['model', 'fallback', 'human'])('%j is known', (value) => {
		expect(verdictSource(value)).toBe(value);
	});

	it.each([undefined, null, 'MODEL', 3])('%j is not', (value) => {
		expect(verdictSource(value)).toBeNull();
	});
});
