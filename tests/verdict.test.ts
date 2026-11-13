// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { fallbackCause } from '../src/verdict';

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
