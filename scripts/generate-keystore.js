#!/usr/bin/env node

/**
 * Script to generate production release Keystore and configure Anti-Mod security for NovaCompose Studio.
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rootDir = path.resolve(__dirname, '..');
const keystorePropsPath = path.join(rootDir, 'keystore.properties');
const gitignorePath = path.join(rootDir, '.gitignore');

function findKeytool() {
  if (process.env.JAVA_HOME) {
    const kt = path.join(process.env.JAVA_HOME, 'bin', PlatformExecutable('keytool'));
    if (fs.existsSync(kt)) return kt;
  }
  try {
    const res = spawnSync(PlatformExecutable('keytool'), ['-help']);
    if (res.status === 0 || res.stdout) return PlatformExecutable('keytool');
  } catch (_) {}
  return null;
}

function PlatformExecutable(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function ask(rl, question, defaultValue = '') {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function generateRandomPassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

async function main() {
  console.log('\n===============================================================');
  console.log('  NovaCompose Studio — Генератор Ключа Подписи и Защиты от Мод  ');
  console.log('===============================================================\n');

  const keytool = findKeytool();
  if (!keytool) {
    console.error('❌ Ошибка: keytool не найден. Убедитесь, что JDK установлен и JAVA_HOME прописан.');
    console.log('   Инструкция: Установите JDK 17+ или Android Studio.');
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const keystoreName = await ask(rl, 'Имя файла ключа (.keystore/.jks)', 'release.keystore');
  const keystorePath = path.join(rootDir, keystoreName);

  if (fs.existsSync(keystorePath)) {
    console.log(`\n⚠️ Файл ${keystoreName} уже существует в корне проекта!`);
    const overwrite = await ask(rl, 'Перезаписать ключ? [y/N]', 'N');
    if (!overwrite.toLowerCase().startsWith('y')) {
      console.log('Отменено.');
      rl.close();
      process.exit(0);
    }
  }

  const alias = await ask(rl, 'Псевдоним ключа (alias)', 'release');
  const generatedPass = generateRandomPassword();
  const password = await ask(rl, `Пароль для ключа и хранилища (Enter = использовать сгенерированный: ${generatedPass})`, generatedPass);

  const name = await ask(rl, 'Ваше имя / организация (dname CN)', 'NovaCompose Studio');
  const org = await ask(rl, 'Компания / Подразделение (O)', 'Wfllive');
  const city = await ask(rl, 'Город (L)', 'Moscow');
  const country = await ask(rl, 'Код страны 2 буквы (C)', 'RU');

  rl.close();

  console.log('\n🔑 Генерирую 4096-битный RSA ключ со сроком действия 30 лет...');

  const dname = `CN=${name}, O=${org}, L=${city}, C=${country}`;
  const keytoolArgs = [
    '-genkeypair',
    '-v',
    '-keystore', keystorePath,
    '-alias', alias,
    '-keyalg', 'RSA',
    '-keysize', '4096',
    '-validity', '10950',
    '-storepass', password,
    '-keypass', password,
    '-dname', dname
  ];

  const genRes = spawnSync(keytool, keytoolArgs, { encoding: 'utf-8' });
  if (genRes.status !== 0) {
    console.error('❌ Ошибка выполнения keytool:', genRes.stderr || genRes.stdout);
    process.exit(1);
  }

  console.log('✅ Ключ успешно создан:', keystorePath);

  // Extract SHA-256 fingerprint
  console.log('\n🔍 Извлекаю SHA-256 отпечаток цифровой подписи...');
  const listArgs = [
    '-list',
    '-v',
    '-keystore', keystorePath,
    '-alias', alias,
    '-storepass', password
  ];

  const listRes = spawnSync(keytool, listArgs, { encoding: 'utf-8' });
  let sha256 = '';
  if (listRes.stdout) {
    const match = listRes.stdout.match(/SHA256:\s*([A-Fa-f0-9:]+)/);
    if (match) {
      sha256 = match[1].trim().toUpperCase();
    }
  }

  if (sha256) {
    console.log('✅ Отпечаток SHA-256:', sha256);
  } else {
    console.log('⚠️ Не удалось автоматически извлечь SHA-256 отпечаток из keytool output.');
  }

  // Write keystore.properties
  const propsContent = `# Конфигурация подписи и защиты от мод NovaCompose Studio
# ВНИМАНИЕ: Секретный файл! НЕ ДОБАВЛЯТЬ В GIT!
storeFile=${keystoreName}
storePassword=${password}
keyAlias=${alias}
keyPassword=${password}
expectedSha256=${sha256}
`;

  fs.writeFileSync(keystorePropsPath, propsContent, { encoding: 'utf-8', mode: 0o600 });
  console.log('✅ Конфигурация сохранена в:', keystorePropsPath);

  // Update .gitignore
  let gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  const entriesToAdd = ['keystore.properties', '*.keystore', '*.jks'];
  let modified = false;

  for (const entry of entriesToAdd) {
    if (!gitignore.includes(entry)) {
      gitignore += `\n${entry}`;
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(gitignorePath, gitignore.trim() + '\n', 'utf-8');
    console.log('✅ .gitignore обновлён (секреты подписи заблокированы для Git)');
  }

  console.log('\n===============================================================');
  console.log('🎉 Все готово! Ключ релизной подписи и защита от мод настроены.');
  console.log('===============================================================');
  console.log(`\n• Файл ключа:        ${keystoreName}`);
  console.log(`• Псевдоним:         ${alias}`);
  console.log(`• Пароль:            ${password}`);
  console.log(`• Отпечаток SHA-256: ${sha256}`);
  console.log('\n📌 ДЛЯ СБОРКИ РЕЛИЗНОГО APK:');
  console.log('   cd android && ./gradlew assembleRelease');
  console.log('\n📌 ДЛЯ СБОРКИ РЕЛИЗНОГО AAB (Google Play / RuStore):');
  console.log('   cd android && ./gradlew bundleRelease');
  console.log('\n⚠️ ВАЖНО: СОХРАНИТЕ ФАЙЛ КЛЮЧА И ПАРОЛЬ В БЕЗОПАСНОМ МЕСТЕ!');
  console.log('   Без этого ключа обновить опубликованное приложение будет НЕВОЗМОЖНО.\n');
}

main().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});
