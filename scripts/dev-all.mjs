import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';

const apiProc = spawn(process.execPath, ['server/index.mjs'], {
  stdio: 'inherit',
  env: process.env,
});

const viteProc = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: isWin,
});

function shutdown() {
  apiProc.kill();
  viteProc.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

apiProc.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[dev:all] API server exited with code ${code}`);
  }
});

viteProc.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[dev:all] Vite server exited with code ${code}`);
  }
});
