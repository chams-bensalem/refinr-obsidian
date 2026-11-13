// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { Notice, Plugin, type TFile } from 'obsidian';
import { obsidianTransport } from './api/obsidian-transport';
import { normalizeBaseUrl, RefinrClient } from './api/refinr-client';
import { buildConnectionReport, checkConnection, describeError, type SecretState } from './connection';
import { providedTextLength } from './document';
import { expandNote } from './embeds';
import { VaultNotes } from './obsidian/vault-notes';
import { PreviewModal } from './preview-modal';
import { normalizeSettings, type RefinrSettings } from './settings';
import { RefinrSettingTab } from './settings-tab';

export default class RefinrPlugin extends Plugin {
	settings: RefinrSettings = normalizeSettings(undefined);
	/** Notes being analyzed (one analysis at a time per note). */
	private readonly analyzing = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new RefinrSettingTab(this.app, this));
		this.addCommand({
			id: 'test-connection',
			name: 'Test connection',
			callback: () => {
				void this.testConnection();
			},
		});
		this.addCommand({
			id: 'analyze-note',
			name: 'Analyze note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (file === null || file.extension !== 'md') {
					return false;
				}
				if (!checking) {
					void this.analyzeNote(file);
				}
				return true;
			},
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** The API key is read from Obsidian's secret storage at each call and never kept by the plugin. */
	private secretState(): SecretState {
		const name = this.settings.apiKeySecret;
		if (name === '') {
			return { kind: 'none' };
		}
		return this.app.secretStorage.getSecret(name) === null ? { kind: 'missing', name } : { kind: 'found' };
	}

	private client(baseUrl: string): RefinrClient {
		return new RefinrClient({
			baseUrl,
			transport: obsidianTransport,
			apiKey: () => (this.settings.apiKeySecret === '' ? null : this.app.secretStorage.getSecret(this.settings.apiKeySecret)),
		});
	}

	/**
	 * Active note → text (frontmatter removed, embeds expanded) → size check against Refinr's limit →
	 * `analyze-preview` → preview window. Nothing is created in the tracker.
	 */
	private async analyzeNote(file: TFile): Promise<void> {
		if (this.analyzing.has(file.path)) {
			new Notice(`Refinr: ${file.basename} is already being analyzed.`);
			return;
		}
		const baseUrl = normalizeBaseUrl(this.settings.refinrUrl);
		if (baseUrl === null) {
			new Notice('Refinr: set an http:// or https:// URL in the plugin settings.');
			return;
		}
		this.analyzing.add(file.path);
		const modal = new PreviewModal(this.app, file.basename);
		modal.open();
		try {
			const notes = new VaultNotes(this.app);
			const expansion = await expandNote(await notes.readActive(file), notes, {
				maxDepth: this.settings.embedMaxDepth,
				maxChars: this.settings.embedMaxChars,
			});
			const warnings = expansion.warnings;
			const client = this.client(baseUrl);
			const source = await client.source();
			if (!source.ok) {
				modal.setState({ kind: 'error', message: describeError(source.error, baseUrl, 'check', this.secretState()), warnings });
				return;
			}
			const limit = source.value.maxContentChars;
			const chars = providedTextLength(file.basename, expansion.text);
			if (chars > limit) {
				modal.setState({
					kind: 'error',
					message:
						`The note is too long for Refinr: ${chars.toLocaleString('en-US')} characters (title and embeds included), ` +
						`limit ${limit.toLocaleString('en-US')}. Nothing was sent. Shorten the note or lower the embed limits in the plugin settings.`,
					warnings,
				});
				return;
			}
			modal.setState({ kind: 'analyzing', chars, limit, warnings });
			const result = await client.analyzePreview(
				{ content: expansion.text, title: file.basename },
				this.settings.analysisTimeoutSeconds * 1000,
			);
			modal.setState(
				result.ok
					? { kind: 'done', preview: result.value, chars, warnings }
					: { kind: 'error', message: describeError(result.error, baseUrl, 'analysis', this.secretState()), warnings },
			);
			if (!modal.isShown) {
				this.notifyReady(file.basename, modal, result.ok);
			}
		} catch (e) {
			modal.setState({
				kind: 'error',
				message: `Could not read the note: ${e instanceof Error ? e.message : String(e)}`,
				warnings: [],
			});
		} finally {
			this.analyzing.delete(file.path);
		}
	}

	/** The window was closed during the analysis: offer to reopen it (the result is kept in memory only). */
	private notifyReady(noteName: string, modal: PreviewModal, ok: boolean): void {
		const notice = new Notice(
			createFragment((fragment) => {
				fragment.createDiv({ text: ok ? `Refinr: the preview of ${noteName} is ready.` : `Refinr: the analysis of ${noteName} failed.` });
				const button = fragment.createEl('button', { text: ok ? 'Open preview' : 'Show error' });
				button.addEventListener('click', () => {
					notice.hide();
					modal.open();
				});
			}),
			0,
		);
	}

	private async testConnection(): Promise<void> {
		const baseUrl = normalizeBaseUrl(this.settings.refinrUrl);
		if (baseUrl === null) {
			new Notice('Refinr: set an http:// or https:// URL in the plugin settings.');
			return;
		}
		const progress = new Notice('Refinr: testing the connection…', 0);
		try {
			const report = buildConnectionReport(await checkConnection(this.client(baseUrl), this.secretState()));
			const message = createFragment((fragment) => {
				fragment.createDiv({ text: report.ok ? 'Refinr: connection OK' : 'Refinr: connection problem' });
				for (const line of report.lines) {
					fragment.createDiv({ text: line });
				}
			});
			// Problems stay until dismissed, so that the advice can be read.
			new Notice(message, report.ok ? 10_000 : 0);
		} finally {
			progress.hide();
		}
	}
}
