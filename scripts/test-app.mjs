#!/usr/bin/env node
/**
 * Запуск тестов новых модулей (Java + XML, кастомная сборка, предпросмотр).
 *
 *   node scripts/test-app.mjs
 *
 * TS-входы бандлятся esbuild'ом во временные ESM-файлы; нативный шелл-мост
 * заменяется стабом (тесты не должны трогать устройство/проот).
 */
import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'scripts', '.tmp-tests');
mkdirSync(outDir, { recursive: true });

// Стаб шелл-моста: любые импорты …/utils/shellExecutor ведут в него.
const shellStubPlugin = {
  name: 'shell-stub',
  setup(build) {
    // Любой импорт шелл-моста (./shellExecutor, ../utils/shellExecutor…) → стаб.
    build.onResolve({ filter: /shellExecutor$/ }, () => ({
      path: join(root, 'scripts/entries/shell-stub.ts'),
    }));
    // Нативные модули устройства в тестах не нужны.
    build.onResolve({ filter: /apt-manager|termux-terminal/ }, () => ({
      path: join(root, 'scripts/entries/shell-stub.ts'),
    }));
    build.onResolve({ filter: /^react-native/ }, (args) => ({ path: args.path, external: true }));
  },
};

const runEntry = async (entry) => {
  const outfile = join(outDir, entry.replace(/[\\/]/g, '-') + '.mjs');
  await esbuild.build({
    entryPoints: [join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    outfile,
    plugins: [shellStubPlugin],
    logLevel: 'silent',
    // локальный нативный модуль не нужен в тестах
    external: ['expo-modules-core'],
  });
  const r = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  return r.status === 0;
};

const suites = [
  'scripts/test-layout-preview.mjs', // чистый ESM, без бандла
  'scripts/entries/test-java-project.ts',
  'scripts/entries/test-native-build.ts',
];

let allOk = true;
for (const s of suites) {
  console.log(`\n━━━ ${s} ━━━`);
  let ok;
  if (s.endsWith('.mjs')) {
    const r = spawnSync(process.execPath, [join(root, s)], { stdio: 'inherit' });
    ok = r.status === 0;
  } else {
    ok = await runEntry(s);
  }
  if (!ok) allOk = false;
}

rmSync(outDir, { recursive: true, force: true });
console.log(allOk ? '\n✅ Все тесты приложения пройдены' : '\n❌ Есть упавшие тесты');
process.exit(allOk ? 0 : 1);
