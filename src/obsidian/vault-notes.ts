// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { type App, getFrontMatterInfo, resolveSubpath, type TFile } from 'obsidian';
import type { EmbedResolver, NoteSource } from '../embeds';
import { subpathRange } from './subpath';

/** The only module reading the vault: turns notes and Obsidian's metadata cache into {@link NoteSource}s. */
export class VaultNotes implements EmbedResolver {
	constructor(private readonly app: App) {}

	/** The note being analyzed: read from disk (not the cache) so that the latest saved edits are sent. */
	async readActive(file: TFile): Promise<NoteSource> {
		return this.toSource(file, await this.app.vault.read(file));
	}

	resolve(linkpath: string, sourcePath: string): { path: string; extension: string } | null {
		const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		return file === null ? null : { path: file.path, extension: file.extension };
	}

	async load(path: string): Promise<NoteSource | null> {
		const file = this.app.vault.getFileByPath(path);
		return file === null ? null : this.toSource(file, await this.app.vault.cachedRead(file));
	}

	private toSource(file: TFile, content: string): NoteSource {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = getFrontMatterInfo(content);
		return {
			path: file.path,
			content,
			contentStart: frontmatter.exists ? frontmatter.contentStart : 0,
			embeds:
				cache === null
					? null
					: (cache.embeds ?? []).map((embed) => ({
							link: embed.link,
							original: embed.original,
							start: embed.position.start.offset,
							end: embed.position.end.offset,
						})),
			codeRanges: (cache?.sections ?? [])
				.filter((section) => section.type === 'code')
				.map((section) => ({ start: section.position.start.offset, end: section.position.end.offset })),
			resolveSubpath: (subpath) => {
				const result = cache === null ? null : resolveSubpath(cache, subpath);
				return result === null ? null : subpathRange(result, cache?.listItems);
			},
		};
	}
}
