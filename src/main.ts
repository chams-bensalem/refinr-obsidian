// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { Notice, Plugin } from 'obsidian';
import { obsidianTransport } from './api/obsidian-transport';
import { normalizeBaseUrl, RefinrClient } from './api/refinr-client';
import { buildConnectionReport, checkConnection, type SecretState } from './connection';
import { normalizeSettings, type RefinrSettings } from './settings';
import { RefinrSettingTab } from './settings-tab';

export default class RefinrPlugin extends Plugin {
	settings: RefinrSettings = normalizeSettings(undefined);

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
