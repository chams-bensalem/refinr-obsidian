// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { moment, Notice, Plugin, stringifyYaml, type TFile } from 'obsidian';
import { alreadyAnalyzingMessage, analyzeTarget, isMarkdownNote } from './analyze-target';
import { obsidianTransport } from './api/obsidian-transport';
import { normalizeBaseUrl, RefinrClient } from './api/refinr-client';
import {
	applyReassessment,
	applyRecord,
	applyValidation,
	pendingStories,
	type RecordMeta,
	recordFromCreation,
	recordSummary,
	recordTracker,
	type RefinrRecord,
	unknownRecord,
} from './backlog-record';
import {
	buildConnectionReport,
	checkConnection,
	describeError,
	reassessmentError,
	type SecretState,
	unknownCreationMessage,
	validationError,
} from './connection';
import { nothingCreated } from './creation';
import { providedTextLength } from './document';
import { expandNote } from './embeds';
import { outputLanguage } from './language';
import { VaultNotes } from './obsidian/vault-notes';
import { type DoneState, type FrontmatterOutcome, PreviewModal } from './preview-modal';
import { type PendingStory, ReassessModal, StoryPicker, ValidateModal } from './reassess-modal';
import { normalizeSettings, type RefinrSettings } from './settings';
import { RefinrSettingTab } from './settings-tab';

/** What is writing a note's `refinr` property: creation, reassessment and validation are exclusive on a note. */
type NoteTask = 'create' | 'reassess' | 'validate';

/** A validation makes no model call: Refinr only writes the tracker (OpenProject: comment, read, update). */
const VALIDATION_TIMEOUT_MS = 120_000;

const TASK_NAMES: Record<NoteTask, string> = { create: 'creation', reassess: 'reassessment', validate: 'validation' };

