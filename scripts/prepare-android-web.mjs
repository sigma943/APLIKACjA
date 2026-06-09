import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'out');
const appDir = path.join(root, '.next', 'server', 'app');
const staticDir = path.join(root, '.next', 'static');
const publicDir = path.join(root, 'public');

function ensureDir(dir) {
  fs.mkdirSync(dir, {recursive: true});
}

function cleanDir(dir) {
  fs.rmSync(dir, {recursive: true, force: true});
  ensureDir(dir);
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, fs.readFileSync(src));
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, {withFileTypes: true})) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      ensureDir(path.dirname(to));
      fs.writeFileSync(to, fs.readFileSync(from));
    }
  }
}

cleanDir(outDir);

copyIfExists(path.join(appDir, 'index.html'), path.join(outDir, 'index.html'));
copyIfExists(path.join(appDir, '_not-found.html'), path.join(outDir, '404.html'));
copyIfExists(path.join(appDir, 'manifest.webmanifest.body'), path.join(outDir, 'manifest.webmanifest'));
copyIfExists(path.join(appDir, 'icon.png.body'), path.join(outDir, 'icon.png'));
copyIfExists(path.join(appDir, 'apple-icon.png.body'), path.join(outDir, 'apple-icon.png'));

copyDir(staticDir, path.join(outDir, '_next', 'static'));
copyDir(publicDir, outDir);

if (!fs.existsSync(path.join(outDir, 'index.html'))) {
  throw new Error('Failed to assemble Android web assets: out/index.html is missing.');
}
