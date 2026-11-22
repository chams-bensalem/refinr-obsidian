// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
	applyReassessment,
	applyValidation,
	applyRecord,
	pendingStories,
	recordFromCreation,
	recordSummary,
	recordTracker,
	type RefinrRecord,
	unknownRecord,
} from '../src/backlog-record';
import type { CreationResult } from '../src/creation';

const META = { date: '2026-11-13T21:40:00+01:00', tracker: 'OpenProject', project: 'demo' };

const COMPLETE: CreationResult = {
	created: [
		{ type: 'epic', title: 'Order export', key: '#12', url: 'http://op/wp/12' },
		{ type: 'story', title: 'CSV export', key: '#13', url: 'http://op/wp/13' },
		{ type: 'story', title: 'Email export', key: '#15', url: null },
	],
	failed: [],
	epics: [{ title: 'Order export', key: '#12', url: 'http://op/wp/12' }],
	stories: [
		{ title: 'CSV export', key: '#13', url: 'http://op/wp/13', verdict: 'ai-ready', reason: 'Clear', fallback: false },
		{ title: 'Email export', key: '#15', url: null, verdict: 'validation-necessaire', reason: 'Format', fallback: false },
	],
};

/** A note's frontmatter with the user's own properties, as processFrontMatter hands it. */
function userFrontmatter(): Record<string, unknown> {
	return { tags: ['spec', 'export'], status: 'draft', aliases: ['Export spec'] };
}

function record(date: string, overrides: Partial<RefinrRecord> = {}): RefinrRecord {
	const value = recordFromCreation(COMPLETE, { ...META, date });
	if (value === null) {
		throw new Error('unexpected');
	}
	return { ...value, ...overrides };
}

describe('recordFromCreation', () => {
	it('builds the schema: date, tracker, project, status, epics, stories with key, URL and verdict, failed', () => {
		expect(recordFromCreation(COMPLETE, META)).toEqual({
			created: '2026-11-13T21:40:00+01:00',
			tracker: 'OpenProject',
			project: 'demo',
			status: 'complete',
			epics: [{ title: 'Order export', key: '#12', url: 'http://op/wp/12' }],
			stories: [
				{ title: 'CSV export', key: '#13', url: 'http://op/wp/13', verdict: 'ai-ready' },
				{ title: 'Email export', key: '#15', url: null, verdict: 'validation-necessaire' },
			],
			failed: [],
		});
	});

	it('a partial creation is written with status partial and the failures as received', () => {
		const partial: CreationResult = { ...COMPLETE, failed: [{ type: 'story', title: 'Refunds', reason: 'Not created: parent epic X failed' }] };
		expect(recordFromCreation(partial, META)).toMatchObject({
			status: 'partial',
			failed: [{ type: 'story', title: 'Refunds', reason: 'Not created: parent epic X failed' }],
		});
	});

	it('nothing created (created[] empty, e.g. a 502): nothing to write', () => {
		expect(recordFromCreation({ created: [], failed: [{ type: 'epic', title: 'A', reason: 'x' }], epics: [], stories: [] }, META)).toBeNull();
	});

	it('a fallback verdict (AI unavailable) is marked verdictSource: fallback', () => {
		const fallback: CreationResult = {
			...COMPLETE,
			stories: [{ title: 'Email export', key: '#15', url: null, verdict: 'validation-necessaire', reason: 'x', fallback: true }],
		};
		expect(recordFromCreation(fallback, META)?.stories).toEqual([
			{ title: 'Email export', key: '#15', url: null, verdict: 'validation-necessaire', verdictSource: 'fallback' },
		]);
	});

	it('the default project is written as null', () => {
		expect(recordFromCreation(COMPLETE, { ...META, project: null })?.project).toBeNull();
	});
});

describe('applyRecord', () => {
	it("writes refinr and keeps the user's properties", () => {
		const fm = userFrontmatter();
		applyRecord(fm, record('d1'));
		expect(fm.tags).toEqual(['spec', 'export']);
		expect(fm.status).toBe('draft');
		expect(fm.aliases).toEqual(['Export spec']);
		expect(fm.refinr).toEqual(record('d1'));
		expect(fm.refinr).not.toHaveProperty('history');
	});

	it('a second creation moves the previous record to history: nothing overwritten or duplicated', () => {
		const fm = userFrontmatter();
		applyRecord(fm, record('d1'));
		applyRecord(fm, record('d2'));
		expect(fm.refinr).toEqual({ ...record('d2'), history: [record('d1')] });
		expect(fm.status).toBe('draft');
	});

	it('a third creation keeps history flat and chronological (no nesting, no entry lost)', () => {
		const fm = userFrontmatter();
		applyRecord(fm, record('d1'));
		applyRecord(fm, record('d2'));
		applyRecord(fm, record('d3'));
		expect(fm.refinr).toEqual({ ...record('d3'), history: [record('d1'), record('d2')] });
		const history = (fm.refinr as { history: Record<string, unknown>[] }).history;
		expect(history.every((entry) => !('history' in entry))).toBe(true);
	});

	it('an unknown outcome is recorded too, and moved to history by the next creation', () => {
		const fm = userFrontmatter();
		applyRecord(fm, unknownRecord(META));
		expect(fm.refinr).toEqual({
			created: META.date,
			tracker: 'OpenProject',
			project: 'demo',
			status: 'unknown',
			epics: [],
			stories: [],
			failed: [],
		});
		applyRecord(fm, record('d2'));
		expect((fm.refinr as { history: { status: string }[] }).history.map((entry) => entry.status)).toEqual(['unknown']);
	});

	it('a hand-edited or odd refinr value is kept in history, not lost', () => {
		const fm: Record<string, unknown> = { refinr: 'see the tracker', status: 'draft' };
		applyRecord(fm, record('d2'));
		expect((fm.refinr as { history: unknown[] }).history).toEqual(['see the tracker']);
		const nested: Record<string, unknown> = { refinr: { created: 'd0', history: { created: 'old' } } };
		applyRecord(nested, record('d2'));
		expect((nested.refinr as { history: unknown[] }).history).toEqual([{ created: 'old' }, { created: 'd0' }]);
	});
});

