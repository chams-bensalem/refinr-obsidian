// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ANALYSIS_TIMEOUT_SECONDS,
	DEFAULT_SETTINGS,
	integerError,
	normalizeSettings,
	SETTING_LIMITS,
	urlError,
} from '../src/settings';

describe('normalizeSettings', () => {
	it.each([undefined, null, 'garbage', 42, []])('uses the defaults for %j', (raw) => {
		expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
	});

	it('keeps valid values and trims text', () => {
		expect(
			normalizeSettings({
				refinrUrl: ' https://refinr.example.org ',
				apiKeySecret: 'refinr-api-key',
				defaultProjectKey: ' demo ',
				embedMaxDepth: 5,
				embedMaxChars: 50000,
				analysisTimeoutSeconds: 600,
				defaultLanguage: ' en ',
			}),
		).toEqual({
			refinrUrl: 'https://refinr.example.org',
			apiKeySecret: 'refinr-api-key',
			defaultProjectKey: 'demo',
			embedMaxDepth: 5,
			embedMaxChars: 50000,
			analysisTimeoutSeconds: 600,
			defaultLanguage: 'en',
		});
	});

	it('clamps numbers to their limits and ignores wrong types', () => {
		const settings = normalizeSettings({ embedMaxDepth: 99, embedMaxChars: -1, analysisTimeoutSeconds: 1.5, refinrUrl: 3 });
		expect(settings.embedMaxDepth).toBe(SETTING_LIMITS.embedMaxDepth.max);
		expect(settings.embedMaxChars).toBe(SETTING_LIMITS.embedMaxChars.min);
		expect(settings.analysisTimeoutSeconds).toBe(DEFAULT_ANALYSIS_TIMEOUT_SECONDS);
		expect(settings.refinrUrl).toBe(DEFAULT_SETTINGS.refinrUrl);
	});

	it('never stores a key value, only a secret name', () => {
		expect(Object.keys(normalizeSettings({ apiKey: 'value' }))).not.toContain('apiKey');
	});
});

describe('default analysis timeout', () => {
	it("covers Refinr's worst case with default settings", () => {
		const call = (timeout: number) => timeout + 2 * 30; // timeout + 2 retry delays capped at 30 s
		const structured = (timeout: number) => 3 * call(timeout); // 1 call + 2 schema repairs
		const worstCase = structured(300) + structured(90); // analysis + one separate verdict batch
		expect(worstCase).toBe(1530);
		expect(DEFAULT_ANALYSIS_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(worstCase);
	});
});

describe('integerError', () => {
	const limits = { min: 0, max: 10 };
	it.each([0, 7, 10])('accepts %d', (value) => {
		expect(integerError(value, limits)).toBeUndefined();
	});
	it.each([-1, 11, 2.5, Number.NaN])('refuses %d', (value) => {
		expect(integerError(value, limits)).toBe('Enter a whole number from 0 to 10.');
	});
});

describe('urlError', () => {
	it('accepts an http(s) URL', () => {
		expect(urlError('http://localhost:8080')).toBeUndefined();
		expect(urlError('https://refinr.example.org/')).toBeUndefined();
	});
	it.each(['', 'localhost:8080', 'ftp://host'])('refuses %j', (value) => {
		expect(urlError(value)).toBe('Enter an http:// or https:// URL.');
	});
});
