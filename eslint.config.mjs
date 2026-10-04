import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

export default [
	...baseConfig,
	{
		// Tests only run in development, so they may use development-only dependencies such as vitest.
		files: ['src/**/__tests__/**/*.ts', 'src/**/*.spec.ts'],
		rules: {
			'n/no-unpublished-import': 'off',
		},
	},
]
