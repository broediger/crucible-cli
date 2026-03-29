# Code Conventions

## Linting & Formatting

- ESLint: `npm run lint` (includes `tsc --noEmit` + ESLint), `npm run lint:fix` to auto-fix
- Prettier: `npm run format` to write, `npm run format:check` to verify
- Config: `eslint.config.js` (flat config), `.prettierrc`
- Unused variables must be prefixed with `_`

## JavaScript/TypeScript style

- Use `Number.parseInt()` instead of global `parseInt()`
- Use `String#replaceAll()` instead of `String#replace()` with `/g` flag
- Use `String.raw` for regex replacement strings with backslashes (e.g. `` String.raw`\$&` `` instead of `"\\$&"`)
