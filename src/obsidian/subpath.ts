// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import type { BlockSubpathResult, FootnoteSubpathResult, HeadingSubpathResult, ListItemCache } from 'obsidian';
import { extendListBlock, type ListItemRef, type TextRange } from '../embeds';

export type SubpathResultLike = HeadingSubpathResult | BlockSubpathResult | FootnoteSubpathResult;

/** Range of a `#Heading` / `#^block` subpath; `listIncomplete` when the sub-items of a list item could not be added. */
export interface SubpathRange extends TextRange {
	listIncomplete?: true;
}

/**
 * Converts Obsidian's `resolveSubpath` result into a text range. A block on a list item is extended to all its
 * sub-items (`extendListBlock`). Never throws: the real cache may hold `list: null` (block on a paragraph), no
 * `listItems`, or items without the expected fields; when the extension cannot be computed, the item's own range is
 * kept and `listIncomplete` is set (shown as a warning).
 */
export function subpathRange(result: SubpathResultLike, listItems: readonly (ListItemCache | null | undefined)[] | null | undefined): SubpathRange {
	const start = result.start.offset;
	const end = result.end?.offset ?? null;
	if (result.type !== 'block') {
		return { start, end };
	}
	// `list` is null (or absent) for a block on a paragraph, a heading, a table…: nothing to extend.
	const list: unknown = (result as { list?: unknown }).list;
	if (list === undefined || list === null) {
		return { start, end };
	}
	try {
		const line = numberAt(list, 'position', 'start', 'line');
		if (line === null || end === null || !Array.isArray(listItems)) {
			return { start, end, listIncomplete: true };
		}
		const items: ListItemRef[] = [];
		for (const item of listItems) {
			const ref = toRef(item);
			if (ref !== null) {
				items.push(ref);
			}
		}
		if (!items.some((item) => item.line === line)) {
			return { start, end, listIncomplete: true };
		}
		return { start, end: extendListBlock(items, line, end) };
	} catch {
		return { start, end, listIncomplete: true };
	}
}

/** `parent` is a line number (negative or 0 for a root item), not an object. */
function toRef(item: unknown): ListItemRef | null {
	const line = numberAt(item, 'position', 'start', 'line');
	const col = numberAt(item, 'position', 'start', 'col');
	const end = numberAt(item, 'position', 'end', 'offset');
	const parent = numberAt(item, 'parent');
	return line === null || col === null || end === null || parent === null ? null : { line, col, parent, end };
}

function numberAt(value: unknown, ...path: string[]): number | null {
	let current = value;
	for (const key of path) {
		if (typeof current !== 'object' || current === null) {
			return null;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === 'number' && Number.isFinite(current) ? current : null;
}
