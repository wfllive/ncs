'use strict';
/* =============================================================================
 *  src/update.js — проверка и установка обновлений
 *
 *  ИСТОЧНИК ДАННЫХ: файл version.json в репозитории, читается через
 *  raw.githubusercontent.com.
 *
 *  Почему raw, а не GitHub API:
 *    • у API лимит 60 запросов в час без токена — легко упереться
 *    • raw отдаётся с CDN, лимита нет, ответ быстрее
 *    • формат мы задаём сами: версия, дата, что нового, минимальный Node
 *    • не зависит от структуры релизов GitHub
 *
 *  Нюанс: raw кэшируется CDN на 5 минут (Cache-Control: max-age=300).
 *  Для принудительной проверки добавляем метку времени в URL.
 *
 *  Формат version.json (лежит в корне репозитория, ветка main):
 *  {
 *    "version": "3.1.0",
 *    "published": "2026-07-28",
 *    "file": "rai-3.1.0.sh",
 *    "sha256": "...",
 *    "minNode": 18,
 *    "notes": ["строка 1", "строка 2"],
 *    "critical": false
 *  }
 * ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');

const { C, log, ok, warn, err, step } = require('./ui.js');

// ---------------------------------------------------------------- настройки
function detectRepo() {
  if (process.env.RAI_REPO) return process.env.RAI_REPO;
  try { if (typeof __RAI !== 'undefined' && __RAI.repo) return __RAI.repo; } catch {}
  try {
    const p = path.join(process.env.RAI_HOME || '', 'package.json');
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const url = j.repository && (j.repository.url || j.repository);
      if (url) return String(url).replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
    }
  } catch {}
  return 'USER/rai';
}

const REPO   = detectRepo();
const BRANCH = process.env.RAI_BRANCH || 'main';
const RAW    = process.env.RAI_RAW_BASE || 'https://raw.githubusercontent.com';

/**
 * Где искать version.json. Два источника, пробуем по очереди:
 *
 *  1. Вложение последнего релиза:
 *       github.com/<repo>/releases/latest/download/version.json
 *     GitHub сам редиректит на актуальный тег — ничего коммитить не нужно,
 *     достаточно приложить файл к релизу через веб-интерфейс.
 *
 *  2. Ветка репозитория (запасной путь):
 *       raw.githubusercontent.com/<repo>/<branch>/version.json
 */
const RELEASE_MANIFEST = process.env.RAI_MANIFEST_URL ||
  `https://github.com/${REPO}/releases/latest/download/version.json`;
const BRANCH_MANIFEST = `${RAW}/${REPO}/${BRANCH}/version.json`;
const MANIFEST_URL = RELEASE_MANIFEST;

/**
 * Ссылка на файл релиза.
 * По умолчанию — через latest/download: не зависит от того, совпал ли тег
 * с версией. Если задано RAI_DL_BASE — используется он (для тестов/зеркал).
 */
const downloadUrl = (file, version) => {
  if (process.env.RAI_DL_BASE) return `${process.env.RAI_DL_BASE}/${file}`;
  return `https://github.com/${REPO}/releases/latest/download/${file}`;
};

const CACHE_DIR = path.join(process.env.HOME || os.homedir(), '.rai');
const CACHE_FILE = path.join(CACHE_DIR, 'update-check.json');
const DAY = 24 * 60 * 60 * 1000;
const CHECK_TTL = Number(process.env.RAI_UPDATE_TTL || DAY);

// ---------------------------------------------------------------- версии
function cmp(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// ---------------------------------------------------------------- кэш
const readCache = () => {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
};
const writeCache = (d) => {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(d, null, 2)); } catch {}
};

// ---------------------------------------------------------------- сеть
/** GET текста с таймаутом. Никогда не бросает. */
function getText(url, timeout = 6000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const mod = url.startsWith('http://') ? http : https;

    const req = mod.get(url, { headers: { 'User-Agent': 'rai-updater' }, timeout }, (res) => {
      // raw может перенаправлять
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return getText(res.headers.location, timeout).then(finish);
      }
      if (res.statusCode !== 200) { res.resume(); return finish({ __status: res.statusCode }); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 512 * 1024) req.destroy(); });
      res.on('end', () => finish(body));
    });
    req.on('timeout', () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
  });
}

