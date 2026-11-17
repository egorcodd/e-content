import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = JSON.parse(await readFile(resolve(root, 'collectors/tiktok/upstream.json')));
const local = resolve(root, '.local/tiktok-native');
const source = resolve(root, upstream.directory);
const python = resolve(
  local,
  process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python',
);
async function run(command, args, cwd = root) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? done() : reject(new Error(`Setup exited with ${code}`)),
    );
  });
}
await mkdir(local, { recursive: true });
if (!existsSync(resolve(source, 'package.json'))) {
  const response = await fetch(
    `${upstream.repository.replace('https://github.com/', 'https://api.github.com/repos/')}/tarball/${upstream.revision}`,
    { signal: AbortSignal.timeout(90000) },
  );
  if (!response.ok) throw new Error('Не удалось скачать исходники сборщика.');
  const archive = resolve(local, 'upstream.tar.gz');
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  await run('python', [
    '-c',
    'import sys,tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2],filter="data")',
    archive,
    resolve(local, 'upstream'),
  ]);
}
if (!existsSync(python)) await run('python', ['-m', 'venv', resolve(local, 'venv')]);
await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', upstream.transport]);
const npm =
  process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
await run(
  process.execPath,
  [
    npm,
    existsSync(resolve(source, 'package-lock.json')) ? 'ci' : 'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ],
  source,
);
await run(process.execPath, [npm, 'run', 'build'], source);
await writeFile(
  resolve(local, 'installed.json'),
  JSON.stringify({ revision: upstream.revision, at: new Date().toISOString() }),
);
console.log('Сборщик TikTok установлен.');
