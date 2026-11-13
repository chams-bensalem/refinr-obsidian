// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT

/**
 * Fallback verdict of Refinr: when no reliable verdict could be obtained (model unavailable, quota, missing answer),
 * Refinr sets `aiReady: false` with the reason built by `ReadinessPolicy.unavailable(cause)`:
 * `verdict indisponible (<cause>) : validation humaine necessaire`. The REST contract has no flag for it: this exact
 * wording is the only signal (see DECISIONS.md), so it is matched as a whole.
 */
const FALLBACK_REASON = /^verdict indisponible \((.*)\) : validation humaine necessaire$/s;

/** The cause of a fallback verdict (e.g. `no verdict`), or null when the reason is a real verdict reason. */
export function fallbackCause(reason: string): string | null {
	const match = FALLBACK_REASON.exec(reason.trim());
	return match === null ? null : (match[1] ?? '');
}
