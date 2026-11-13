// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
	describeWarning,
	type EmbedRef,
	type EmbedResolver,
	expandNote,
	type ExpansionOptions,
	extendListBlock,
	type ListItemRef,
	type NoteSource,
	splitLink,
} from '../src/embeds';

/**
 * Fake vault: builds what Obsidian's metadata cache would give (embed offsets, code blocks, headings, blocks) from
 * Markdown, with simplified rules good enough for the tests.
 */
function note(path: string, content: string, options: { indexed?: boolean; embeds?: EmbedRef[] } = {}): NoteSource {
	const frontmatter = /^---\n[\s\S]*?\n---\n?/.exec(content);
	const codeRanges: { start: number; end: number }[] = [];
	for (const match of content.matchAll(/^```[^\n]*\n[\s\S]*?^```$/gm)) {
		codeRanges.push({ start: match.index, end: match.index + match[0].length });
	}
	const embeds: EmbedRef[] = [];
	for (const match of content.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
		embeds.push({ link: match[1] ?? '', original: match[0], start: match.index, end: match.index + match[0].length });
	}
	return {
		path,
		content,
		contentStart: frontmatter === null ? 0 : frontmatter[0].length,
		embeds: options.indexed === false ? null : (options.embeds ?? embeds),
		codeRanges,
		resolveSubpath: (subpath) => resolveSection(content, subpath),
	};
}

/** List items as Obsidian's `cache.listItems` gives them (parent = parent line, or minus the first line of the list). */
function listItems(content: string): ListItemRef[] {
	const items: ListItemRef[] = [];
	const stack: ListItemRef[] = [];
	let listStart: number | null = null;
	let offset = 0;
	content.split('\n').forEach((text, line) => {
		const marker = /^(\s*)(?:[-*+]|\d+[.)]) /.exec(text);
		if (marker === null) {
			listStart = null;
			stack.length = 0;
		} else {
			const col = marker[1]?.length ?? 0;
			listStart ??= line;
			while (stack.length > 0 && (stack[stack.length - 1]?.col ?? 0) >= col) {
				stack.pop();
			}
			const parentItem = stack[stack.length - 1];
			const item = { line, col, parent: parentItem === undefined ? -listStart : parentItem.line, end: offset + text.length };
			items.push(item);
			stack.push(item);
		}
		offset += text.length + 1;
	});
	return items;
}

