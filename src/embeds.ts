// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT

/**
 * Expansion of `![[embeds]]` before a note is sent to Refinr. Pure: the vault is reached only through
 * {@link NoteSource} and {@link EmbedResolver} (Obsidian adapter in `obsidian/vault-notes.ts`), so that every rule is
 * tested without Obsidian. Plain `[[links]]` are not embeds: they stay as written.
 */

/** An embed found by Obsidian's metadata cache: link target and offsets of its text in the note. */
export interface EmbedRef {
	/** Link target without display text, e.g. `note`, `note#Heading`, `note#^block`, `#Heading`. */
	link: string;
	/** Text as written in the note, e.g. `![[note#Heading|alias]]`. */
	original: string;
	start: number;
	end: number;
}

export interface TextRange {
	start: number;
	/** Exclusive; null = end of the note. */
	end: number | null;
}

/** A note as read from the vault, with what the metadata cache knows about it. */
export interface NoteSource {
	path: string;
	content: string;
	/** Offset where the body starts (after the frontmatter block; 0 without frontmatter). */
	contentStart: number;
	/** Embeds of the note, or null when the note is not indexed yet. */
	embeds: EmbedRef[] | null;
	/** Code blocks: embeds inside them are code, not embeds. */
	codeRanges: { start: number; end: number }[];
	/**
	 * Offsets of `#Heading` / `#^block` in this note, or null when not found. `listIncomplete`: a block on a list item
	 * whose sub-items could not be added (only the item itself is in the range).
	 */
	resolveSubpath(subpath: string): (TextRange & { listIncomplete?: true }) | null;
}

export interface EmbedResolver {
	/** Target of a link written in `sourcePath`, as Obsidian resolves it; null when no file matches. */
	resolve(linkpath: string, sourcePath: string): { path: string; extension: string } | null;
	/** Reads a Markdown note; null when it cannot be read. */
	load(path: string): Promise<NoteSource | null>;
}

export interface ExpansionOptions {
	/** Embed levels expanded (0 = none). */
	maxDepth: number;
	/** Characters added by expanded embeds, all levels together. */
	maxChars: number;
}

export type EmbedWarningKind =
	| 'missing'
	| 'section-missing'
	| 'not-markdown'
	| 'depth'
	| 'size'
	| 'loop'
	| 'not-indexed'
	| 'stale-cache'
	| 'list-incomplete';

export interface EmbedWarning {
	kind: EmbedWarningKind;
	/** The embed as written (empty for a note-level warning). */
	embed: string;
	/** Note where the embed (or the problem) is. */
	note: string;
	/** Characters left out of the text sent, when known (`size`). */
	droppedChars?: number;
}

export interface Expansion {
	text: string;
	warnings: EmbedWarning[];
	/** Characters added by the expanded embeds. */
	addedChars: number;
}

interface State {
	warnings: EmbedWarning[];
	added: number;
}

const EXTERNAL_LINK = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `note#Heading` → `{path: 'note', subpath: '#Heading'}`; `#Heading` → same note. */
export function splitLink(link: string): { path: string; subpath: string } {
	const hash = link.indexOf('#');
	return hash < 0 ? { path: link, subpath: '' } : { path: link.slice(0, hash), subpath: link.slice(hash) };
}

/** Body of `root` (frontmatter removed) with its embeds expanded within the limits. */
export async function expandNote(root: NoteSource, resolver: EmbedResolver, options: ExpansionOptions): Promise<Expansion> {
	const state: State = { warnings: [], added: 0 };
	if (root.embeds === null) {
		state.warnings.push({ kind: 'not-indexed', embed: '', note: root.path });
	}
	const text = await render(root, { start: root.contentStart, end: null }, 0, [root.path], state, resolver, options);
	return { text, warnings: state.warnings, addedChars: state.added };
}

async function render(
	note: NoteSource,
	range: TextRange,
	depth: number,
	stack: string[],
	state: State,
	resolver: EmbedResolver,
	options: ExpansionOptions,
): Promise<string> {
	const { content } = note;
	const end = range.end ?? content.length;
	if (note.embeds === null) {
		return content.slice(range.start, end);
	}
	const embeds = note.embeds
		.filter((embed) => embed.start >= range.start && embed.end <= end)
		.sort((a, b) => a.start - b.start);
	// Offsets from an outdated cache would cut the text at the wrong places: send it unexpanded instead.
	if (embeds.some((embed) => content.slice(embed.start, embed.end) !== embed.original)) {
		state.warnings.push({ kind: 'stale-cache', embed: '', note: note.path });
		return content.slice(range.start, end);
	}
	let out = '';
	let cursor = range.start;
	for (const embed of embeds) {
		if (embed.start < cursor) {
			continue;
		}
		out += content.slice(cursor, embed.start);
		out += await expandEmbed(note, embed, depth, stack, state, resolver, options);
		cursor = embed.end;
	}
	return out + content.slice(cursor, end);
}

