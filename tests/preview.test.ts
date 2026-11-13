// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parsePreview } from '../src/preview';

/** Refinr's frozen contract (backend/src/test/resources/contract/analyze-preview-response.json). */
const CONTRACT = {
	success: true,
	message: 'Preview generated successfully',
	epics: [
		{
			name: 'Epic: Inventaire',
			description: 'Gestion des stocks',
			priority: 'High',
			labels: ['backend', 'api'],
			stories: [
				{
					title: 'Track Stock',
					description: 'Story description',
					acceptanceCriteria: ['AC1', 'AC2'],
					priority: 'Medium',
					labels: ['api'],
					tasks: [
						{
							title: 'Create service',
							description: 'Task description',
							labels: ['backend'],
							estimatedHours: 4,
							jiraKey: 'PROJ-3',
							jiraUrl: 'https://your-site.atlassian.net/browse/PROJ-3',
							parentStoryKey: 'PROJ-2',
						},
					],
					dependencies: ['PROJ-0'],
					jiraKey: 'PROJ-2',
					jiraUrl: 'https://your-site.atlassian.net/browse/PROJ-2',
					epicKey: 'PROJ-1',
					asA: 'Developer',
					iWant: 'track stock levels',
					soThat: 'avoid stock-outs',
					estimatedStoryPoints: 5,
					aiReady: true,
					aiReadyReason: 'Perimetre clair',
				},
			],
			jiraKey: 'PROJ-1',
			jiraUrl: 'https://your-site.atlassian.net/browse/PROJ-1',
		},
	],
};

describe('parsePreview', () => {
	it("reads Refinr's contract", () => {
		const preview = parsePreview(CONTRACT);
		expect(preview?.epics).toEqual([
			{
				name: 'Epic: Inventaire',
				description: 'Gestion des stocks',
				priority: 'High',
				labels: ['backend', 'api'],
				stories: [
					{
						title: 'Track Stock',
						description: 'Story description',
						asA: 'Developer',
						iWant: 'track stock levels',
						soThat: 'avoid stock-outs',
						acceptanceCriteria: ['AC1', 'AC2'],
						storyPoints: 5,
						priority: 'Medium',
						labels: ['api'],
						verdict: 'ai-ready',
						verdictReason: 'Perimetre clair',
						tasks: [{ title: 'Create service', description: 'Task description', estimatedHours: 4 }],
					},
				],
			},
		]);
		expect(preview?.totals).toEqual({ epics: 1, stories: 1, tasks: 1, aiReady: 1, needsValidation: 0, noVerdict: 0 });
	});

	it('keeps the raw epics unchanged for the creation (P3)', () => {
		const preview = parsePreview(structuredClone(CONTRACT));
		expect(preview?.raw).toEqual(CONTRACT.epics);
	});

	it('maps aiReady false to validation-necessaire and a missing verdict to unknown', () => {
		const preview = parsePreview({
			epics: [{ name: 'E', stories: [{ title: 'A', aiReady: false }, { title: 'B', aiReady: null }, { title: 'C' }] }],
		});
		expect(preview?.epics[0]?.stories.map((story) => story.verdict)).toEqual(['validation-necessaire', 'unknown', 'unknown']);
		expect(preview?.totals).toMatchObject({ aiReady: 0, needsValidation: 1, noVerdict: 2 });
	});

	it("Refinr's fallback verdict is shown as no verdict (unknown)", () => {
		const preview = parsePreview({
			epics: [
				{
					name: 'E',
					stories: [{ title: 'A', aiReady: false, aiReadyReason: 'verdict indisponible (LlmException) : validation humaine necessaire' }],
				},
			],
		});
		expect(preview?.epics[0]?.stories[0]?.verdict).toBe('unknown');
		expect(preview?.totals).toMatchObject({ needsValidation: 0, noVerdict: 1 });
	});

	it('accepts missing optional fields', () => {
		const preview = parsePreview({ epics: [{ stories: [{}] }] });
		expect(preview?.epics[0]).toMatchObject({ name: '', labels: [], stories: [{ title: '', tasks: [], storyPoints: null }] });
	});

	it('keeps text from the model exactly as received (no interpretation)', () => {
		const hostile = '<img src=x onerror="alert(1)"> **bold** [[link]]';
		const preview = parsePreview({ epics: [{ name: hostile, stories: [{ title: hostile, acceptanceCriteria: [hostile] }] }] });
		expect(preview?.epics[0]?.name).toBe(hostile);
		expect(preview?.epics[0]?.stories[0]?.acceptanceCriteria).toEqual([hostile]);
	});

	it('an empty backlog is valid', () => {
		expect(parsePreview({ success: true, epics: [] })?.totals.epics).toBe(0);
	});

	it.each([null, 'text', [], {}, { epics: 'x' }, { epics: [1] }, { epics: [{ stories: 'x' }] }, { epics: [{ stories: [{ tasks: [3] }] }] }])(
		'refuses %j',
		(json) => {
			expect(parsePreview(json)).toBeNull();
		},
	);
});
