// Собирает веб-часть мобильных приложений из общих исходников apps/ в mobile/<app>/www.
//   node scripts/build-www.mjs            — оба приложения
//   node scripts/build-www.mjs client     — только «Мой автомеханик»
// Адрес сервера экосистемы задаётся переменной MA_SERVER_URL (например https://api.example.by).
// Без неё: Android-эмулятор → http://10.0.2.2:8080, iOS-симулятор → http://localhost:8080.
// В самом приложении адрес можно сменить, нажав на индикатор связи.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPS = {
  client: { files: ['index.html', 'client-sync.js'] },
  concierge: { files: ['index.html', 'concierge-app.js'] }
};
const only = process.argv[2];
const server = process.env.MA_SERVER_URL || '';

for (const [name, cfg] of Object.entries(APPS)) {
  if (only && only !== name) continue;
  const src = path.join(root, 'apps', name);
  const out = path.join(root, 'mobile', name, 'www');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'shared'), { recursive: true });
  for (const f of cfg.files) {
    let s = fs.readFileSync(path.join(src, f), 'utf8');
    if (f.endsWith('.html')) {
      s = s.replace(/\.\.\/shared\//g, './shared/')
        .replace('<script src="./shared/ma-sdk.js"></script>', '<script src="config.js"></script>\n<script src="./shared/ma-sdk.js"></script>\n<script src="native.js"></script>');
    }
    fs.writeFileSync(path.join(out, f), s);
  }
  fs.copyFileSync(path.join(root, 'apps', 'shared', 'ma-sdk.js'), path.join(out, 'shared', 'ma-sdk.js'));
  fs.writeFileSync(path.join(out, 'config.js'), `// создано scripts/build-www.mjs
window.MA_CONFIG = { app: ${JSON.stringify(name)}, server: ${JSON.stringify(server)} };
if (!window.MA_CONFIG.server) {
  var p = window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web';
  window.MA_CONFIG.server = p === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080';
}
`);
  fs.copyFileSync(path.join(root, 'mobile', 'scripts', 'native.js'), path.join(out, 'native.js'));
  console.log(`✓ ${name}: ${path.relative(root, out)}  (сервер: ${server || 'по умолчанию для эмулятора'})`);
}
