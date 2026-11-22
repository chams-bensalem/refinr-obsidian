// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { type App, Modal, SuggestModal } from 'obsidian';
import type { CreatedVerdict } from './creation';

/**
 * Reassessment windows. SECURITY: the story title (from the note) and the verdict reason (from the language model)
 * are inserted as plain text only (`createEl({ text })`), as in the preview window.
 */
export interface PendingStory {
	title: string;
	key: string;
}

/** Choice among the stories of the note still awaiting validation. */
export class StoryPicker extends SuggestModal<PendingStory> {
	constructor(
		app: App,
		private readonly stories: PendingStory[],
		private readonly onPick: (story: PendingStory) => void,
	) {
		super(app);
		this.setPlaceholder('Choose a story awaiting validation');
	}

	getSuggestions(query: string): PendingStory[] {
		const needle = query.trim().toLowerCase();
		return this.stories.filter(
			(story) => needle === '' || story.title.toLowerCase().includes(needle) || story.key.toLowerCase().includes(needle),
		);
	}

	renderSuggestion(story: PendingStory, el: HTMLElement): void {
		el.createDiv({ text: story.title === '' ? 'Untitled story' : story.title });
		el.createEl('small', { cls: 'refinr-muted', text: story.key });
	}

	onChooseSuggestion(story: PendingStory): void {
		this.onPick(story);
	}
}

export type ReassessState =
	| { kind: 'input' }
	| { kind: 'working' }
	| { kind: 'done'; verdict: CreatedVerdict; reason: string; frontmatter: string; frontmatterOk: boolean }
	| { kind: 'error'; message: string };

/** Precision input, then the new verdict or the error. */
export class ReassessModal extends Modal {
	private state: ReassessState = { kind: 'input' };
	private shown = false;
	private precision = '';

	constructor(
		app: App,
		private readonly story: PendingStory,
		private readonly tracker: string,
		private readonly submit: (precision: string) => void,
	) {
		super(app);
	}

	get isShown(): boolean {
		return this.shown;
	}

	setState(state: ReassessState): void {
		this.state = state;
		if (this.shown) {
			this.render();
		}
	}

	onOpen(): void {
		this.shown = true;
		this.render();
	}

	onClose(): void {
		this.shown = false;
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass('refinr-preview');
		this.setTitle(`Reassess ${this.story.key}`);
		el.createEl('p', { cls: 'refinr-story-title', text: this.story.title === '' ? 'Untitled story' : this.story.title });
		const state = this.state;
		switch (state.kind) {
			case 'input': {
				el.createEl('p', {
					cls: 'refinr-muted',
					text: `Add the precision that answers the open questions. Refinr adds it to the issue in ${this.tracker}, then gives a new verdict.`,
				});
				const area = el.createEl('textarea', { cls: 'refinr-precision', attr: { rows: '6', placeholder: 'Precision' } });
				area.value = this.precision;
				const footer = el.createDiv({ cls: 'refinr-footer' });
				const button = footer.createEl('button', { cls: 'mod-cta', text: 'Reassess' });
				button.disabled = this.precision.trim() === '';
				area.addEventListener('input', () => {
					this.precision = area.value;
					button.disabled = area.value.trim() === '';
				});
				button.addEventListener('click', () => {
					const precision = area.value.trim();
					if (precision === '') {
						return;
					}
					// One click only: the state changes before the request is sent.
					button.disabled = true;
					this.setState({ kind: 'working' });
					this.submit(precision);
				});
				return;
			}
			case 'working':
				el.createEl('p', { text: `Refinr is reassessing ${this.story.key}…` });
				el.createEl('p', {
					cls: 'refinr-muted',
					text: 'This can take a few minutes. You can close this window: a notice will tell you when it is done.',
				});
				return;
			case 'done': {
				const line = el.createEl('p');
				line.createSpan({ text: 'New verdict: ' });
				line.createSpan({ cls: `refinr-verdict refinr-verdict-${state.verdict}`, text: state.verdict });
				if (state.verdict === 'validation-necessaire') {
					el.createEl('p', { text: 'The story still needs validation.' });
				}
				if (state.reason !== '') {
					el.createEl('p', { cls: 'refinr-verdict-reason', text: state.reason });
				}
				el.createEl('p', { cls: state.frontmatterOk ? 'refinr-muted' : 'refinr-warning', text: state.frontmatter });
				return;
			}
			case 'error':
				el.createEl('p', { cls: 'refinr-error', text: state.message });
				return;
		}
	}
}

export type ValidateState =
	| { kind: 'confirm' }
	| { kind: 'working' }
	| { kind: 'done'; frontmatter: string; frontmatterOk: boolean }
	| { kind: 'error'; message: string };

/** Confirmation, then the result of a human validation (no model call: the person takes the decision). */
export class ValidateModal extends Modal {
	private state: ValidateState = { kind: 'confirm' };
	private shown = false;

	constructor(
		app: App,
		private readonly story: PendingStory,
		private readonly tracker: string,
		private readonly submit: () => void,
	) {
		super(app);
	}

	get isShown(): boolean {
		return this.shown;
	}

	setState(state: ValidateState): void {
		this.state = state;
		if (this.shown) {
			this.render();
		}
	}

	onOpen(): void {
		this.shown = true;
		this.render();
	}

	onClose(): void {
		this.shown = false;
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass('refinr-preview');
		this.setTitle(`Validate ${this.story.key}`);
		el.createEl('p', { cls: 'refinr-story-title', text: this.story.title === '' ? 'Untitled story' : this.story.title });
		const state = this.state;
		switch (state.kind) {
			case 'confirm': {
				el.createEl('p', {
					text: `Mark this story ai-ready yourself, without asking the AI. Refinr writes the verdict in ${this.tracker} and replaces the validation-necessaire label.`,
				});
				const footer = el.createDiv({ cls: 'refinr-footer' });
				const button = footer.createEl('button', { cls: 'mod-cta', text: 'Validate' });
				button.addEventListener('click', () => {
					// One click only: the state changes before the request is sent.
					button.disabled = true;
					this.setState({ kind: 'working' });
					this.submit();
				});
				return;
			}
			case 'working':
				el.createEl('p', { text: `Refinr is validating ${this.story.key}…` });
				return;
			case 'done': {
				const line = el.createEl('p');
				line.createSpan({ text: 'New verdict: ' });
				line.createSpan({ cls: 'refinr-verdict refinr-verdict-ai-ready', text: 'ai-ready' });
				line.createSpan({ text: ' (validated by you)' });
				el.createEl('p', { cls: state.frontmatterOk ? 'refinr-muted' : 'refinr-warning', text: state.frontmatter });
				return;
			}
			case 'error':
				el.createEl('p', { cls: 'refinr-error', text: state.message });
				return;
		}
	}
}
