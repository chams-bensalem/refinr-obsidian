// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
	alreadyAnalyzingMessage,
	analyzeTarget,
	isMarkdownNote,
	NO_NOTE_MESSAGE,
	type NoteRef,
} from '../src/analyze-target';

/** Shared by the "Analyze note" command and the ribbon button. */
const spec: NoteRef = { path: 'Specs/Order export.md', basename: 'Order export', extension: 'md' };
const canvas: NoteRef = { path: 'Board.canvas', basename: 'Board', extension: 'canvas' };

describe('isMarkdownNote (availability of the "Analyze note" command)', () => {
	it('is true for a Markdown note only', () => {
		expect(isMarkdownNote(spec)).toBe(true);
		expect(isMarkdownNote(canvas)).toBe(false);
		expect(isMarkdownNote(null)).toBe(false);
	});
});

describe('analyzeTarget', () => {
	it('analyzes the active Markdown note', () => {
		expect(analyzeTarget(spec, new Set())).toEqual({ kind: 'ready', file: spec });
	});

	it('keeps the same file object (the TFile is passed on to the analysis)', () => {
		const target = analyzeTarget(spec, new Set());
		expect(target.kind === 'ready' && target.file).toBe(spec);
	});

	it('refuses when no note is active', () => {
		expect(analyzeTarget(null, new Set())).toEqual({
			kind: 'no-note',
			message: 'Refinr: open a Markdown note to analyze it.',
		});
	});

	it('refuses a file that is not a Markdown note', () => {
		expect(analyzeTarget(canvas, new Set())).toEqual({ kind: 'no-note', message: NO_NOTE_MESSAGE });
	});

	it('refuses a note that is already being analyzed, with the message of the command', () => {
		expect(analyzeTarget(spec, new Set([spec.path]))).toEqual({
			kind: 'busy',
			message: 'Refinr: Order export is already being analyzed.',
		});
	});

	it('analyzes a note while another note is being analyzed', () => {
		expect(analyzeTarget(spec, new Set(['Other.md']))).toEqual({ kind: 'ready', file: spec });
	});
});

describe('alreadyAnalyzingMessage', () => {
	it('is the notice the command showed before the ribbon button', () => {
		expect(alreadyAnalyzingMessage('Order export')).toBe('Refinr: Order export is already being analyzed.');
	});
});
