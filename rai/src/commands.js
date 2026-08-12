'use strict';
/* =============================================================================
 *  src/commands.js — все команды RAI
 *
 *  JS отвечает за разбор аргументов и состояние.
 *  Тяжёлую работу (сборка, установка SDK) выполняют shell-модули.
 * ========================================================================== */

const path = require('path');
const fs = require('fs');

const { C, log, ok, warn, err, die, step } = require("./ui.js");
const run = require("./run.js");
const st = require("./state.js");
const projects = require("./projects.js");

// ------------------------------------------------------------------ справка
function usage(ctx) {
console.log(`
${C.cya}RAI${C.r}  Rapid Android on ARM  ${C.d}v${ctx.version}${ctx.mode === 'debug' ? ' (debug)' : ''}${C.r}
Сборка Android-приложений на устройстве. Только arm64-v8a.

${C.b}СБОРКА APK${C.r}
  rai build <проект>              debug APK
  rai build <проект> release      release APK (подпись + R8)
  rai build <проект> bundle       AAB для Google Play
  rai clean <проект>              очистить артефакты

${C.b}ПРОЕКТЫ${C.r}
  rai new <Имя> [пакет] [--modern]
  rai prepare <проект>            починить + скачать зависимости
  rai list                        все проекты
  rai apk <проект>                собранные APK и их ABI

${C.b}ПОДПИСЬ И ВЕРСИИ${C.r}
  rai keystore create <проект>    ключ RSA 2048 на 30 лет
  rai keystore info <проект>
  rai keystore verify <apk>
  rai version                     версии RAI и проектов
  rai version app <проект> --bump patch|minor|major

${C.b}УСТАНОВКА${C.r}
  rai install base                система: apt, JDK 17, утилиты
  rai install sdk                 нативный ARM Android SDK
  rai sdk                         доступные версии SDK
  rai install rootfs              скачать Ubuntu-образ

${C.b}САМ RAI${C.r}
  rai update                      обновиться с GitHub Releases
  rai update --check              только проверить, не ставить
  rai uninstall                   как удалить
  rai verify                      подлинность сборки

${C.b}ДИАГНОСТИКА${C.r}
  rai status                      состояние и следующий шаг
  rai check <проект>              быстрая проверка перед сборкой
  rai doctor                      полная диагностика
  rai fix abi <проект>            починить build.gradle.kts
  rai report --save               отчёт для поддержки

${C.b}ПРИМЕР${C.r}
  rai install sdk
  rai new Shop com.my.shop --modern
  rai build Shop
  rai keystore create Shop
  rai build Shop release
`);
  return 0;
}

// ------------------------------------------------------------------ статус
function status(ctx) {
  const s = st.collect();

  step(`RAI v${ctx.version}`);
  console.log(`  среда      : ${s.envName}`);
  console.log(`  архитектура: ${s.arch}${s.arch !== 'aarch64' ? C.yel + '  (не aarch64)' + C.r : ''}`);
  console.log(`  сборка     : ${bundleLabel(ctx)}`);

  step('Компоненты');
  console.log(`  Java        : ${s.java || C.d + 'нет' + C.r}` +
    (s.java && s.hasJavac === false ? `  ${C.yel}только JRE, нужен JDK${C.r}` : ''));
  console.log(`  build-tools : ${s.buildTools.join(' ') || C.d + 'нет' + C.r}` +
    (s.buildTools.length
      ? (s.nativeArm ? `  ${C.grn}нативный ARM${C.r}`
                     : `  ${C.red}${s.aapt2Arch || 'не ARM'}${C.r}`)
      : ''));
  console.log(`  platforms   : ${s.platforms.join(' ') || C.d + 'нет' + C.r}`);
  if (s.maxSdk) console.log(`  compileSdk  : до ${s.maxSdk}`);

  if (s.projects.length) {
    step('Проекты');
    for (const p of s.projects) {
      console.log(`  ${C.grn}${p.name.padEnd(18)}${C.r} v${p.versionName} (code ${p.versionCode})` +
        `  SDK ${p.compileSdk}  APK ${p.apks}` + (p.signed ? `  ${C.d}подписан${C.r}` : ''));
    }
  }

  const n = st.nextStep(s);
  if (n) {
    console.log(`\n  ${C.yel}▸ ${n.text}${C.r}`);
    console.log(`    ${C.cya}${n.cmd}${C.r}`);
  }
  console.log();
  return 0;
}

function bundleLabel(ctx) {
  const fpFile = path.join(ctx.home, '.fingerprint');
  const fp = fs.existsSync(fpFile) ? fs.readFileSync(fpFile, 'utf8').trim() : '';
  if (ctx.mode === 'debug')  return `${C.yel}debug${C.r}${fp ? C.d + ' (' + fp + ')' + C.r : ''}`;
  if (ctx.mode === 'source') return `${C.d}из исходников${C.r}`;
  return `${C.grn}release${C.r}${fp ? C.d + ' (' + fp + ')' + C.r : ''}`;
}

