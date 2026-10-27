import { readFileSync, writeFileSync } from 'node:fs';

// Flutter's engine embeds a Google Fonts fallback even with --no-web-resources-cdn.
// Keep the generated fallback local as well; Roboto and Arabic are bundled by pubspec.
const file = 'apps/shell-flutter/build/web/main.dart.js';
const source = readFileSync(file, 'utf8');
const localized = source.replaceAll('https://fonts.gstatic.com/s/', 'assets/fonts/');
if (/https?:\/\/(?:fonts\.gstatic\.com|fonts\.googleapis\.com)\b/.test(localized)) {
  throw new Error('Flutter font asset configuration changed; review the generated engine before serving.');
}
writeFileSync(file, localized);
console.log('Flutter font fallback uses local bundled assets.');
