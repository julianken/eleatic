import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Packaged-UI contract. `eleatic serve` resolves its static UI directory as
 * `../../ui` from dist/server/app.js — i.e. the package-root `ui/` directory
 * (tsc emits only from rootDir; there is no copy step). For an INSTALLED package
 * to serve a real UI instead of a blank page, two things must hold:
 *   1. ui/index.html exists at the package root (the directory the server serves), and
 *   2. package.json `files` ships `ui` (so it lands in node_modules on install).
 * This is the invariant that, if violated, still passes `npm pack --dry-run` and
 * a local `npx .` run but serves 404s to a real consumer — so it is asserted here.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('packaged UI', () => {
  it('serves the UI from the package-root ui/ directory', () => {
    expect(existsSync(join(ROOT, 'ui', 'index.html'))).toBe(true);
    expect(existsSync(join(ROOT, 'ui', 'trace.html'))).toBe(true);
  });

  it('ships ui/ and dist/ in the npm tarball (package.json files)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { files?: string[] };
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain('dist');
    // The served UI assets must ship — but the co-located ui/*.test.ts must NOT,
    // so files lists ui asset globs (ui/*.js|html|css), never the bare `ui` dir.
    expect(pkg.files!.some((f) => f.startsWith('ui/') && f.endsWith('.js'))).toBe(true);
    expect(pkg.files!.some((f) => f.startsWith('ui/') && f.endsWith('.html'))).toBe(true);
    expect(pkg.files).not.toContain('ui');
  });
});