// ---------------------------------------------------------------- манифест
/**
 * Прочитать version.json.
 * @returns {object|null} манифест, {__status} при ошибке HTTP, null при обрыве
 */
async function fetchManifest(force = false) {
  const cache = readCache();
  const fresh = cache.checkedAt && (Date.now() - cache.checkedAt < CHECK_TTL);
  if (!force && fresh && cache.latest && cache.latest.version)
    return { ...cache.latest, cached: true };

  // Источник 1: вложение последнего релиза (ничего коммитить не надо)
  // Источник 2: файл в ветке репозитория
  const bust = force ? `?t=${Date.now()}` : '';
  let text = await getText(RELEASE_MANIFEST + bust);
  let from = 'release';

  if (!text || text.__status) {
    const alt = await getText(BRANCH_MANIFEST + bust);
    if (alt && !alt.__status) { text = alt; from = 'branch'; }
    else if (!text) text = alt;          // обе попытки без связи
  }

  if (!text) return null;
  if (text.__status) return text;

  let m;
  try { m = JSON.parse(text); } catch { return { __badJson: true }; }
  if (!m || !m.version) return { __badJson: true };

  const info = {
    version:   String(m.version),
    published: m.published || '',
    file:      m.file || `rai-${m.version}.sh`,
    sha256:    m.sha256 || '',
    minNode:   m.minNode || 18,
    notes:     Array.isArray(m.notes) ? m.notes : (m.notes ? [String(m.notes)] : []),
    critical:  !!m.critical,
  };
  info.from = from;
  writeCache({ ...cache, checkedAt: Date.now(), latest: info });
  return { ...info, cached: false };
}

// ---------------------------------------------------------------- уведомление
async function notifyIfOutdated(current) {
  if (process.env.RAI_NO_UPDATE_CHECK === '1') return;
  if (REPO === 'USER/rai') return;

  const cache = readCache();
  if (cache.notifiedAt && cache.notifiedFor &&
      Date.now() - cache.notifiedAt < DAY &&
      cache.latest && cache.notifiedFor === cache.latest.version) return;

  const m = await fetchManifest(false);
  if (!m || m.__status || m.__badJson) return;
  if (cmp(m.version, current) <= 0) return;

  writeCache({ ...readCache(), notifiedAt: Date.now(), notifiedFor: m.version });

  console.log();
  if (m.critical) {
    console.log(`  ${C.red}▲ Важное обновление: RAI v${m.version}${C.r}  ${C.d}(у вас ${current})${C.r}`);
    if (m.notes[0]) console.log(`    ${C.d}${m.notes[0]}${C.r}`);
  } else {
    console.log(`  ${C.yel}▲ Доступна RAI v${m.version}${C.r}  ${C.d}(у вас ${current})${C.r}`);
  }
  console.log(`    ${C.cya}rai update${C.r}  ${C.d}— обновиться${C.r}`);
}