/** `#Heading`: from the heading line to the next heading of the same or a higher level; `#^id`: the block holding ^id. */
function resolveSection(content: string, subpath: string): { start: number; end: number | null } | null {
	if (subpath.startsWith('#^')) {
		const id = subpath.slice(2);
		const match = new RegExp(`^.*\\^${id}$`, 'm').exec(content);
		if (match === null) {
			return null;
		}
		const line = content.slice(0, match.index).split('\n').length - 1;
		const items = listItems(content);
		const item = items.find((candidate) => candidate.line === line);
		if (item === undefined) {
			return { start: match.index, end: match.index + match[0].length };
		}
		// Like the plugin's Obsidian adapter: the item's own range, extended to its sub-items.
		return { start: match.index + item.col, end: extendListBlock(items, line, item.end) };
	}
	const name = subpath.slice(1);
	const headings = [...content.matchAll(/^(#{1,6}) (.*)$/gm)];
	const index = headings.findIndex((heading) => heading[2] === name);
	const heading = headings[index];
	if (heading === undefined) {
		return null;
	}
	const level = heading[1]?.length ?? 0;
	const next = headings.slice(index + 1).find((other) => (other[1]?.length ?? 0) <= level);
	return { start: heading.index, end: next === undefined ? null : next.index };
}

function vault(...notes: NoteSource[]): EmbedResolver & { files: Record<string, string> } {
	const byPath = new Map(notes.map((n) => [n.path, n]));
	const files: Record<string, string> = { 'image.png': 'png', 'board.canvas': 'canvas' };
	return {
		files,
		resolve(linkpath) {
			const path = linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`;
			if (byPath.has(path)) {
				return { path, extension: 'md' };
			}
			const extension = files[linkpath];
			return extension === undefined ? null : { path: linkpath, extension };
		},
		load(path) {
			return Promise.resolve(byPath.get(path) ?? null);
		},
	};
}

const OPTIONS: ExpansionOptions = { maxDepth: 3, maxChars: 100_000 };

describe('expandNote', () => {
	it('removes the frontmatter of the note and of embedded notes, keeps plain links', async () => {
		const root = note('Main.md', '---\ntags: [spec]\n---\n# Spec\n\nSee [[Other]].\n\n![[Part]]\n');
		const part = note('Part.md', '---\nstatus: draft\n---\nPart body.\n');
		const result = await expandNote(root, vault(root, part), OPTIONS);
		expect(result.text).toBe('# Spec\n\nSee [[Other]].\n\nPart body.\n');
		expect(result.warnings).toEqual([]);
		expect(result.addedChars).toBe('Part body.'.length);
	});

	it('expands nested embeds', async () => {
		const root = note('Main.md', 'A ![[B]] A');
		const b = note('B.md', 'B ![[C]] B');
		const c = note('C.md', 'C');
		await expect(expandNote(root, vault(root, b, c), OPTIONS)).resolves.toMatchObject({ text: 'A B C B A', warnings: [] });
	});

	it('expands a heading section up to the next heading of the same or a higher level', async () => {
		const root = note('Main.md', '![[Spec#Scope]]');
		const spec = note('Spec.md', '# Spec\n## Scope\nIn scope.\n### Detail\nDetail.\n## Out\nNot this.\n');
		const result = await expandNote(root, vault(root, spec), OPTIONS);
		expect(result.text).toBe('## Scope\nIn scope.\n### Detail\nDetail.');
	});

	it('expands a heading of the same note (![[#Heading]])', async () => {
		const root = note('Main.md', '# Glossary\nTerm.\n# Use\n![[#Glossary]]\n');
		const result = await expandNote(root, vault(root), OPTIONS);
		expect(result.text).toBe('# Glossary\nTerm.\n# Use\n# Glossary\nTerm.\n');
		expect(result.warnings).toEqual([]);
	});

	it('expands a block and a list item block', async () => {
		const root = note('Main.md', '![[Rules#^r1]]\n![[Rules#^item]]');
		const rules = note('Rules.md', 'Intro.\n\nAll prices include VAT. ^r1\n\n- first\n- second item ^item\n');
		const result = await expandNote(root, vault(root, rules), OPTIONS);
		expect(result.text).toBe('All prices include VAT. ^r1\n- second item ^item');
	});

	describe('list item blocks include all their sub-items, not the following siblings', () => {
		const embedOf = async (content: string, id: string, ...others: NoteSource[]) => {
			const root = note('Main.md', `![[List#^${id}]]`);
			const list = note('List.md', content);
			return expandNote(root, vault(root, list, ...others), OPTIONS);
		};

		it('an item with children nested on two levels', async () => {
			const result = await embedOf('- a\n- b ^t\n  - b1\n    - b1x\n  - b2\n- c\n', 't');
			expect(result.text).toBe('- b ^t\n  - b1\n    - b1x\n  - b2');
		});

		it('an item without children', async () => {
			const result = await embedOf('- a ^t\n- b\n  - b1\n', 't');
			expect(result.text).toBe('- a ^t');
		});

		it('the last item of the list, with a paragraph after the list', async () => {
			const result = await embedOf('- a\n- z ^t\n  - z1\n\nAfter the list.\n', 't');
			expect(result.text).toBe('- z ^t\n  - z1');
		});

		it('an item followed by a sibling: the sibling is not included', async () => {
			const result = await embedOf('- a ^t\n  - a1\n- b\n  - b1\n', 't');
			expect(result.text).toBe('- a ^t\n  - a1');
		});

		it('a sub-item holding an embed: expanded like any embed', async () => {
			const part = note('Part.md', 'Part body.');
			const result = await embedOf('- a ^t\n  - see ![[Part]]\n- b\n', 't', part);
			expect(result.text).toBe('- a ^t\n  - see Part body.');
			expect(result.warnings).toEqual([]);
		});

		it('a numbered list', async () => {
			const result = await embedOf('1. one\n2. two ^t\n   1. two.one\n3. three\n', 't');
			expect(result.text).toBe('2. two ^t\n   1. two.one');
		});

		it('a task list', async () => {
			const result = await embedOf('- [ ] first\n- [x] second ^t\n  - [ ] sub task\n- [ ] third\n', 't');
			expect(result.text).toBe('- [x] second ^t\n  - [ ] sub task');
		});

		it('a nested item as target: its own children only', async () => {
			const result = await embedOf('- a\n  - a1 ^t\n    - a1x\n  - a2\n', 't');
			expect(result.text).toBe('- a1 ^t\n    - a1x');
		});

		it('a block on a paragraph is unchanged', async () => {
			const result = await embedOf('Intro.\n\nRule. ^t\n\n- a\n', 't');
			expect(result.text).toBe('Rule. ^t');
		});
	});

	it('a list item whose sub-items could not be added: the item alone, with a warning, the rest goes on', async () => {
		const list = note('List.md', '- a ^t\n  - a1\n');
		list.resolveSubpath = () => ({ start: 0, end: 6, listIncomplete: true });
		const root = note('Main.md', '![[List#^t]] and ![[Part]]');
		const part = note('Part.md', 'Part.');
		const result = await expandNote(root, vault(root, list, part), OPTIONS);
		expect(result.text).toBe('- a ^t and Part.');
		expect(result.warnings).toEqual([{ kind: 'list-incomplete', embed: '![[List#^t]]', note: 'Main.md' }]);
		expect(describeWarning(result.warnings[0] ?? { kind: 'missing', embed: '', note: '' })).toBe(
			'![[List#^t]] in Main.md: the sub-items of this list item could not be included, only the item itself was sent.',
		);
	});

	it('keeps an embed whose target is missing, with a warning', async () => {
		const root = note('Main.md', 'x ![[Ghost]] y');
		const result = await expandNote(root, vault(root), OPTIONS);
		expect(result.text).toBe('x ![[Ghost]] y');
		expect(result.warnings).toEqual([{ kind: 'missing', embed: '![[Ghost]]', note: 'Main.md' }]);
	});

	it('keeps an embed whose heading or block is missing, with a warning', async () => {
		const root = note('Main.md', '![[Spec#Nope]] ![[Spec#^nope]]');
		const spec = note('Spec.md', '# Spec\n');
		const result = await expandNote(root, vault(root, spec), OPTIONS);
		expect(result.text).toBe('![[Spec#Nope]] ![[Spec#^nope]]');
		expect(result.warnings.map((w) => w.kind)).toEqual(['section-missing', 'section-missing']);
	});

	it('keeps non-Markdown embeds (image, canvas) with a warning', async () => {
		const root = note('Main.md', '![[image.png]] ![[board.canvas]]');
		const result = await expandNote(root, vault(root), OPTIONS);
		expect(result.text).toBe('![[image.png]] ![[board.canvas]]');
		expect(result.warnings.map((w) => w.kind)).toEqual(['not-markdown', 'not-markdown']);
	});

	it('keeps external embeds silently', async () => {
		const external: EmbedRef = { link: 'https://example.org/a.png', original: '![](https://example.org/a.png)', start: 0, end: 30 };
		const root = note('Main.md', '![](https://example.org/a.png)', { embeds: [external] });
		await expect(expandNote(root, vault(root), OPTIONS)).resolves.toMatchObject({ text: '![](https://example.org/a.png)', warnings: [] });
	});

	it('ignores embeds inside code blocks', async () => {
		const root = note('Main.md', '```md\n![[Part]]\n```\n![[Part]]');
		const part = note('Part.md', 'Part.');
		const result = await expandNote(root, vault(root, part), OPTIONS);
		expect(result.text).toBe('```md\n![[Part]]\n```\nPart.');
	});

	it('detects a direct loop (a note embedding itself)', async () => {
		const root = note('Main.md', 'Me: ![[Main]]');
		const result = await expandNote(root, vault(root), OPTIONS);
		expect(result.text).toBe('Me: ![[Main]]');
		expect(result.warnings).toEqual([{ kind: 'loop', embed: '![[Main]]', note: 'Main.md' }]);
	});

	it('detects an indirect loop (A → B → A)', async () => {
		const a = note('A.md', 'A ![[B]]');
		const b = note('B.md', 'B ![[A]]');
		const result = await expandNote(a, vault(a, b), OPTIONS);
		expect(result.text).toBe('A B ![[A]]');
		expect(result.warnings).toEqual([{ kind: 'loop', embed: '![[A]]', note: 'B.md' }]);
	});

	it('detects a section embedding itself', async () => {
		const root = note('Main.md', '# Part\nText ![[#Part]]\n');
		const result = await expandNote(root, vault(root), OPTIONS);
		expect(result.warnings).toEqual([{ kind: 'loop', embed: '![[#Part]]', note: 'Main.md' }]);
	});

	it('stops at the maximum depth with a warning', async () => {
		const a = note('A.md', 'A ![[B]]');
		const b = note('B.md', 'B ![[C]]');
		const c = note('C.md', 'C');
		const result = await expandNote(a, vault(a, b, c), { maxDepth: 1, maxChars: 1000 });
		expect(result.text).toBe('A B ![[C]]');
		expect(result.warnings).toEqual([{ kind: 'depth', embed: '![[C]]', note: 'B.md' }]);
	});

	it('depth 0 sends every embed as written, without warning', async () => {
		const root = note('Main.md', '![[Part]]');
		const part = note('Part.md', 'Part.');
		await expect(expandNote(root, vault(root, part), { maxDepth: 0, maxChars: 1000 })).resolves.toMatchObject({
			text: '![[Part]]',
			warnings: [],
			addedChars: 0,
		});
	});

	it('leaves out an embed that would exceed the size limit, with the characters left out', async () => {
		const root = note('Main.md', '![[Small]] ![[Big]] ![[Small2]]');
		const small = note('Small.md', '12345');
		const big = note('Big.md', 'x'.repeat(20));
		const small2 = note('Small2.md', 'abc');
		const result = await expandNote(root, vault(root, small, big, small2), { maxDepth: 3, maxChars: 10 });
		expect(result.text).toBe('12345 ![[Big]] abc');
		expect(result.addedChars).toBe(8);
		expect(result.warnings).toEqual([{ kind: 'size', embed: '![[Big]]', note: 'Main.md', droppedChars: 20 }]);
	});

	it('counts nested embeds once in the size limit', async () => {
		const root = note('Main.md', '![[B]]');
		const b = note('B.md', 'B ![[C]]');
		const c = note('C.md', 'CCCC');
		const result = await expandNote(root, vault(root, b, c), { maxDepth: 3, maxChars: 6 });
		expect(result.text).toBe('B CCCC');
		expect(result.addedChars).toBe(6);
	});

	it('a note not indexed yet is sent without expansion, with a warning', async () => {
		const root = note('Main.md', '![[Part]]', { indexed: false });
		const result = await expandNote(root, vault(root), OPTIONS);
		expect(result.text).toBe('![[Part]]');
		expect(result.warnings).toEqual([{ kind: 'not-indexed', embed: '', note: 'Main.md' }]);
	});

	it('an embedded note not indexed yet is included without its own embeds, with a warning', async () => {
		const root = note('Main.md', '![[Part]]');
		const part = note('Part.md', 'Part ![[Deep]]', { indexed: false });
		const result = await expandNote(root, vault(root, part), OPTIONS);
		expect(result.text).toBe('Part ![[Deep]]');
		expect(result.warnings).toEqual([{ kind: 'not-indexed', embed: '![[Part]]', note: 'Part.md' }]);
	});

	it('a stale cache (offsets no longer matching the text) disables the expansion of that note', async () => {
		const stale: EmbedRef = { link: 'Part', original: '![[Part]]', start: 2, end: 11 };
		const root = note('Main.md', 'edited ![[Part]]', { embeds: [stale] });
		const part = note('Part.md', 'Part.');
		const result = await expandNote(root, vault(root, part), OPTIONS);
		expect(result.text).toBe('edited ![[Part]]');
		expect(result.warnings).toEqual([{ kind: 'stale-cache', embed: '', note: 'Main.md' }]);
	});
});

describe('extendListBlock', () => {
	// A list starting at line 0: root items have parent -0 = 0, the same value as "child of line 0".
	const items: ListItemRef[] = [
		{ line: 0, col: 0, parent: 0, end: 5 },
		{ line: 1, col: 2, parent: 0, end: 12 },
		{ line: 2, col: 0, parent: 0, end: 17 },
	];

	it('a root item at line 0 keeps its child and not its sibling', () => {
		expect(extendListBlock(items, 0, 5)).toBe(12);
	});

	it('an unknown target line leaves the range unchanged', () => {
		expect(extendListBlock(items, 9, 40)).toBe(40);
	});
});

describe('splitLink', () => {
	it.each([
		['Note', { path: 'Note', subpath: '' }],
		['Note#Heading', { path: 'Note', subpath: '#Heading' }],
		['Note#^block', { path: 'Note', subpath: '#^block' }],
		['#Heading', { path: '', subpath: '#Heading' }],
		['folder/Note#A#B', { path: 'folder/Note', subpath: '#A#B' }],
	])('%s', (link, expected) => {
		expect(splitLink(link)).toEqual(expected);
	});
});

describe('describeWarning', () => {
	it('gives the characters left out for a size warning', () => {
		expect(describeWarning({ kind: 'size', embed: '![[Big]]', note: 'Main.md', droppedChars: 12345 })).toBe(
			'![[Big]] in Main.md: left out (12,345 characters), maximum embedded characters reached.',
		);
	});

	it('explains a stale cache', () => {
		expect(describeWarning({ kind: 'stale-cache', embed: '', note: 'Main.md' })).toBe(
			'Main.md: changed since Obsidian last indexed it, embeds sent as written. Try again in a moment.',
		);
	});
});
