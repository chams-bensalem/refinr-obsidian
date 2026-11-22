// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { RefinrError } from '../src/api/refinr-client';
import { nothingCreated, parseCreation } from '../src/creation';

/** Shaped like Refinr's creationResponse (BacklogController): created, failed and epics in every case. */
const COMPLETE = {
	success: true,
	message: 'Successfully created 4 issues',
	created: [
		{ type: 'epic', title: 'Order export', key: '#12', url: 'http://localhost:8090/work_packages/12' },
		{ type: 'story', title: 'CSV export', key: '#13', url: 'http://localhost:8090/work_packages/13' },
		{ type: 'subtask', title: 'Write the CSV', key: '#14', url: 'http://localhost:8090/work_packages/14' },
		{ type: 'story', title: 'Email export', key: '#15', url: null },
	],
	failed: [],
	epics: [
		{
			name: 'Order export',
			jiraKey: '#12',
			jiraUrl: null,
			stories: [
				{ title: 'CSV export', jiraKey: '#13', jiraUrl: null, aiReady: true, aiReadyReason: 'Clear scope', tasks: [{ title: 'Write the CSV', jiraKey: '#14' }] },
				{ title: 'Email export', jiraKey: '#15', jiraUrl: null, aiReady: false, aiReadyReason: 'Format not decided' },
			],
		},
	],
};

describe('parseCreation', () => {
	it('reads a complete creation, joins the story URLs by key and keeps the verdicts computed again', () => {
		expect(parseCreation(COMPLETE)).toEqual({
			created: COMPLETE.created,
			failed: [],
			epics: [{ title: 'Order export', key: '#12', url: 'http://localhost:8090/work_packages/12' }],
			stories: [
				{ title: 'CSV export', key: '#13', url: 'http://localhost:8090/work_packages/13', verdict: 'ai-ready', reason: 'Clear scope', fallback: false },
				{ title: 'Email export', key: '#15', url: null, verdict: 'validation-necessaire', reason: 'Format not decided', fallback: false },
			],
		});
	});

	it('reads a partial creation (207): stories without key are only in failed', () => {
		const partial = {
			success: false,
			message: 'Partially created: 2 issues created, 2 not created',
			created: [
				{ type: 'epic', title: 'A', key: 'P-1', url: 'https://jira.example/browse/P-1' },
				{ type: 'story', title: 'A1', key: 'P-2', url: 'https://jira.example/browse/P-2' },
			],
			failed: [
				{ type: 'story', title: 'A2', reason: 'Field "Story points" is not on the screen' },
				{ type: 'subtask', title: 'A2.1', reason: 'Not created: parent story A2 failed' },
			],
			epics: [{ name: 'A', jiraKey: 'P-1', stories: [{ title: 'A1', jiraKey: 'P-2', aiReady: false }, { title: 'A2', jiraKey: null, aiReady: false }] }],
		};
		const result = parseCreation(partial);
		expect(result?.stories.map((story) => story.key)).toEqual(['P-2']);
		expect(result?.failed).toEqual(partial.failed);
	});

	it('reads a 502 body (nothing created) with its failures', () => {
		const nothing = {
			success: false,
			error: 'No issue could be created',
			created: [],
			failed: [{ type: 'epic', title: 'A', reason: 'Project "x" not found' }, { type: 'story', title: 'A1', reason: 'Not created: parent epic A failed' }],
			epics: [{ name: 'A', jiraKey: null, stories: [{ title: 'A1', jiraKey: null }] }],
		};
		expect(parseCreation(nothing)).toEqual({ created: [], failed: nothing.failed, epics: [], stories: [] });
	});

	it('does not join by title: two stories with the same title keep their own URL', () => {
		const duplicates = {
			created: [
				{ type: 'story', title: 'Same', key: 'K-1', url: 'https://t/1' },
				{ type: 'story', title: 'Same', key: 'K-2', url: 'https://t/2' },
			],
			failed: [],
			epics: [{ name: 'E', jiraKey: null, stories: [{ title: 'Same', jiraKey: 'K-2' }, { title: 'Same', jiraKey: 'K-1' }] }],
		};
		expect(parseCreation(duplicates)?.stories.map((story) => story.url)).toEqual(['https://t/2', 'https://t/1']);
	});

	it("marks Refinr's fallback verdict (no reliable verdict, e.g. quota): validation-necessaire by default", () => {
		const fallback = {
			created: [{ type: 'story', title: 'S', key: '#152', url: 'http://op/152' }],
			failed: [],
			epics: [
				{
					name: 'E',
					jiraKey: null,
					stories: [
						{ title: 'S', jiraKey: '#152', aiReady: false, aiReadyReason: 'verdict indisponible (no verdict) : validation humaine necessaire' },
						{ title: 'T', jiraKey: '#153', aiReady: false, aiReadyReason: 'Format not decided' },
					],
				},
			],
		};
		expect(parseCreation(fallback)?.stories.map((story) => [story.key, story.verdict, story.fallback])).toEqual([
			['#152', 'validation-necessaire', true],
			['#153', 'validation-necessaire', false],
		]);
	});

	it('Refinr 1.4.0: the fallback is read from aiReadySource', () => {
		const answer = {
			created: [],
			failed: [],
			epics: [
				{
					name: 'E',
					jiraKey: null,
					stories: [
						{ title: 'S', jiraKey: '#160', aiReady: false, aiReadyReason: 'any wording', aiReadySource: 'fallback' },
						{ title: 'T', jiraKey: '#161', aiReady: false, aiReadyReason: 'Format not decided', aiReadySource: 'model' },
					],
				},
			],
		};
		expect(parseCreation(answer)?.stories.map((story) => [story.key, story.fallback])).toEqual([
			['#160', true],
			['#161', false],
		]);
	});

	it('keeps only http(s) URLs', () => {
		const odd = { created: [{ type: 'story', title: 'S', key: 'K', url: 'javascript:alert(1)' }], failed: [], epics: [] };
		expect(parseCreation(odd)?.created[0]?.url).toBeNull();
	});

	it.each([null, {}, { error: 'Failed to create the issues' }, { created: [], failed: 'x' }])('refuses %j (e.g. a 500 without lists)', (json) => {
		expect(parseCreation(json)).toBeNull();
	});
});

