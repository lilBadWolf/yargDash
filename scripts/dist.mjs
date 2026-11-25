#!/usr/bin/env node
// Package the desktop app into release/: build the page, on macOS build the YARG data-stream fix (so people who
// install the app don't need Xcode's tools), then run electron-builder with any extra arguments.
//
//   npm run dist                # for this computer's OS
//   npm run dist -- --win       # or --mac / --linux (cross-building has limits: see electron-builder's docs)
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
const bin = (pkg, file) => path.join(ROOT, 'node_modules', pkg, file);

run(process.execPath, [bin('vite', 'bin/vite.js'), 'build', '--logLevel', 'warn']);

const args = process.argv.slice(2);
const forMac = args.includes('--mac') || (process.platform === 'darwin' && !args.some((a) => a === '--win' || a === '--linux'));
if (forMac) {
  if (process.platform !== 'darwin') throw new Error('The macOS app has to be built on a Mac (it compiles yarg/broadcast-fix.c).');
  fs.mkdirSync(path.join(ROOT, 'yarg', 'build'), { recursive: true });
  run('clang', ['-dynamiclib', '-arch', 'arm64', '-arch', 'x86_64', '-O2', '-o', 'yarg/build/yarg-broadcast.dylib', 'yarg/broadcast-fix.c']);
}

run(process.execPath, [bin('electron-builder', 'cli.js'), ...args]);
