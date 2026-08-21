/**
 * Проверка сгенерированного сборщика build.sh (обёртка над Storm Build):
 *   1) bash -n — синтаксис;
 *   2) DRY_RUN=1 bash build.sh debug/release/clean — пайплайн команд;
 *   3) неизвестная задача отвергается.
 * Плюс: вендоренный движок Storm должен компилироваться (py_compile).
 * Запускается через scripts/test-app.mjs.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateBuildScript } from '../../src/utils/javaProject';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name} ${extra}`); }
};

const project: any = { name: 'Dry Run', slug: 'dry-run', packageName: 'com.example.dryrun', minSdk: 24, targetSdk: 34 };
const script = generateBuildScript(project);

const dir = mkdtempSync(join(tmpdir(), 'ncs-build-'));
try {
  writeFileSync(join(dir, 'build.sh'), script, { mode: 0o755 });
  writeFileSync(join(dir, 'storm.m'), 'dependencies {\n}\n');

  console.log('build.sh: синтаксис');
  try {
    execSync('bash -n build.sh', { cwd: dir, stdio: 'pipe' });
    check('bash -n — синтаксис корректен', true);
  } catch (e: any) {
    check('bash -n — синтаксис корректен', false, String(e?.stderr || e).slice(0, 400));
  }

  console.log('build.sh: DRY_RUN debug');
  try {
    const out = execSync('DRY_RUN=1 bash build.sh debug', { cwd: dir, stdio: 'pipe', env: { ...process.env, PATH: process.env.PATH || '' } }).toString();
    check('вызывает storm build apk --d8', out.includes('storm build apk --d8'));
    check('финал — пайплайн проверен', out.includes('пайплайн проверен'));
  } catch (e: any) {
    // без storm в PATH (и без DRY_RUN-обхода проверки) — команда не нужна реально;
    // но в DRY_RUN проверка наличия storm пропускается, так что падать не должно.
    check('DRY_RUN debug проходит', false, String(e?.stderr || e?.stdout || e).slice(0, 500));
  }

  console.log('build.sh: DRY_RUN release (без signing release → ошибка с подсказкой)');
  try {
    execSync('DRY_RUN=1 bash build.sh release 2>&1', { cwd: dir, stdio: 'pipe' });
    check('release без ключа отвергнут', false, 'должен был упасть');
  } catch (e: any) {
    const out = String(e?.stdout || e?.stderr || '');
    check('release без ключа отвергнут', out.includes('bash build.sh keystore'));
  }

  console.log('build.sh: DRY_RUN clean');
  try {
    const out = execSync('DRY_RUN=1 bash build.sh clean', { cwd: dir, stdio: 'pipe' }).toString();
    check('clean вызывает storm clean', out.includes('storm clean'));
  } catch (e: any) {
    check('DRY_RUN clean проходит', false, String(e?.stderr || e?.stdout || e).slice(0, 300));
  }

  console.log('build.sh: неизвестная задача');
  try {
    execSync('DRY_RUN=1 bash build.sh banana 2>&1', { cwd: dir, stdio: 'pipe' });
    check('неизвестная задача отвергнута', false, 'должен был упасть');
  } catch (e: any) {
    check('неизвестная задача отвергнута', String(e?.stdout || e?.stderr || '').includes('Неизвестная задача'));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('storm (вендор): движок компилируется');
{
  // Запуск всегда из корня репозитория (см. scripts/test-app.mjs).
  const root = process.cwd();
  const stormDir = join(root, 'storm');
  check('папка storm/ на месте', existsSync(join(stormDir, 'storm_engine', 'cli.py')));
  try {
    const files = readdirSync(join(stormDir, 'storm_engine')).filter(f => f.endsWith('.py'));
    execSync(`python3 -m py_compile ${files.map(f => `storm/storm_engine/${f}`).join(' ')} storm/storm.py`, { cwd: root, stdio: 'pipe' });
    check(`py_compile: ${files.length} модулей OK`, true);
  } catch (e: any) {
    check('py_compile движка', false, String(e?.stderr || e).slice(0, 400));
  }
  try {
    const out = execSync('python3 -c "import sys; sys.path.insert(0, \'storm\'); import storm_engine; print(storm_engine.__version__)"', { cwd: root, stdio: 'pipe' }).toString().trim();
    check(`импорт storm_engine (v${out})`, /^\d{4}\.\d+\.\d+$/.test(out));
  } catch (e: any) {
    check('импорт storm_engine', false, String(e?.stderr || e).slice(0, 300));
  }
}

console.log('');
console.log(`Итог: ${passed} ок, ${failed} ошибок`);
process.exit(failed ? 1 : 0);
