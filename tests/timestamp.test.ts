// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { localTimestamp } from '../src/timestamp';

describe('localTimestamp', () => {
	it('has the format of moment().format(): local time and UTC offset', () => {
		expect(localTimestamp(new Date(2026, 10, 13, 22, 10, 50))).toMatch(/^2026-11-13T22:10:50[+-]\d{2}:\d{2}$/);
	});

	it('denotes the same instant', () => {
		const date = new Date(Date.UTC(2026, 0, 5, 3, 4, 5));
		expect(new Date(localTimestamp(date)).getTime()).toBe(date.getTime());
	});
});
