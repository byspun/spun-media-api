import { cp, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/vendor/', import.meta.url), { recursive: true });
await cp(new URL('../vendor/', import.meta.url), new URL('../dist/vendor/', import.meta.url), { recursive: true });