async function expandEmbed(
	note: NoteSource,
	embed: EmbedRef,
	depth: number,
	stack: string[],
	state: State,
	resolver: EmbedResolver,
	options: ExpansionOptions,
): Promise<string> {
	const keep = embed.original;
	const warn = (kind: EmbedWarningKind, droppedChars?: number) => {
		state.warnings.push({ kind, embed: keep, note: note.path, ...(droppedChars === undefined ? {} : { droppedChars }) });
		return keep;
	};
	if (note.codeRanges.some((code) => embed.start >= code.start && embed.end <= code.end) || EXTERNAL_LINK.test(embed.link)) {
		return keep;
	}
	const { path, subpath } = splitLink(embed.link);
	let targetPath = note.path;
	if (path !== '') {
		const resolved = resolver.resolve(path, note.path);
		if (resolved === null) {
			return warn('missing');
		}
		if (resolved.extension.toLowerCase() !== 'md') {
			return warn('not-markdown');
		}
		targetPath = resolved.path;
	}
	const key = targetPath + subpath;
	// Loop: this exact part is being expanded, or the whole note while one of its parts is.
	if (stack.includes(key) || (subpath === '' && stack.some((entry) => splitLink(entry).path === targetPath))) {
		return warn('loop');
	}
	if (depth >= options.maxDepth) {
		return options.maxDepth === 0 ? keep : warn('depth');
	}
	const target = targetPath === note.path ? note : await resolver.load(targetPath);
	if (target === null) {
		return warn('missing');
	}
	let range: TextRange = { start: target.contentStart, end: null };
	if (subpath !== '') {
		const section = target.resolveSubpath(subpath);
		if (section === null) {
			return warn('section-missing');
		}
		range = { start: section.start, end: section.end };
		if (section.listIncomplete === true) {
			state.warnings.push({ kind: 'list-incomplete', embed: keep, note: note.path });
		}
	}
	if (target !== note && target.embeds === null) {
		state.warnings.push({ kind: 'not-indexed', embed: keep, note: target.path });
	}

	const addedBefore = state.added;
	const warningsBefore = state.warnings.length;
	const body = (await render(target, range, depth + 1, [...stack, key], state, resolver, options)).trim();
	// Nested embeds are already counted in state.added; the whole body replaces them in the total.
	if (addedBefore + body.length > options.maxChars) {
		state.added = addedBefore;
		state.warnings.length = warningsBefore;
		return warn('size', body.length);
	}
	state.added = addedBefore + body.length;
	return body;
}

/** A list item of Obsidian's metadata cache (`cache.listItems`). */
export interface ListItemRef {
	/** `position.start.line`. */
	line: number;
	/** `position.start.col`: indentation of the item marker. */
	col: number;
	/** Line of the parent item; for a root item, minus the first line of the list (so 0 for a list at line 0). */
	parent: number;
	/** `position.end.offset`: end of the item's own text, without its sub-items. */
	end: number;
}

/**
 * End offset of a list item block (`![[note#^id]]` on a list item) including all its descendants, at every level, as
 * Obsidian renders it: an item is a descendant when its parent chain reaches the target line. Following siblings and
 * the rest of the list are not included. The indentation check stops at the first following item that is not
 * indented deeper than the target (a root `parent` of 0 would otherwise be read as "child of line 0").
 */
export function extendListBlock(items: ListItemRef[], targetLine: number, end: number): number {
	const target = items.find((item) => item.line === targetLine);
	if (target === undefined) {
		return end;
	}
	const subtree = new Set([targetLine]);
	let last = end;
	for (const item of [...items].sort((a, b) => a.line - b.line)) {
		if (item.line <= targetLine) {
			continue;
		}
		if (item.col <= target.col) {
			break;
		}
		if (subtree.has(item.parent)) {
			subtree.add(item.line);
			last = Math.max(last, item.end);
		}
	}
	return last;
}

/** One-line, user-facing description of a warning. */
export function describeWarning(warning: EmbedWarning): string {
	const embed = warning.embed;
	switch (warning.kind) {
		case 'missing':
			return `${embed} in ${warning.note}: target not found, sent as written.`;
		case 'section-missing':
			return `${embed} in ${warning.note}: heading or block not found, sent as written.`;
		case 'not-markdown':
			return `${embed} in ${warning.note}: not a note (image, PDF, canvas…), sent as written.`;
		case 'depth':
			return `${embed} in ${warning.note}: not expanded, maximum embed depth reached.`;
		case 'size':
			return `${embed} in ${warning.note}: left out (${(warning.droppedChars ?? 0).toLocaleString('en-US')} characters), maximum embedded characters reached.`;
		case 'loop':
			return `${embed} in ${warning.note}: embeds itself (loop), sent as written.`;
		case 'not-indexed':
			return embed === ''
				? `${warning.note}: not indexed by Obsidian yet, embeds sent as written. Try again in a moment.`
				: `${embed}: ${warning.note} is not indexed by Obsidian yet, its embeds are sent as written.`;
		case 'stale-cache':
			return `${warning.note}: changed since Obsidian last indexed it, embeds sent as written. Try again in a moment.`;
		case 'list-incomplete':
			return `${embed} in ${warning.note}: the sub-items of this list item could not be included, only the item itself was sent.`;
	}
}