describe('nothingCreated', () => {
	it.each<[RefinrError, boolean]>([
		[{ kind: 'network', detail: 'net::ERR_CONNECTION_REFUSED' }, true],
		[{ kind: 'network', detail: 'net::ERR_NAME_NOT_RESOLVED' }, true],
		[{ kind: 'network', detail: 'connect ECONNREFUSED 127.0.0.1:8080' }, true],
		[{ kind: 'unauthorized', status: 401 }, true],
		[{ kind: 'host-not-allowed', status: 403 }, true],
		[{ kind: 'cors', status: 403 }, true],
		[{ kind: 'too-large', status: 413 }, true],
		[{ kind: 'http', status: 400, detail: 'Invalid projectKey: x' }, true],
		// The request may have reached Refinr: unknown, the issues may exist.
		[{ kind: 'network', detail: 'net::ERR_CONNECTION_RESET' }, false],
		[{ kind: 'network', detail: 'net::ERR_EMPTY_RESPONSE' }, false],
		[{ kind: 'network', detail: 'socket hang up' }, false],
		[{ kind: 'network' }, false],
		[{ kind: 'timeout', timeoutMs: 1000 }, false],
		[{ kind: 'http', status: 500, detail: 'Failed to create the issues' }, false],
		[{ kind: 'http', status: 502 }, false],
		[{ kind: 'invalid-response', status: 200 }, false],
	])('%j → %s', (error, expected) => {
		expect(nothingCreated(error)).toBe(expected);
	});
});
