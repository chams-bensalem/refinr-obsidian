// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT

/**
 * Local date and time with its UTC offset, e.g. `2026-11-13T22:10:50+01:00`: the format `moment().format()` gave in
 * 0.1.0, without Obsidian's `moment` (untyped for the community catalog review: its calls counted as unsafe `any`).
 */
export function localTimestamp(date: Date = new Date()): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	const abs = Math.abs(offset);
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}
