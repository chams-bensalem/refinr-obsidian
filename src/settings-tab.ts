// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { type App, PluginSettingTab, SecretComponent, type SettingDefinitionItem } from 'obsidian';
import type RefinrPlugin from './main';
import { DEFAULT_SETTINGS, integerError, normalizeSettings, type RefinrSettings, SETTING_LIMITS, urlError } from './settings';

type SettingKey = keyof RefinrSettings;

/** Where the API key lives; deliberately neither "encrypted" nor "not encrypted" (it depends on Obsidian and the OS). */
export const API_KEY_STORAGE_NOTE =
	'Stored by Obsidian on this device, outside your vault files (so it is not synced with your notes). ' +
	'How it is protected depends on Obsidian and your operating system.';

/** Declarative settings (Obsidian 1.13.0): rendered by Obsidian and indexed by the settings search. */
export class RefinrSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: RefinrPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				name: 'Refinr URL',
				desc: `Base URL of your Refinr server, for example ${DEFAULT_SETTINGS.refinrUrl}.`,
				control: {
					type: 'text',
					key: 'refinrUrl',
					placeholder: DEFAULT_SETTINGS.refinrUrl,
					defaultValue: DEFAULT_SETTINGS.refinrUrl,
					validate: urlError,
				},
			},
			{
				name: 'API key',
				desc:
					'Secret holding the Refinr API key (sent as X-API-Key). Leave empty if your Refinr server has no API key. ' +
					API_KEY_STORAGE_NOTE,
				aliases: ['secret', 'X-API-Key'],
				// The declarative "secret" control needs Obsidian 1.13.2: SecretComponent (1.11.1) is rendered instead.
				render: (setting) => {
					setting.addComponent((el) =>
						new SecretComponent(this.app, el).setValue(this.plugin.settings.apiKeySecret).onChange(async (value) => {
							await this.setControlValue('apiKeySecret', value ?? '');
						}),
					);
				},
			},
			{
				name: 'Default project key',
				desc: "Project where issues are created. Leave empty to use the Refinr server's default project.",
				control: { type: 'text', key: 'defaultProjectKey' },
			},
			{
				type: 'group',
				heading: 'Embeds',
				items: [
					{
						name: 'Maximum embed depth',
						desc: 'How many levels of embedded notes are expanded before sending a note. 0 sends embeds as plain text.',
						control: this.integerControl('embedMaxDepth'),
					},
					{
						name: 'Maximum embedded characters',
						desc: 'Maximum number of characters added by expanded embeds, all levels together.',
						control: this.integerControl('embedMaxChars'),
					},
				],
			},
			{
				type: 'group',
				heading: 'Advanced',
				items: [
					{
						name: 'Analysis timeout (seconds)',
						desc:
							`How long to wait for an analysis. The default (${DEFAULT_SETTINGS.analysisTimeoutSeconds} s) covers the worst ` +
							'case of a Refinr server with default settings. Refinr may keep working after the plugin stops waiting.',
						control: this.integerControl('analysisTimeoutSeconds'),
					},
				],
			},
		];
	}

	/** Every change goes through `normalizeSettings` (types, bounds) before being saved. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: value });
		await this.plugin.saveSettings();
	}

	private integerControl(key: 'embedMaxDepth' | 'embedMaxChars' | 'analysisTimeoutSeconds') {
		const limits = SETTING_LIMITS[key];
		return {
			type: 'number' as const,
			key,
			min: limits.min,
			max: limits.max,
			step: 1,
			defaultValue: DEFAULT_SETTINGS[key],
			validate: (value: number) => integerError(value, limits),
		};
	}
}
