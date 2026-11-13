// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import type { ListItemCache } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { type SubpathResultLike, subpathRange } from '../src/obsidian/subpath';

/**
 * Fixtures shaped like Obsidian's real objects (resolveSubpath result, cache.listItems): Loc = {line, col, offset},
 * `list: null` on a paragraph block, `parent` = line number (negative for a root item).
 */
const loc = (line: number, col: number, offset: number) => ({ line, col, offset });
const item = (line: number, col: number, start: number, end: number, parent: number) =>
	({ position: { start: loc(line, col, start), end: loc(line, col + (end - start), end) }, parent }) as unknown as ListItemCache;

// "- first item\n- second item with child ^item\n  - child of second item\n- third item\n" at offset 100, line 10
const LIST_ITEMS = [item(10, 0, 100, 112, -10), item(11, 0, 113, 143, -10), item(12, 2, 146, 168, 11), item(13, 0, 169, 181, -10)];
const itemBlock = {
	type: 'block',
	block: { id: 'item', position: { start: loc(11, 0, 113), end: loc(11, 30, 143) } },
	list: LIST_ITEMS[1],
	start: loc(11, 0, 113),
	end: loc(11, 30, 143),
} as unknown as SubpathResultLike;

describe('subpathRange', () => {
	it('a block on a paragraph (list: null, the crash of the first P2 build) keeps its range', () => {
		const paragraph = {
			type: 'block',
			block: { id: 'vat', position: { start: loc(5, 0, 50), end: loc(5, 29, 79) } },
			list: null,
			start: loc(5, 0, 50),
			end: loc(5, 29, 79),
		} as unknown as SubpathResultLike;
		expect(subpathRange(paragraph, LIST_ITEMS)).toEqual({ start: 50, end: 79 });
	});

	it('a heading keeps its range, end null = end of the note', () => {
		const heading = { type: 'heading', current: {}, next: null, start: loc(2, 0, 10), end: null } as unknown as SubpathResultLike;
		expect(subpathRange(heading, undefined)).toEqual({ start: 10, end: null });
	});

	it('a list item block is extended to its sub-items, not to the next sibling', () => {
		expect(subpathRange(itemBlock, LIST_ITEMS)).toEqual({ start: 113, end: 168 });
	});

	it('no listItems in the cache: the item alone, marked incomplete', () => {
		expect(subpathRange(itemBlock, undefined)).toEqual({ start: 113, end: 143, listIncomplete: true });
		expect(subpathRange(itemBlock, null)).toEqual({ start: 113, end: 143, listIncomplete: true });
	});

	it('listItems without the line of the block: the item alone, marked incomplete', () => {
		expect(subpathRange(itemBlock, [LIST_ITEMS[0] as ListItemCache])).toEqual({ start: 113, end: 143, listIncomplete: true });
	});

	it('null or malformed list items are ignored, never thrown on', () => {
		const malformed = [null, undefined, { parent: 3 } as unknown as ListItemCache, { position: null, parent: 1 } as unknown as ListItemCache, ...LIST_ITEMS];
		expect(subpathRange(itemBlock, malformed)).toEqual({ start: 113, end: 168 });
	});

	it('a list without position: the item alone, marked incomplete', () => {
		const broken = { ...(itemBlock as object), list: { parent: -10 } } as unknown as SubpathResultLike;
		expect(subpathRange(broken, LIST_ITEMS)).toEqual({ start: 113, end: 143, listIncomplete: true });
	});
});

/**
 * Non-regression on the REAL cache (Obsidian 1.15.1, test vault note P2/Sections.md, captured from the console during
 * the P2 trial): `list: null` on a paragraph block made the first P2 build throw "Cannot read properties of null".
 * Lines start at 0; a root item has `parent` = minus the first line of the list (-12); a sub-item has the line of its
 * parent (13).
 */
describe('subpathRange on the real cache of P2/Sections.md', () => {
	const SECTIONS = "# Sections\n\n## Scope\nOnly paid orders are exported.\n### Detail\nCancelled orders are excluded.\n\n## Out of scope\nRefunds are not exported.\n\nAll amounts include VAT. ^vat\n\n- first item\n- second item with child ^item\n  - child of second item\n- third item\n";
	const LIST_ITEMS = [{"parent": -12, "position": {"start": {"line": 12, "col": 0, "offset": 169}, "end": {"line": 12, "col": 12, "offset": 181}}}, {"parent": -12, "id": "item", "position": {"start": {"line": 13, "col": 0, "offset": 182}, "end": {"line": 13, "col": 30, "offset": 212}}}, {"parent": 13, "position": {"start": {"line": 14, "col": 2, "offset": 215}, "end": {"line": 14, "col": 24, "offset": 237}}}, {"parent": -12, "position": {"start": {"line": 15, "col": 0, "offset": 238}, "end": {"line": 15, "col": 12, "offset": 250}}}] as unknown as ListItemCache[];
	const VAT = {"type": "block", "block": {"id": "vat", "position": {"start": {"line": 10, "col": 0, "offset": 138}, "end": {"line": 10, "col": 29, "offset": 167}}}, "list": null, "start": {"line": 10, "col": 0, "offset": 138}, "end": {"line": 10, "col": 29, "offset": 167}} as unknown as SubpathResultLike;
	const ITEM = {"type": "block", "block": {"id": "item", "position": {"start": {"line": 13, "col": 0, "offset": 182}, "end": {"line": 13, "col": 30, "offset": 212}}}, "list": {"parent": -12, "id": "item", "position": {"start": {"line": 13, "col": 0, "offset": 182}, "end": {"line": 13, "col": 30, "offset": 212}}}, "start": {"line": 13, "col": 0, "offset": 182}, "end": {"line": 13, "col": 30, "offset": 212}} as unknown as SubpathResultLike;
	const SCOPE = {"type": "heading", "current": {"heading": "Scope", "level": 2, "position": {"start": {"line": 2, "col": 0, "offset": 12}, "end": {"line": 2, "col": 8, "offset": 20}}}, "next": {"heading": "Out of scope", "level": 2, "position": {"start": {"line": 7, "col": 0, "offset": 95}, "end": {"line": 7, "col": 15, "offset": 110}}}, "start": {"line": 2, "col": 0, "offset": 12}, "end": {"line": 7, "col": 0, "offset": 95}} as unknown as SubpathResultLike;
	const slice = (range: { start: number; end: number | null }) => SECTIONS.slice(range.start, range.end ?? undefined);

	it('#^vat (list: null): the paragraph alone, no error', () => {
		expect(subpathRange(VAT, LIST_ITEMS)).toEqual({ start: 138, end: 167 });
		expect(slice(subpathRange(VAT, LIST_ITEMS))).toBe('All amounts include VAT. ^vat');
	});

	it('#^item: the item and its sub-item, not the next sibling', () => {
		const range = subpathRange(ITEM, LIST_ITEMS);
		expect(range).toEqual({ start: 182, end: 237 });
		expect(slice(range)).toBe('- second item with child ^item\n  - child of second item');
	});

	it('#Scope: the heading section, unchanged', () => {
		expect(slice(subpathRange(SCOPE, LIST_ITEMS))).toBe('## Scope\nOnly paid orders are exported.\n### Detail\nCancelled orders are excluded.\n\n');
	});
});