// ---------------------------------------------------------------- команда
async function command(args, ctx) {
  const checkOnly = args.includes('--check') || args.includes('-c');
  const force = args.includes('--force') || args.includes('-f');

  step('Обновление RAI');
  console.log(`  установлено : v${ctx.version}${ctx.mode !== 'release' ? ` (${ctx.mode})` : ''}`);
  console.log(`  репозиторий : ${REPO}`);
  console.log(`  источник    : ${C.d}version.json (без лимитов GitHub API)${C.r}`);

  if (REPO === 'USER/rai') {
    console.log();
    warn('репозиторий обновлений не настроен');
    console.log(`  Укажите его:  ${C.b}export RAI_REPO="ваш-логин/rai"${C.r}`);
    console.log('  или поправьте поле "repository" в package.json перед сборкой.');
    return 1;
  }

  console.log();
  log('Читаю version.json…');
  const m = await fetchManifest(true);

  if (!m) {
    warn('нет связи с GitHub');
    console.log(`  Проверьте интернет или откройте вручную:`);
    console.log(`      https://github.com/${REPO}/releases`);
    return 1;
  }
  if (m.__status === 404) {
    warn(`version.json не найден в ${REPO}`);
    console.log();
    console.log('  Приложите version.json к релизу на GitHub —');
    console.log('  он лежит в корне проекта после npm run build:release.');
    console.log();
    console.log(`  ${C.d}искали:${C.r}`);
    console.log(`  ${C.d}  ${RELEASE_MANIFEST}${C.r}`);
    console.log(`  ${C.d}  ${BRANCH_MANIFEST}${C.r}`);
    return 1;
  }
  if (m.__status) { warn(`GitHub ответил кодом ${m.__status}`); return 1; }
  if (m.__badJson) {
    warn('version.json повреждён или имеет неверный формат');
    console.log(`  Проверьте: ${MANIFEST_URL}`);
    return 1;
  }

  const diff = cmp(m.version, ctx.version);

  if (diff <= 0) {
    ok(`установлена последняя версия (v${ctx.version})`);
    const src = m.from === 'branch' ? 'ветка репозитория' : 'релиз GitHub';
    console.log(`  ${C.d}опубликовано: v${m.version}${m.published ? ' от ' + m.published : ''} · ${src}${C.r}`);
    if (diff < 0) console.log(`  ${C.d}Ваша версия новее — вероятно, сборка из исходников.${C.r}`);
    return 0;
  }

  console.log();
  const title = m.critical ? `${C.red}Важное обновление: v${m.version}${C.r}`
                           : `${C.grn}Доступна v${m.version}${C.r}`;
  console.log(`  ${title}${m.published ? `  ${C.d}от ${m.published}${C.r}` : ''}`);
  console.log(`  файл  : ${m.file}`);
  if (m.notes.length) {
    console.log();
    for (const n of m.notes) console.log(`  ${C.d}• ${n}${C.r}`);
  }

  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (m.minNode && nodeMajor < m.minNode) {
    console.log();
    warn(`нужен Node.js ${m.minNode}+, у вас ${process.versions.node}`);
    console.log('  Обновите Node перед установкой.');
    return 1;
  }

  console.log();
  if (checkOnly) {
    console.log(`  Обновиться:  ${C.cya}rai update${C.r}`);
    return 0;
  }

  // ---- скачивание ----
  const url = downloadUrl(m.file, m.version);
  const dest = path.join(os.tmpdir(), m.file);
  log(`Скачиваю ${m.file}…`);

  const dl = spawnSync('curl', ['-fL', '--progress-bar', '-o', dest, url], { stdio: 'inherit' });
  if (dl.status !== 0 || !fs.existsSync(dest)) {
    err('загрузка не удалась');
    console.log(`  Скачайте вручную: ${url}`);
    return 1;
  }
  ok(`скачано: ${dest}`);

  // ---- сверка контрольной суммы из манифеста ----
  if (m.sha256) {
    const r = spawnSync('sha256sum', [dest], { encoding: 'utf8' });
    const got = (r.stdout || '').split(' ')[0];
    if (got && got !== m.sha256) {
      err('контрольная сумма не совпала');
      console.log(`  ожидалось: ${m.sha256}`);
      console.log(`  получено : ${got}`);
      console.log('  Файл повреждён или подменён. Установка отменена.');
      fs.rmSync(dest, { force: true });
      return 1;
    }
    if (got) ok('контрольная сумма совпала');
  }

  // ---- самопроверка файла ----
  const ver = spawnSync('bash', [dest, '--verify'], { encoding: 'utf8' });
  if (ver.status !== 0) {
    err('файл не прошёл проверку подлинности — установка отменена');
    console.log((ver.stdout || '').trim().split('\n').slice(-2).join('\n'));
    fs.rmSync(dest, { force: true });
    return 1;
  }
  ok('подлинность подтверждена');

  console.log();
  log('Устанавливаю…');
  const inst = spawnSync('bash', [dest, '--update'], { stdio: 'inherit' });

  if (inst.status === 0) {
    writeCache({ ...readCache(), checkedAt: 0 });
    console.log();
    ok(`Обновлено до v${m.version}`);
    console.log(`  ${C.d}Файл сохранён: ${dest}${C.r}`);
    return 0;
  }
  err('установка не удалась');
  console.log(`  Попробуйте вручную:  bash ${dest} --update`);
  return 1;
}

module.exports = { command, notifyIfOutdated, fetchManifest, cmp,
                   REPO, MANIFEST_URL, RELEASE_MANIFEST, BRANCH_MANIFEST };
