// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { normalizeBaseUrl } from './api/refinr-client';

/** Plugin settings, saved in the plugin's `data.json`. The API key itself is never here: only its secret name. */
export interface RefinrSettings {
	/** Base URL of the Refinr server. */
	refinrUrl: string;
	/** Name of the secret (Obsidian SecretStorage) holding the Refinr API key; empty when Refinr has no key. */
	apiKeySecret: string;
	/** Project key used when creating issues; empty = Refinr's configured default. */
	defaultProjectKey: string;
	/** Maximum nesting of expanded `![[embeds]]` (0 = embeds are not expanded). */
	embedMaxDepth: number;
	/** Maximum number of characters added by expanded embeds, all levels together. */
	embedMaxChars: number;
	/** How long the plugin waits for an analysis before giving up (Refinr may still be working). */
	analysisTimeoutSeconds: number;
}

/**
 * Worst case of one analysis with Refinr's default settings (see DECISIONS.md):
 * analysis 3 calls (1 + 2 repairs) x (300 s timeout + 2 x 30 s retry delays) = 1080 s,
 * plus one separate verdict batch 3 x (90 s + 60 s) = 450 s, plus 30 s margin.
 */
export const DEFAULT_ANALYSIS_TIMEOUT_SECONDS = 1560;

export const DEFAULT_SETTINGS: Readonly<RefinrSettings> = {
	refinrUrl: 'http://localhost:8080',
	apiKeySecret: '',
	defaultProjectKey: '',
	embedMaxDepth: 3,
	embedMaxChars: 100_000,
	analysisTimeoutSeconds: DEFAULT_ANALYSIS_TIMEOUT_SECONDS,
};

export const SETTING_LIMITS = {
	embedMaxDepth: { min: 0, max: 10 },
	embedMaxChars: { min: 0, max: 1_000_000 },
	analysisTimeoutSeconds: { min: 60, max: 7200 },
} as const;

/** Reads saved data (any shape, possibly from an older version) into valid settings. */
export function normalizeSettings(raw: unknown): RefinrSettings {
	const data = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
	return {
		refinrUrl: text(data.refinrUrl, DEFAULT_SETTINGS.refinrUrl),
		apiKeySecret: text(data.apiKeySecret, DEFAULT_SETTINGS.apiKeySecret),
		defaultProjectKey: text(data.defaultProjectKey, DEFAULT_SETTINGS.defaultProjectKey),
		embedMaxDepth: integer(data.embedMaxDepth, DEFAULT_SETTINGS.embedMaxDepth, SETTING_LIMITS.embedMaxDepth),
		embedMaxChars: integer(data.embedMaxChars, DEFAULT_SETTINGS.embedMaxChars, SETTING_LIMITS.embedMaxChars),
		analysisTimeoutSeconds: integer(
			data.analysisTimeoutSeconds,
			DEFAULT_SETTINGS.analysisTimeoutSeconds,
			SETTING_LIMITS.analysisTimeoutSeconds,
		),
	};
}

/** Inline error for the Refinr URL setting, or undefined when the URL is usable. */
export function urlError(value: string): string | undefined {
	return normalizeBaseUrl(value) === null ? 'Enter an http:// or https:// URL.' : undefined;
}

/** Inline error for an integer setting, or undefined when the value is a whole number within the limits. */
export function integerError(value: number, limits: { min: number; max: number }): string | undefined {
	return Number.isInteger(value) && value >= limits.min && value <= limits.max
		? undefined
		: `Enter a whole number from ${limits.min} to ${limits.max}.`;
}

function text(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value.trim() : fallback;
}

function integer(value: unknown, fallback: number, limits: { min: number; max: number }): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		return fallback;
	}
	return Math.min(limits.max, Math.max(limits.min, value));
}
