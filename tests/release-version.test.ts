// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Release tooling, run as the release workflow and `npm version` run it: a Node process in a directory holding
 * manifest.json, package.json and versions.json.
 */
const ROOT = resolve(__dirname, '..');
const BUMP = join(ROOT, 'version-bump.mjs');

let dir: string;

function write(file: string, value: unknown): void {
	writeFileSync(join(dir, file), `${JSON.stringify(value, null, '\t')}\n`);
}

function read(file: string): string {
	return readFileSync(join(dir, file), 'utf8');
}

function run(script: string, args: string[], env: Record<string, string | undefined> = {}) {
	const result = spawnSync(process.execPath, [script, ...args], {
		cwd: dir,
		encoding: 'utf8',
		env: { ...process.env, npm_package_version: undefined, ...env },
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function release(version: string, minAppVersion: string, versions: Record<string, string>): void {
	write('manifest.json', { id: 'refinr', version, minAppVersion, isDesktopOnly: true });
	write('package.json', { name: 'refinr-obsidian', version });
	write('versions.json', versions);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'refinr-release-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('version-bump.mjs (npm version)', () => {
	it('sets the manifest version and adds the version to versions.json with the current minAppVersion', () => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });

		const result = run(BUMP, [], { npm_package_version: '0.2.0' });

		expect(result.status).toBe(0);
		expect(JSON.parse(read('manifest.json'))).toEqual({
			id: 'refinr',
			version: '0.2.0',
			minAppVersion: '1.13.0',
			isDesktopOnly: true,
		});
		expect(read('versions.json')).toBe('{\n\t"0.1.0": "1.13.0",\n\t"0.2.0": "1.13.0"\n}\n');
		expect(read('manifest.json').endsWith('}\n')).toBe(true);
	});

	it('records a raised minAppVersion for the new version only', () => {
		release('0.1.0', '1.15.0', { '0.1.0': '1.13.0' });

		expect(run(BUMP, [], { npm_package_version: '0.2.0' }).status).toBe(0);
		expect(JSON.parse(read('versions.json'))).toEqual({ '0.1.0': '1.13.0', '0.2.0': '1.15.0' });
	});

	it('leaves an existing versions.json entry unchanged', () => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });
		const before = read('versions.json');

		expect(run(BUMP, [], { npm_package_version: '0.1.0' }).status).toBe(0);
		expect(read('versions.json')).toBe(before);
	});

	it.each([undefined, 'v0.2.0', '0.2.0-beta.1', '0.2'])('refuses version %s and changes nothing', (version) => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });
		const manifest = read('manifest.json');
		const versions = read('versions.json');

		const result = run(BUMP, [], { npm_package_version: version });

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('expected an x.y.z version');
		expect(read('manifest.json')).toBe(manifest);
		expect(read('versions.json')).toBe(versions);
	});

	it('produces files that the release check accepts', () => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });
		write('package.json', { name: 'refinr-obsidian', version: '0.3.0' }); // written by npm before the script

		expect(run(BUMP, [], { npm_package_version: '0.3.0' }).status).toBe(0);
		expect(run(BUMP, ['check', '0.3.0']).status).toBe(0);
	});
});

describe('version-bump.mjs check (release workflow)', () => {
	it('accepts a tag equal to the versions of every file', () => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });

		const result = run(BUMP, ['check', '0.1.0']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Release 0.1.0: manifest.json, package.json and versions.json');
	});

	it('refuses a "v" prefix', () => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });

		const result = run(BUMP, ['check', 'v0.1.0']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('tag "v0.1.0": expected x.y.z (for example 0.1.0), without a "v" prefix.');
	});

	it('refuses a missing tag', () => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });

		const result = run(BUMP, ['check']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Release (no tag) refused');
	});

	it('lists every file that does not match the tag', () => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });

		const result = run(BUMP, ['check', '0.2.0']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Release 0.2.0 refused');
		expect(result.stderr).toContain('manifest.json: "version" is "0.1.0", the tag is "0.2.0".');
		expect(result.stderr).toContain('package.json: "version" is "0.1.0", the tag is "0.2.0".');
		expect(result.stderr).toContain('versions.json: no entry "0.2.0" (expected "0.2.0": "1.13.0").');
	});

	it('refuses a versions.json entry that disagrees with minAppVersion', () => {
		release('0.2.0', '1.15.0', { '0.1.0': '1.13.0', '0.2.0': '1.13.0' });

		const result = run(BUMP, ['check', '0.2.0']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			'versions.json: "0.2.0" maps to "1.13.0", manifest.json "minAppVersion" is "1.15.0".',
		);
	});

	it('reports an unreadable file', () => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });
		writeFileSync(join(dir, 'versions.json'), '{ not json');

		const result = run(BUMP, ['check', '0.1.0']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('versions.json: cannot be read as JSON');
	});

	it('accepts the files of this repository for their own version', () => {
		const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

		const result = spawnSync(process.execPath, [BUMP, 'check', version], { cwd: ROOT, encoding: 'utf8' });

		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
	});

	it('refuses an unknown command', () => {
		release('0.1.0', '1.13.0', { '0.1.0': '1.13.0' });

		const result = run(BUMP, ['chek', '0.1.0']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('unknown command "chek"');
	});
});