describe('reading the record', () => {
	it('summary for the warning before creating again', () => {
		const fm = userFrontmatter();
		expect(recordSummary(fm)).toBeNull();
		applyRecord(fm, record('d1'));
		applyRecord(fm, record('d2'));
		expect(recordSummary(fm)).toEqual({ created: 'd2', tracker: 'OpenProject', status: 'complete', stories: 2, previous: 1 });
		expect(recordSummary({ refinr: 42 })).toMatchObject({ status: 'unreadable' });
	});

	it('tracker and stories awaiting validation (current record only, entries without key skipped)', () => {
		const fm = userFrontmatter();
		applyRecord(fm, record('d1'));
		(fm.refinr as { stories: unknown[] }).stories.push({ title: 'hand-written', verdict: 'validation-necessaire' });
		expect(recordTracker(fm)).toBe('OpenProject');
		expect(pendingStories(fm)).toEqual([{ title: 'Email export', key: '#15' }]);
		expect(pendingStories(null)).toEqual([]);
		expect(pendingStories({ refinr: { stories: 'x' } })).toEqual([]);
	});
});

describe('applyReassessment', () => {
	it("updates the verdict and the date of the story, nothing else (user's properties kept)", () => {
		const fm = userFrontmatter();
		applyRecord(fm, record('d1'));
		expect(applyReassessment(fm, '#15', 'ai-ready', 'd9')).toBe(true);
		const stories = (fm.refinr as { stories: Record<string, unknown>[] }).stories;
		expect(stories[1]).toEqual({ title: 'Email export', key: '#15', url: null, verdict: 'ai-ready', reassessed: 'd9' });
		expect(stories[0]).toEqual({ title: 'CSV export', key: '#13', url: 'http://op/wp/13', verdict: 'ai-ready' });
		expect(fm.status).toBe('draft');
		expect(pendingStories(fm)).toEqual([]);
	});

	it('a reassessment replaces a fallback verdict: verdictSource removed', () => {
		const fm = userFrontmatter();
		applyRecord(fm, record('d1'));
		const stories = (fm.refinr as { stories: Record<string, unknown>[] }).stories;
		(stories[1] as Record<string, unknown>).verdictSource = 'fallback';
		expect(pendingStories(fm)).toEqual([{ title: 'Email export', key: '#15' }]);
		expect(applyReassessment(fm, '#15', 'validation-necessaire', 'd9')).toBe(true);
		expect(stories[1]).toEqual({ title: 'Email export', key: '#15', url: null, verdict: 'validation-necessaire', reassessed: 'd9' });
	});

	it('a story removed from the note meanwhile: nothing changed', () => {
		const fm = userFrontmatter();
		applyRecord(fm, record('d1'));
		const before = structuredClone(fm);
		expect(applyReassessment(fm, '#99', 'ai-ready', 'd9')).toBe(false);
		expect(applyReassessment({ status: 'draft' }, '#15', 'ai-ready', 'd9')).toBe(false);
		expect(fm).toEqual(before);
	});
});

describe('applyValidation', () => {
	it('marks the story ai-ready by a human, with the date, nothing else changed', () => {
		const fm = userFrontmatter();
		applyRecord(fm, record('d1'));
		expect(applyValidation(fm, '#15', 'd9')).toBe(true);
		const stories = (fm.refinr as { stories: Record<string, unknown>[] }).stories;
		expect(stories[1]).toEqual({ title: 'Email export', key: '#15', url: null, verdict: 'ai-ready', verdictSource: 'human', validated: 'd9' });
		expect(fm.status).toBe('draft');
		expect(pendingStories(fm)).toEqual([]);
	});

	it('a story removed from the note meanwhile: nothing changed', () => {
		const fm = userFrontmatter();
		applyRecord(fm, record('d1'));
		const before = structuredClone(fm);
		expect(applyValidation(fm, '#99', 'd9')).toBe(false);
		expect(fm).toEqual(before);
	});
});
