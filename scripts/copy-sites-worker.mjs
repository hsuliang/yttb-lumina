import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectRoot = process.cwd();
const target = resolve(projectRoot, 'dist/server/index.js');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(resolve(projectRoot, 'server/index.js'), target);
