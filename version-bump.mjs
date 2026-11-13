// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
//
// Plugin version tooling, run from the repository root. Based on version-bump.mjs of obsidianmd/obsidian-sample-plugin.
// Obsidian downloads main.js, manifest.json and styles.css from the GitHub release whose tag equals manifest.json
// "version" (x.y.z, no "v" prefix), and reads versions.json (plugin version -> minAppVersion) from the default branch.
//
//   node version-bump.mjs
//     Run by `npm version <x.y.z>` (the "version" script of package.json), after npm has written the new version to
//     package.json (read from npm_package_version):
//       - manifest.json: "version" set to the new version (minAppVersion is left as is: update it by hand first);
//       - versions.json: "<new version>": "<minAppVersion>" added, unless the version is already listed.
//
//   node version-bump.mjs check <tag>
//     Run by the release workflow before building: the tag must equal manifest.json and package.json "version", and
//     versions.json must map it to manifest.json "minAppVersion". Exit code 1 lists every mismatch.
import { readFileSync, writeFileSync } from 'node:fs';

const VERSION = /^\d+\.\d+\.\d+$/;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, '\t')}\n`);

function bump() {
	const targetVersion = process.env.npm_package_version;
	if (!targetVersion || !VERSION.test(targetVersion)) {
		console.error(
			`version-bump: expected an x.y.z version in npm_package_version, got "${targetVersion ?? ''}". ` +
				'Run it through `npm version <x.y.z>`.',
		);
		return 1;
	}

	const manifest = readJson('manifest.json');
	const { minAppVersion } = manifest;
	if (typeof minAppVersion !== 'string' || minAppVersion === '') {
		console.error('version-bump: manifest.json has no minAppVersion.');
		return 1;
	}
	manifest.version = targetVersion;
	writeJson('manifest.json', manifest);

	const versions = readJson('versions.json');
	if (!(targetVersion in versions)) {
		versions[targetVersion] = minAppVersion;
		writeJson('versions.json', versions);
	}
	console.log(`version-bump: manifest.json ${targetVersion}, versions.json "${targetVersion}": "${versions[targetVersion]}".`);
	return 0;
}

function check(tag) {
	const errors = [];
	const tryReadJson = (file) => {
		try {
			return readJson(file);
		} catch (error) {
			errors.push(`${file}: cannot be read as JSON (${error instanceof Error ? error.message : String(error)}).`);
			return undefined;
		}
	};

	if (!VERSION.test(tag)) {
		errors.push(`tag "${tag}": expected x.y.z (for example 0.1.0), without a "v" prefix.`);
	}
	const manifest = tryReadJson('manifest.json');
	const pkg = tryReadJson('package.json');
	const versions = tryReadJson('versions.json');

	if (manifest !== undefined && manifest.version !== tag) {
		errors.push(`manifest.json: "version" is "${manifest.version}", the tag is "${tag}".`);
	}
	if (pkg !== undefined && pkg.version !== tag) {
		errors.push(`package.json: "version" is "${pkg.version}", the tag is "${tag}".`);
	}
	if (versions !== undefined && manifest !== undefined) {
		if (!Object.prototype.hasOwnProperty.call(versions, tag)) {
			errors.push(`versions.json: no entry "${tag}" (expected "${tag}": "${manifest.minAppVersion}").`);
		} else if (versions[tag] !== manifest.minAppVersion) {
			errors.push(
				`versions.json: "${tag}" maps to "${versions[tag]}", manifest.json "minAppVersion" is ` +
					`"${manifest.minAppVersion}".`,
			);
		}
	}

	if (errors.length > 0) {
		console.error(
			`Release ${tag || '(no tag)'} refused: the tag, manifest.json, package.json and versions.json disagree.`,
		);
		for (const error of errors) console.error(`  - ${error}`);
		console.error('Fix the files with `npm version <x.y.z>` (update minAppVersion first if needed), merge, then tag.');
		return 1;
	}
	console.log(`Release ${tag}: manifest.json, package.json and versions.json ("${tag}": "${versions[tag]}") match.`);
	return 0;
}

const [command, tag] = process.argv.slice(2);
if (command === undefined) {
	process.exitCode = bump();
} else if (command === 'check') {
	process.exitCode = check(tag ?? '');
} else {
	console.error(`version-bump: unknown command "${command}" (expected no argument, or "check <tag>").`);
	process.exitCode = 1;
}
