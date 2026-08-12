const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, '_bdg_upload');
const ZIP_PATH = path.join(OUT_DIR, 'project.zip');
const TARGET_PATH = path.join(OUT_DIR, 'build-target.txt');

const allowed = ['debug', 'release', 'aab'];

// Папки и файлы которые НЕ попадут в ZIP
const IGNORE = [
  'node_modules',
  '.git',
  '.expo',
  '.gradle',
  '.turbo',
  '.next',
  'dist',
  'build',
  '_bdg_upload',
  'ios',
];

// ─── ZIP writer (чистый Node.js, без зависимостей) ───────────────────────────

function u16LE(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

function u32LE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function dosDateTime(date) {
  const d = date || new Date();
  const dosDate =
    ((d.getFullYear() - 1980) << 9) |
    ((d.getMonth() + 1) << 5) |
    d.getDate();
  const dosTime =
    (d.getHours() << 11) |
    (d.getMinutes() << 5) |
    Math.floor(d.getSeconds() / 2);
  return { date: dosDate, time: dosTime };
}

function crc32(buf) {
  const table = crc32.table || (crc32.table = buildCrcTable());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    t[i] = c;
  }
  return t;
}

function makeLocalHeader(nameBuf, crc, compSize, uncompSize, dt) {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // signature
    u16LE(20),           // version needed
    u16LE(0),            // flags
    u16LE(8),            // compression: deflate
    u16LE(dt.time),
    u16LE(dt.date),
    u32LE(crc),
    u32LE(compSize),
    u32LE(uncompSize),
    u16LE(nameBuf.length),
    u16LE(0),            // extra length
    nameBuf,
  ]);
}

function makeCentralDir(nameBuf, crc, compSize, uncompSize, offset, dt) {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x01, 0x02]), // signature
    u16LE(20),           // version made by
    u16LE(20),           // version needed
    u16LE(0),            // flags
    u16LE(8),            // compression: deflate
    u16LE(dt.time),
    u16LE(dt.date),
    u32LE(crc),
    u32LE(compSize),
    u32LE(uncompSize),
    u16LE(nameBuf.length),
    u16LE(0),            // extra
    u16LE(0),            // comment
    u16LE(0),            // disk start
    u16LE(0),            // internal attr
    u32LE(0),            // external attr
    u32LE(offset),
    nameBuf,
  ]);
}

function makeEndRecord(count, centralSize, centralOffset) {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16LE(0), u16LE(0),
    u16LE(count),
    u16LE(count),
    u32LE(centralSize),
    u32LE(centralOffset),
    u16LE(0),
  ]);
}

function shouldIgnore(relPath) {
  const parts = relPath.split('/');
  return IGNORE.some(ig => parts[0] === ig);
}

function collectFiles(dir, base) {
  const results = [];
  let entries;

  try {
    entries = fs.readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relPath = base ? `${base}/${entry}` : entry;

    if (shouldIgnore(relPath)) continue;

    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...collectFiles(fullPath, relPath));
    } else if (stat.isFile()) {
      results.push({ fullPath, relPath });
    }
  }

  return results;
}

async function createZip(target) {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });

  if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);
  if (fs.existsSync(TARGET_PATH)) fs.unlinkSync(TARGET_PATH);

  const files = collectFiles(ROOT, '');
  const centralDirs = [];
  let offset = 0;

  const out = fs.createWriteStream(ZIP_PATH);

  const write = (buf) => new Promise((res, rej) => {
    out.write(buf, err => err ? rej(err) : res());
  });

  const dt = dosDateTime(new Date());

  let done = 0;

  for (const { fullPath, relPath } of files) {
    let raw;
    try {
      raw = fs.readFileSync(fullPath);
    } catch {
      continue;
    }

    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const nameBuf = Buffer.from(relPath, 'utf8');

    const localHeader = makeLocalHeader(nameBuf, crc, compressed.length, raw.length, dt);

    centralDirs.push(
      makeCentralDir(nameBuf, crc, compressed.length, raw.length, offset, dt)
    );

    offset += localHeader.length + compressed.length;

    await write(localHeader);
    await write(compressed);

    done++;
    if (done % 50 === 0) {
      process.stdout.write(`\r  Упаковано файлов: ${done}/${files.length}`);
    }
  }

  process.stdout.write(`\r  Упаковано файлов: ${done}/${files.length}\n`);

  const centralBuf = Buffer.concat(centralDirs);
  await write(centralBuf);
  await write(makeEndRecord(centralDirs.length, centralBuf.length, offset));

  await new Promise((res, rej) => out.end(err => err ? rej(err) : res()));

  fs.writeFileSync(TARGET_PATH, `${target}\n`, 'utf8');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function pickTarget() {
  const arg = (process.argv[2] || '').trim().toLowerCase();
  if (allowed.includes(arg)) return arg;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nЧто собрать?');
  console.log('  1) debug   -> APK Debug');
  console.log('  2) release -> APK Release');
  console.log('  3) aab     -> AAB Release\n');

  const answer = await new Promise(res => {
    rl.question('Введите 1, 2, 3 или debug/release/aab: ', ans => {
      rl.close();
      res(ans.trim().toLowerCase());
    });
  });

  if (answer === '1') return 'debug';
  if (answer === '2') return 'release';
  if (answer === '3') return 'aab';
  if (allowed.includes(answer)) return answer;

  throw new Error(`Неверная цель: "${answer}"`);
}

async function main() {
  const target = await pickTarget();

  console.log(`\nTarget  : ${target}`);
  console.log(`Проект  : ${ROOT}`);
  console.log(`Вывод   : ${OUT_DIR}\n`);
  console.log('Создаю ZIP...');

  await createZip(target);

  const zipSize = fs.statSync(ZIP_PATH).size;
  const zipMb = (zipSize / 1024 / 1024).toFixed(2);

  console.log(`\n✅ Готово! Размер ZIP: ${zipMb} MB`);
  console.log('\nФайлы для загрузки:');
  console.log(`  _bdg_upload/project.zip`);
  console.log(`  _bdg_upload/build-target.txt  -> "${target}"`);
  console.log('\nДальше:');
  console.log('  1. Откройте builder repo на GitHub');
  console.log('  2. Add file -> Upload files');
  console.log('  3. Загрузите оба файла из папки _bdg_upload');
  console.log('  4. Commit changes');
  console.log('  5. Actions -> скачайте artifact после сборки');
}

main().catch(err => {
  console.error('\n❌ Ошибка:', err.message);
  process.exit(1);
});