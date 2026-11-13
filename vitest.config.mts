// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['tests/setup.ts'],
	},
});
