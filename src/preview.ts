// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { isFallback } from './verdict';

/**
 * Backlog preview returned by `POST /api/v1/analyze-preview` (contract: Refinr's
 * `contract/analyze-preview-response.json`). Every string comes from a language model: it is untrusted and must be
 * displayed as plain text (see `preview-modal.ts`).
 */

/**
 * Refinr's readiness verdict; `unknown` when Refinr could not give one (missing, or its fallback verdict — written
 * as validation-necessaire in the tracker, see `verdict.ts`). Values match Refinr's tracker labels.
 */
export type Verdict = 'ai-ready' | 'validation-necessaire' | 'unknown';

export interface TaskView {
	title: string;
	description: string;
	estimatedHours: number | null;
}

export interface StoryView {
	title: string;
	description: string;
	asA: string;
	iWant: string;
	soThat: string;
	acceptanceCriteria: string[];
	storyPoints: number | null;
	priority: string;
	labels: string[];
	verdict: Verdict;
	verdictReason: string;
	tasks: TaskView[];
}

export interface EpicView {
	name: string;
	description: string;
	priority: string;
	labels: string[];
	stories: StoryView[];
}

export interface PreviewTotals {
	epics: number;
	stories: number;
	tasks: number;
	aiReady: number;
	needsValidation: number;
	noVerdict: number;
}

export interface Preview {
	epics: EpicView[];
	totals: PreviewTotals;
	/** The `epics` array exactly as received, sent back unchanged to `create-jira` (phase P3). */
	raw: unknown[];
}

/** Typed view of a preview answer, or null when the answer does not have the expected shape. */
export function parsePreview(json: unknown): Preview | null {
	if (!isRecord(json) || !Array.isArray(json.epics)) {
		return null;
	}
	const epics: EpicView[] = [];
	for (const rawEpic of json.epics) {
		const epic = parseEpic(rawEpic);
		if (epic === null) {
			return null;
		}
		epics.push(epic);
	}
	const stories = epics.flatMap((epic) => epic.stories);
	return {
		epics,
		totals: {
			epics: epics.length,
			stories: stories.length,
			tasks: stories.reduce((sum, story) => sum + story.tasks.length, 0),
			aiReady: stories.filter((story) => story.verdict === 'ai-ready').length,
			needsValidation: stories.filter((story) => story.verdict === 'validation-necessaire').length,
			noVerdict: stories.filter((story) => story.verdict === 'unknown').length,
		},
		raw: json.epics as unknown[],
	};
}

function parseEpic(raw: unknown): EpicView | null {
	if (!isRecord(raw)) {
		return null;
	}
	const stories = list(raw.stories, parseStory);
	if (stories === null) {
		return null;
	}
	return {
		name: text(raw.name),
		description: text(raw.description),
		priority: text(raw.priority),
		labels: strings(raw.labels),
		stories,
	};
}

function parseStory(raw: unknown): StoryView | null {
	if (!isRecord(raw)) {
		return null;
	}
	const tasks = list(raw.tasks, parseTask);
	if (tasks === null) {
		return null;
	}
	return {
		title: text(raw.title),
		description: text(raw.description),
		asA: text(raw.asA),
		iWant: text(raw.iWant),
		soThat: text(raw.soThat),
		acceptanceCriteria: strings(raw.acceptanceCriteria),
		storyPoints: count(raw.estimatedStoryPoints),
		priority: text(raw.priority),
		labels: strings(raw.labels),
		verdict: verdictOf(raw.aiReady, text(raw.aiReadyReason), raw.aiReadySource),
		verdictReason: text(raw.aiReadyReason),
		tasks,
	};
}

function verdictOf(aiReady: unknown, reason: string, source: unknown): Verdict {
	if (aiReady === true) {
		return 'ai-ready';
	}
	return aiReady === false && !isFallback(aiReady, reason, source) ? 'validation-necessaire' : 'unknown';
}

function parseTask(raw: unknown): TaskView | null {
	if (!isRecord(raw)) {
		return null;
	}
	return { title: text(raw.title), description: text(raw.description), estimatedHours: count(raw.estimatedHours) };
}

/** Missing list = empty; a list with an invalid element = invalid answer. */
function list<T>(value: unknown, parse: (raw: unknown) => T | null): T[] | null {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value)) {
		return null;
	}
	const items: T[] = [];
	for (const raw of value) {
		const item = parse(raw);
		if (item === null) {
			return null;
		}
		items.push(item);
	}
	return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
