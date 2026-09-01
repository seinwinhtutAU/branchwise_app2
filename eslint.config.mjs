import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  {
    // The Python backend and real data exports aren't ESLint's business; the rest
    // are build outputs.
    ignores: ['**/node_modules', '**/dist', '**/dist-web', '**/out', 'backend/**', 'retail_data/**']
  },
  tseslint.configs.recommended,
  eslintPluginReactHooks.configs['recommended-latest'],
  eslintPluginReactRefresh.configs.vite,
  {
    settings: {
      react: { version: 'detect' }
    },
    rules: {
      // Only affects whether Vite Fast Refresh can hot-swap a file in dev — a few
      // files (dashboard/shared.tsx, lib/toast.tsx) deliberately export helpers
      // alongside components. Worth seeing, not worth failing the build over.
      'react-refresh/only-export-components': 'warn'
    }
  }
)
