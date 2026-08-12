'use strict';
/* Список проектов и разбор собранных APK. */

const fs = require('fs');
const path = require('path');
const { C, step, err } = require("./ui.js");
const st = require("./state.js");
const run = require("./run.js");
const env = require("./env.js");

function list() {
  if (!fs.existsSync(st.PROJECTS)) {
    console.log('Нет проектов. Создать:  rai new MyApp');
    return;
  }
  const rows = fs.readdirSync(st.PROJECTS).sort()
    .map(d => path.join(st.PROJECTS, d))
    .filter(st.isProject)
    .map(st.readProject);

  if (!rows.length) { console.log('Нет проектов. Создать:  rai new MyApp'); return; }

  step(`Проекты  ${st.PROJECTS}`);
  console.log(`  ${'ИМЯ'.padEnd(20)} ${'ВЕРСИЯ'.padEnd(12)} ${'SDK'.padEnd(5)} ${'AGP'.padEnd(9)} APK  ПОДПИСЬ`);
  console.log('  ' + '-'.repeat(66));
  for (const p of rows) {
    console.log('  ' +
      C.grn + p.name.padEnd(20) + C.r + ' ' +
      `${p.versionName} (${p.versionCode})`.padEnd(12) + ' ' +
      String(p.compileSdk).padEnd(5) + ' ' +
      String(p.agp).padEnd(9) + ' ' +
      String(p.apks).padEnd(4) + ' ' +
      (p.signed ? C.grn + 'есть' + C.r : C.d + 'нет' + C.r));
  }
  console.log();
}

function apk(arg) {
  const proj = st.resolveProject(arg);
  if (!st.isProject(proj)) { err('Не проект: ' + proj); process.exit(1); }

  const found = [];
  (function walk(d, depth) {
    if (depth > 8) return;
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const full = path.join(d, it.name);
      if (it.isDirectory()) walk(full, depth + 1);
      else if (/\.(apk|aab)$/.test(it.name) && full.includes('outputs')) found.push(full);
    }
  })(proj, 0);
  found.sort();

  if (!found.length) {
    console.log(`APK не найдены. Соберите:  rai build ${path.basename(proj)}`);
    return;
  }

  step(`Сборки ${path.basename(proj)}`);
  for (const f of found) {
    const size = run.capture(`du -h "${f}" | cut -f1`);
    const kind = f.includes('/release/') || f.endsWith('.aab') ? 'release' : 'debug';
    console.log(`\n  ${C.grn}${path.relative(proj, f)}${C.r}`);
    console.log(`     тип    : ${kind}   размер: ${size}`);

    if (f.endsWith('.apk')) {
      const libs = run.capture(
        `unzip -l "${f}" 2>/dev/null | grep -oE 'lib/[^/]+' | sed 's|lib/||' | sort -u | tr '\\n' ' '`);
      if (libs) {
        console.log(`     ABI    : ${libs}`);
        if (!/^(arm64-v8a\s*)+$/.test(libs))
          console.log(`     ${C.yel}внимание: есть посторонние ABI${C.r}`);
      } else {
        console.log(`     ABI    : ${C.d}нет нативных .so — ставится на любое устройство${C.r}`);
      }

      // подпись
      const bt = run.capture(
        `ls "${st.SDK}/build-tools" 2>/dev/null | grep -E '^[0-9]' | sort -V | tail -1`);
      const signer = path.join(st.SDK, 'build-tools', bt, 'apksigner');
      if (bt && fs.existsSync(signer)) {
        const okSig = run.capture(`"${signer}" verify "${f}" >/dev/null 2>&1 && echo yes`) === 'yes';
        console.log(`     подпись: ${okSig ? C.grn + 'действительна' + C.r
                                            : C.d + 'нет (debug-ключ или не подписан)' + C.r}`);
      }
    }
  }
  console.log();
}

module.exports = { list, apk };

