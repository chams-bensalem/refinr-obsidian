// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT

/** What the plugin needs to know about the active file (an Obsidian `TFile` fits). */
export interface NoteRef {
	path: string;
	basename: string;
	extension: string;
}

/**
 * Decision shared by the "Analyze note" command and the ribbon button: which note to analyze, or why not.
 * - `no-note`: no active Markdown note (the command is then unavailable, the button shows the message);
 * - `busy`: this note is already being analyzed (one analysis at a time per note);
 * - `ready`: analyze this note.
 */
export type AnalyzeTarget<F extends NoteRef> =
	| { kind: 'ready'; file: F }
	| { kind: 'no-note'; message: string }
	| { kind: 'busy'; message: string };

export const NO_NOTE_MESSAGE = 'Refinr: open a Markdown note to analyze it.';

export function alreadyAnalyzingMessage(basename: string): string {
	return `Refinr: ${basename} is already being analyzed.`;
}

export function isMarkdownNote<F extends NoteRef>(file: F | null): file is F {
	return file !== null && file.extension === 'md';
}

export function analyzeTarget<F extends NoteRef>(file: F | null, analyzing: ReadonlySet<string>): AnalyzeTarget<F> {
	if (!isMarkdownNote(file)) {
		return { kind: 'no-note', message: NO_NOTE_MESSAGE };
	}
	if (analyzing.has(file.path)) {
		return { kind: 'busy', message: alreadyAnalyzingMessage(file.basename) };
	}
	return { kind: 'ready', file };
}
