// `npm run dev`: runs the booking API and the Vite dev server together.
import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];

let exiting = false;
function stopAll(code) {
  if (exiting) return;
  exiting = true;
  for (const c of children) if (c.exitCode === null && !c.killed) c.kill('SIGTERM');
  process.exitCode = code ?? 0;
}

for (const c of children) {
  c.on('exit', (code) => stopAll(code ?? 0));
  c.on('error', () => stopAll(1));
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stopAll(0));
