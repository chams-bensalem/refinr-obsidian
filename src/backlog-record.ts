// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import type { CreatedVerdict, CreationResult, FailedIssue } from './creation';

/**
 * The `refinr` frontmatter property: what was created from this note. Pure functions working on the frontmatter object
 * handed by `fileManager.processFrontMatter` (mutated in place, synchronously); every other property of the note is
 * left untouched.
 */
export const RECORD_KEY = 'refinr';

export type RecordStatus = 'complete' | 'partial' | 'unknown';

export interface StoryRecord {
	title: string;
	key: string;
	url: string | null;
	verdict: CreatedVerdict;
	/**
	 * `fallback`: Refinr could not give a verdict (e.g. AI unavailable) and applied validation-necessaire by default;
	 * `human`: marked ai-ready by a person with "Validate a story" (no model call). Absent: verdict of the model.
	 */
	verdictSource?: 'fallback' | 'human';
	/** Date of the last reassessment, when there was one. */
	reassessed?: string;
	/** Date of the human validation, when there was one. */
	validated?: string;
}

export interface RefinrRecord {
	created: string;
	tracker: string;
	/** Project sent to Refinr; null = Refinr's default project. */
	project: string | null;
	status: RecordStatus;
	epics: { title: string; key: string; url: string | null }[];
	stories: StoryRecord[];
	failed: FailedIssue[];
	/** Previous creations from this note, oldest first, flat (never nested). */
	history?: unknown[];
}

export interface RecordMeta {
	date: string;
	tracker: string;
	project: string | null;
}

/** Summary of an existing record, for the warning shown before creating again. */
export interface RecordSummary {
	created: string;
	tracker: string;
	status: string;
	stories: number;
	previous: number;
}

/** Record of a creation answer; null when nothing was created (`created[]` empty): nothing to write then. */
export function recordFromCreation(result: CreationResult, meta: RecordMeta): RefinrRecord | null {
	if (result.created.length === 0) {
		return null;
	}
	return {
		created: meta.date,
		tracker: meta.tracker,
		project: meta.project,
		status: result.failed.length === 0 ? 'complete' : 'partial',
		epics: result.epics.map((epic) => ({ title: epic.title, key: epic.key, url: epic.url })),
		stories: result.stories.map((story) => ({
			title: story.title,
			key: story.key,
			url: story.url,
			verdict: story.verdict,
			...(story.fallback ? { verdictSource: 'fallback' as const } : {}),
		})),
		failed: result.failed.map((issue) => ({ type: issue.type, title: issue.title, reason: issue.reason })),
	};
}

/** Record of a creation whose outcome is unknown (timeout, connection lost after sending): issues may exist. */
export function unknownRecord(meta: RecordMeta): RefinrRecord {
	return { created: meta.date, tracker: meta.tracker, project: meta.project, status: 'unknown', epics: [], stories: [], failed: [] };
}

/**
 * Writes `record` as the note's `refinr` property. An existing record is never overwritten nor lost: it moves to
 * `history`, and its own history is lifted to the same level (flat list, oldest first).
 */
export function applyRecord(frontmatter: Record<string, unknown>, record: RefinrRecord): void {
	const previous = frontmatter[RECORD_KEY];
	const history: unknown[] = [];
	if (previous !== undefined && previous !== null) {
		if (isRecord(previous)) {
			const { history: older, ...rest } = previous;
			if (Array.isArray(older)) {
				history.push(...(older as unknown[]));
			} else if (older !== undefined && older !== null) {
				history.push(older);
			}
			history.push(rest);
		} else {
			history.push(previous);
		}
	}
	const value: RefinrRecord = { ...record };
	if (history.length > 0) {
		value.history = history;
	}
	frontmatter[RECORD_KEY] = value;
}

/** Summary of the note's record, or null when the note has none. */
export function recordSummary(frontmatter: Record<string, unknown> | null | undefined): RecordSummary | null {
	const record = frontmatter?.[RECORD_KEY];
	if (record === undefined || record === null) {
		return null;
	}
	if (!isRecord(record)) {
		return { created: '', tracker: '', status: 'unreadable', stories: 0, previous: 0 };
	}
	return {
		created: text(record.created),
		tracker: text(record.tracker),
		status: text(record.status),
		stories: Array.isArray(record.stories) ? record.stories.length : 0,
		previous: Array.isArray(record.history) ? record.history.length : 0,
	};
}

/** Tracker the note's record was created in, or null. */
export function recordTracker(frontmatter: Record<string, unknown> | null | undefined): string | null {
	const record = frontmatter?.[RECORD_KEY];
	return isRecord(record) && typeof record.tracker === 'string' && record.tracker !== '' ? record.tracker : null;
}

/** Stories of the current record still awaiting validation (hand-edited entries without a key are skipped). */
export function pendingStories(frontmatter: Record<string, unknown> | null | undefined): { title: string; key: string }[] {
	const record = frontmatter?.[RECORD_KEY];
	if (!isRecord(record) || !Array.isArray(record.stories)) {
		return [];
	}
	return record.stories
		.filter(isRecord)
		.filter((story) => story.verdict === 'validation-necessaire' && typeof story.key === 'string' && story.key !== '')
		.map((story) => ({ title: text(story.title), key: story.key as string }));
}

/**
 * New verdict of a reassessed story in the current record (`verdict` and `reassessed` updated, other fields kept).
 * Returns false when the story is no longer in the record (edited meanwhile): nothing is changed then.
 */
export function applyReassessment(
	frontmatter: Record<string, unknown>,
	key: string,
	verdict: CreatedVerdict,
	date: string,
): boolean {
	const record = frontmatter[RECORD_KEY];
	if (!isRecord(record) || !Array.isArray(record.stories)) {
		return false;
	}
	const story = record.stories.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry.key === key);
	if (story === undefined) {
		return false;
	}
	story.verdict = verdict;
	// A reassessment is a real verdict from the model: no longer a fallback.
	delete story.verdictSource;
	story.reassessed = date;
	return true;
}

/**
 * Human validation of a story in the current record: `ai-ready`, `verdictSource: human` and `validated` (other fields
 * kept). Returns false when the story is no longer in the record: nothing is changed then.
 */
export function applyValidation(frontmatter: Record<string, unknown>, key: string, date: string): boolean {
	const record = frontmatter[RECORD_KEY];
	if (!isRecord(record) || !Array.isArray(record.stories)) {
		return false;
	}
	const story = record.stories.find((entry): entry is Record<string, unknown> => isRecord(entry) && entry.key === key);
	if (story === undefined) {
		return false;
	}
	story.verdict = 'ai-ready';
	story.verdictSource = 'human';
	story.validated = date;
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}