export default class RefinrPlugin extends Plugin {
	settings: RefinrSettings = normalizeSettings(undefined);
	/** Notes being analyzed (one analysis at a time per note). */
	private readonly analyzing = new Set<string>();
	/** Notes whose `refinr` property is being written: never two `processFrontMatter` on the same block. */
	private readonly busy = new Map<string, NoteTask>();

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
				if (!isMarkdownNote(this.app.workspace.getActiveFile())) {
					return false;
				}
				if (!checking) {
					this.analyzeActiveNote();
				}
				return true;
			},
		});
		// Same action as the "Analyze note" command; Obsidian removes the icon when the plugin is unloaded
		this.addRibbonIcon('wand-sparkles', 'Refinr: Analyze note', () => {
			this.analyzeActiveNote();
		});
		this.addCommand({
			id: 'reassess-story',
			name: 'Reassess a story',
			checkCallback: (checking) => this.storyCommand(checking, (file, story) => this.openReassessment(file, story)),
		});
		this.addCommand({
			id: 'validate-story',
			name: 'Validate a story',
			checkCallback: (checking) => this.storyCommand(checking, (file, story) => this.openValidation(file, story)),
		});
	}

	/** Command of a story picker on the active note's stories awaiting validation (hidden when there is none). */
	private storyCommand(checking: boolean, open: (file: TFile, story: PendingStory) => void): boolean {
		const file = this.app.workspace.getActiveFile();
		if (file === null || file.extension !== 'md' || this.busy.has(file.path)) {
			return false;
		}
		const stories = pendingStories(this.frontmatter(file));
		if (stories.length === 0) {
			return false;
		}
		if (!checking) {
			new StoryPicker(this.app, stories, (story) => open(file, story)).open();
		}
		return true;
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

	private frontmatter(file: TFile): Record<string, unknown> | null {
		return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
	}

	private get timeoutMs(): number {
		return this.settings.analysisTimeoutSeconds * 1000;
	}

	/** "Analyze note" command and ribbon button: the active Markdown note, or a notice saying why not. */
	private analyzeActiveNote(): void {
		const target = analyzeTarget(this.app.workspace.getActiveFile(), this.analyzing);
		if (target.kind === 'ready') {
			void this.analyzeNote(target.file);
		} else {
			new Notice(target.message);
		}
	}

	/**
	 * Active note → text (frontmatter removed, embeds expanded) → size check against Refinr's limit →
	 * `analyze-preview` → preview window, from which the issues can be created.
	 */
	private async analyzeNote(file: TFile): Promise<void> {
		if (this.analyzing.has(file.path)) {
			new Notice(alreadyAnalyzingMessage(file.basename));
			return;
		}
		const baseUrl = normalizeBaseUrl(this.settings.refinrUrl);
		if (baseUrl === null) {
			new Notice('Refinr: set an http:// or https:// URL in the plugin settings.');
			return;
		}
		this.analyzing.add(file.path);
		// Read once: the preview and the creation from it use the same language
		const language = outputLanguage(this.frontmatter(file), this.settings.defaultLanguage);
		const modal: PreviewModal = new PreviewModal(this.app, file.basename, {
			existingRecord: () => recordSummary(this.frontmatter(file)),
			create: (base, projectKey) => {
				void this.createIssues(file, modal, base, projectKey, language);
			},
			copy: (text) => {
				void (async () => {
					await navigator.clipboard.writeText(text);
					new Notice('Refinr: YAML copied.');
				})();
			},
		});
		modal.open();
		try {
			const notes = new VaultNotes(this.app);
			const expansion = await expandNote(await notes.readActive(file), notes, {
				maxDepth: this.settings.embedMaxDepth,
				maxChars: this.settings.embedMaxChars,
			});
			const warnings = expansion.warnings;
			const client = this.client(baseUrl);
			const [source, tracker] = await Promise.all([client.source(), client.tracker()]);
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
			const result = await client.analyzePreview({ content: expansion.text, title: file.basename }, this.timeoutMs, language);
			modal.setState(
				result.ok
					? {
							kind: 'done',
							preview: result.value,
							chars,
							warnings,
							tracker: tracker.ok ? tracker.value.name : null,
							defaultProject: this.settings.defaultProjectKey,
						}
					: { kind: 'error', message: describeError(result.error, baseUrl, 'analysis', this.secretState()), warnings },
			);
			if (!modal.isShown) {
				this.notify(
					result.ok ? `Refinr: the preview of ${file.basename} is ready.` : `Refinr: the analysis of ${file.basename} failed.`,
					result.ok ? 'Open preview' : 'Show error',
					() => modal.open(),
				);
			}
		} catch (e) {
			modal.setState({ kind: 'error', message: `Could not read the note: ${errorText(e)}`, warnings: [] });
		} finally {
			this.analyzing.delete(file.path);
		}
	}

	/**
	 * `create-jira` with the preview, then the `refinr` property: written as soon as `created[]` is not empty (whatever
	 * the status code), as `unknown` when the outcome is unknown, never when nothing was created.
	 */
	private async createIssues(
		file: TFile,
		modal: PreviewModal,
		base: DoneState,
		projectKey: string,
		language: string | null,
	): Promise<void> {
		const tracker = base.tracker ?? '';
		const running = this.busy.get(file.path);
		const baseUrl = normalizeBaseUrl(this.settings.refinrUrl);
		if (running !== undefined || baseUrl === null) {
			modal.setState({
				kind: 'create-failed',
				base,
				message:
					baseUrl === null
						? 'Set an http:// or https:// URL in the plugin settings. Nothing was sent.'
						: `A ${TASK_NAMES[running ?? 'create']} is running on this note: try again when it ends. Nothing was sent.`,
				unknown: false,
				frontmatter: null,
			});
			return;
		}
		this.busy.set(file.path, 'create');
		try {
			const meta: RecordMeta = { date: moment().format(), tracker, project: projectKey === '' ? null : projectKey };
			const result = await this.client(baseUrl).createIssues(base.preview.raw, projectKey, this.timeoutMs, language);
			if (result.ok) {
				const record = recordFromCreation(result.value, meta);
				const frontmatter: FrontmatterOutcome =
					record === null
						? { ok: true, message: 'Nothing was created: the note was not changed.', yaml: null }
						: await this.writeRecord(file, record);
				modal.setState({ kind: 'created', base, result: result.value, frontmatter });
			} else if (nothingCreated(result.error)) {
				modal.setState({
					kind: 'create-failed',
					base,
					message: `${describeError(result.error, baseUrl, 'creation', this.secretState())} Nothing was created.`,
					unknown: false,
					frontmatter: null,
				});
			} else {
				// Unknown outcome: issues may exist. Recorded so that a new creation warns first.
				modal.setState({
					kind: 'create-failed',
					base,
					message: unknownCreationMessage(result.error, baseUrl),
					unknown: true,
					frontmatter: await this.writeRecord(file, unknownRecord(meta)),
				});
			}
			if (!modal.isShown) {
				this.notify(`Refinr: the creation from ${file.basename} has ended.`, 'Open result', () => modal.open());
			}
		} finally {
			this.busy.delete(file.path);
		}
	}

	/** Writes the record with `processFrontMatter`; when it cannot, the YAML is offered to copy. */
	private async writeRecord(file: TFile, record: RefinrRecord): Promise<FrontmatterOutcome> {
		const yaml = stringifyYaml({ refinr: record });
		// The TFile follows renames and moves; a deleted note is no longer in the vault.
		if (this.app.vault.getFileByPath(file.path) !== file) {
			return { ok: false, message: 'The note was deleted: the result was not written. Copy the YAML and paste it into the note.', yaml };
		}
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => applyRecord(frontmatter, record));
			return { ok: true, message: `Result written in the "refinr" property of ${file.path}.`, yaml: null };
		} catch (e) {
			return {
				ok: false,
				message: `Could not write the "refinr" property of ${file.path} (${errorText(e)}). Copy the YAML and paste it into the note.`,
				yaml,
			};
		}
	}

	private openReassessment(file: TFile, story: PendingStory): void {
		const tracker = recordTracker(this.frontmatter(file)) ?? 'the tracker';
		const modal: ReassessModal = new ReassessModal(this.app, story, tracker, (precision) => {
			void this.reassess(file, story, precision, modal);
		});
		modal.open();
	}

	/** `reassess-story`, then the story's `verdict` and `reassessed` in the note's `refinr` property. */
	private async reassess(file: TFile, story: PendingStory, precision: string, modal: ReassessModal): Promise<void> {
		const baseUrl = normalizeBaseUrl(this.settings.refinrUrl);
		const running = this.busy.get(file.path);
		if (baseUrl === null || running !== undefined) {
			modal.setState({
				kind: 'error',
				message:
					baseUrl === null
						? 'Set an http:// or https:// URL in the plugin settings.'
						: `A ${TASK_NAMES[running ?? 'reassess']} is running on this note: try again when it ends.`,
			});
			return;
		}
		this.busy.set(file.path, 'reassess');
		try {
			const client = this.client(baseUrl);
			const noteTracker = recordTracker(this.frontmatter(file));
			const current = await client.tracker();
			if (!current.ok) {
				modal.setState({ kind: 'error', message: describeError(current.error, baseUrl, 'check', this.secretState()) });
				return;
			}
			// Only the display name can be compared: Refinr does not expose the tracker's address (see DECISIONS.md).
			if (noteTracker !== null && noteTracker !== current.value.name) {
				modal.setState({
					kind: 'error',
					message: `The backlog of this note was created in ${noteTracker}, but Refinr now uses ${current.value.name}. Nothing was sent.`,
				});
				return;
			}
			const tracker = current.value.name;
			const language = outputLanguage(this.frontmatter(file), this.settings.defaultLanguage);
			const result = await client.reassessStory(story.key, precision, this.timeoutMs, language);
			if (result.ok) {
				const verdict = result.value.aiReady ? 'ai-ready' : 'validation-necessaire';
				let found = false;
				let frontmatter: string;
				let frontmatterOk = false;
				try {
					await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
						found = applyReassessment(fm, story.key, verdict, moment().format());
					});
					frontmatterOk = found;
					frontmatter = found
						? `Verdict of ${story.key} updated in the "refinr" property of ${file.path}.`
						: `${story.key} is no longer in the "refinr" property of ${file.path}: the note was not updated.`;
				} catch (e) {
					frontmatter = `Could not update the "refinr" property of ${file.path} (${errorText(e)}): set the verdict of ${story.key} to ${verdict} by hand.`;
				}
				modal.setState({ kind: 'done', verdict, reason: result.value.reason, frontmatter, frontmatterOk });
			} else {
				modal.setState({ kind: 'error', message: reassessmentError(result.error, story.key, tracker, baseUrl, this.secretState()) });
			}
			if (!modal.isShown) {
				this.notify(`Refinr: the reassessment of ${story.key} has ended.`, 'Show result', () => modal.open());
			}
		} finally {
			this.busy.delete(file.path);
		}
	}

	private openValidation(file: TFile, story: PendingStory): void {
		const tracker = recordTracker(this.frontmatter(file)) ?? 'the tracker';
		const modal: ValidateModal = new ValidateModal(this.app, story, tracker, () => {
			void this.validate(file, story, modal);
		});
		modal.open();
	}

	/** `validate-story` (Refinr 1.4.0), then the story's verdict in the note's `refinr` property (`verdictSource: human`). */
	private async validate(file: TFile, story: PendingStory, modal: ValidateModal): Promise<void> {
		const baseUrl = normalizeBaseUrl(this.settings.refinrUrl);
		const running = this.busy.get(file.path);
		if (baseUrl === null || running !== undefined) {
			modal.setState({
				kind: 'error',
				message:
					baseUrl === null
						? 'Set an http:// or https:// URL in the plugin settings.'
						: `A ${TASK_NAMES[running ?? 'validate']} is running on this note: try again when it ends.`,
			});
			return;
		}
		this.busy.set(file.path, 'validate');
		try {
			const client = this.client(baseUrl);
			const noteTracker = recordTracker(this.frontmatter(file));
			const current = await client.tracker();
			if (!current.ok) {
				modal.setState({ kind: 'error', message: describeError(current.error, baseUrl, 'check', this.secretState()) });
				return;
			}
			if (noteTracker !== null && noteTracker !== current.value.name) {
				modal.setState({
					kind: 'error',
					message: `The backlog of this note was created in ${noteTracker}, but Refinr now uses ${current.value.name}. Nothing was sent.`,
				});
				return;
			}
			const result = await client.validateStory(story.key, VALIDATION_TIMEOUT_MS);
			if (result.ok) {
				let found = false;
				let frontmatter: string;
				try {
					await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
						found = applyValidation(fm, story.key, moment().format());
					});
					frontmatter = found
						? `Verdict of ${story.key} updated in the "refinr" property of ${file.path}.`
						: `${story.key} is no longer in the "refinr" property of ${file.path}: the note was not updated.`;
				} catch (e) {
					frontmatter = `Could not update the "refinr" property of ${file.path} (${errorText(e)}): set the verdict of ${story.key} to ai-ready by hand.`;
				}
				modal.setState({ kind: 'done', frontmatter, frontmatterOk: found });
			} else {
				modal.setState({
					kind: 'error',
					message: validationError(result.error, story.key, current.value.name, baseUrl, this.secretState()),
				});
			}
			if (!modal.isShown) {
				this.notify(`Refinr: the validation of ${story.key} has ended.`, 'Show result', () => modal.open());
			}
		} finally {
			this.busy.delete(file.path);
		}
	}

	/** Notice for a window closed while Refinr was working, with a button to reopen it (result kept in memory). */
	private notify(text: string, buttonText: string, reopen: () => void): void {
		const notice = new Notice(
			createFragment((fragment) => {
				fragment.createDiv({ text });
				const button = fragment.createEl('button', { text: buttonText });
				button.addEventListener('click', () => {
					notice.hide();
					reopen();
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

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
