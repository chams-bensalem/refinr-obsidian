// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT

/**
 * Fallback verdict of Refinr: when no reliable verdict could be obtained (model unavailable, quota, missing answer),
 * Refinr sets `aiReady: false` with the reason built by `ReadinessPolicy.unavailable(cause)`:
 * `verdict indisponible (<cause>) : validation humaine necessaire`. Since Refinr 1.4.0, `aiReadySource: "fallback"`
 * says so (see {@link isFallback}); before, this exact wording was the only signal (see DECISIONS.md), so it is still
 * matched as a whole for an older server.
 */
const FALLBACK_REASON = /^verdict indisponible \((.*)\) : validation humaine necessaire$/s;

/** The cause of a fallback verdict (e.g. `no verdict`), or null when the reason is a real verdict reason. */
export function fallbackCause(reason: string): string | null {
	const match = FALLBACK_REASON.exec(reason.trim());
	return match === null ? null : (match[1] ?? '');
}

/** Origin of a verdict sent by Refinr 1.4.0 or later (`aiReadySource`). */
export type VerdictSource = 'model' | 'fallback' | 'human';

/** `aiReadySource` when it is one of the known values, otherwise null (older Refinr, or an unknown value). */
export function verdictSource(value: unknown): VerdictSource | null {
	return value === 'model' || value === 'fallback' || value === 'human' ? value : null;
}

/**
 * Whether a story's verdict is Refinr's fallback: `aiReadySource` when Refinr sends it (1.4.0 or later), otherwise the
 * wording of the reason (Refinr 1.3 and older). Never true for an ai-ready story.
 */
export function isFallback(aiReady: unknown, reason: string, source: unknown): boolean {
	if (aiReady === true) {
		return false;
	}
	const known = verdictSource(source);
	return known !== null ? known === 'fallback' : fallbackCause(reason) !== null;
}
