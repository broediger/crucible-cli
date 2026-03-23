# Code Conventions

## JavaScript/TypeScript style

- Use `Number.parseInt()` instead of global `parseInt()`
- Use `String#replaceAll()` instead of `String#replace()` with `/g` flag
- Use `String.raw` for regex replacement strings with backslashes (e.g. `` String.raw`\$&` `` instead of `"\\$&"`)
