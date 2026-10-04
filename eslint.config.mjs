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
			// vi.mocked(instance.method) reads a method without calling it, which is what mocks are for.
			'@typescript-eslint/unbound-method': 'off',
		},
	},
]