// ------------------------------------------------------------------ сборка
function build(args) {
  let variant = 'debug', projArg = '', skip = false;
  const extra = [];
  for (const a of args) {
    if (['release', 'debug', 'bundle'].includes(a)) variant = a;
    else if (a === '--skip-check' || a === '--no-check') skip = true;
    else if (a.startsWith('-')) extra.push(a);
    else if (!projArg) projArg = a;
    else extra.push(a);
  }

  const proj = st.resolveProject(projArg);
  if (!st.isProject(proj)) {
    err(`Не Gradle-проект: ${proj}`);
    console.log(`  Создать:  rai new ${path.basename(proj)}`);
    return 1;
  }

  if (!skip) {
    const rc = run.sh('doctor/preflight.sh', [proj]);
    if (rc !== 0) {
      console.log(`\n  ${C.cya}Совет:${C.r} большинство проблем чинит  ` +
                  `${C.b}rai prepare ${path.basename(proj)}${C.r}`);
      return 1;
    }
  }

  if (variant === 'bundle') extra.push('--bundle');
  const script = variant === 'debug'
    ? 'project/build-debug.sh'
    : 'project/build-release.sh';
  return run.sh(script, [proj, ...extra]);
}

function clean(args) {
  const p = st.resolveProject(args[0]);
  if (!st.isProject(p)) { err('Не проект: ' + p); return 1; }
  for (const d of ['app/build', 'build', '.gradle'])
    fs.rmSync(path.join(p, d), { recursive: true, force: true });
  ok('Очищено: ' + p);
  return 0;
}

// ---------------------------------------- обновление и удаление
function cmdUpdate(args, ctx) {
  const upd = require('./update.js');
  // асинхронно, но dispatch синхронный — возвращаем промис через process.exitCode
  return upd.command(args, ctx).then(code => { process.exitCode = code; return 0; })
                               .catch(e => { err(e.message); process.exitCode = 1; return 0; });
}

function cmdUninstall(ctx) {
  step('Удаление RAI');
  if (ctx.mode === 'source') {
    console.log('  Вы запустили RAI из исходников — удалять нечего.');
    console.log(`  Удалите каталог проекта: ${C.d}${ctx.home}${C.r}`);
    return 0;
  }
  console.log(`  версия: ${ctx.version}`);
  console.log();
  console.log('  Запустите тот же файл, которым устанавливали:');
  console.log(`      ${C.cya}bash rai-${ctx.version}.sh --uninstall${C.r}`);
  console.log();
  console.log(`  ${C.d}Он спросит подтверждение. Проекты, SDK и ключи не тронет.${C.r}`);
  console.log();
  console.log(`  ${C.d}Нет файла? Скачайте: https://github.com/${require('./update.js').REPO}/releases${C.r}`);
  console.log(`  ${C.d}Код установлен в: ${ctx.home}${C.r}`);
  return 0;
}

// ------------------------------------------------------------------ роутер
function dispatch(cmd, args, ctx) {
  switch (cmd) {
    case undefined:
    case 'status':
    case 'st':          return status(ctx);

    case 'build':
    case 'b':           return build(args);
    case 'debug':       return build([...args, 'debug']);
    case 'release':     return build([...args, 'release']);
    case 'clean':       return clean(args);

    case 'new':
    case 'create':      return run.sh('project/new.sh', args);
    case 'prepare':
    case 'prep':        return run.sh('project/prepare.sh', args);
    case 'keystore':
    case 'key':
    case 'sign':        return run.sh('project/keystore.sh', args);

    case 'list':
    case 'ls':          return projects.list();
    case 'apk':         return projects.apk(args[0]);

    case 'version':
    case 'ver':         return run.sh('lib/version.sh', args,
                                      { env: { RAI_VERSION: ctx.version } });
    case '-v':
    case '--version':   console.log(`RAI v${ctx.version}`); return 0;

    case 'install':     return run.install(args);
    case 'sdk':         return run.sh('install/sdk.sh', args.length ? args : ['--list']);

    case 'check':
    case 'preflight':   return run.sh('doctor/preflight.sh', [st.resolveProject(args[0])]);
    case 'doctor':
    case 'dr':          return run.sh('doctor/full.sh', args);
    case 'fix':         return run.fix(args);
    case 'verify':
    case 'integrity':   return run.sh('lib/integrity.sh', args,
                                      { env: { RAI_VERSION: ctx.version } });
    case 'report':
    case 'support':     return run.sh('lib/report.sh', args, {
                          env: { RAI_REPORT_PROJECT:
                                 st.resolveProject(args.find(a => !a.startsWith('-'))) } });
    case 'sources':     return run.shInline('. "$RAI_HOME/lib/sources.sh"; rai_sources_show');

    case 'update':
    case 'upgrade':     return cmdUpdate(args, ctx);
    case 'uninstall':
    case 'remove':      return cmdUninstall(ctx);

    case 'help':
    case '-h':
    case '--help':      return usage(ctx);

    default:
      err('Неизвестная команда: ' + cmd);
      console.log(`  ${C.d}Список команд: rai help${C.r}`);
      return 1;
  }
}

module.exports = { dispatch, usage, status };

