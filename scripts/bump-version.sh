#!/bin/bash
set -e
# bump-version.sh — поднять версию и versionCode для RuStore / Google Play
# Использование:
#   bash scripts/bump-version.sh 1.0.1 2
#   bash scripts/bump-version.sh 1.0.1        # авто-инкремент versionCode (+1)
#   bash scripts/bump-version.sh              # показать текущие

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_JSON="$ROOT_DIR/app.json"
PKG_JSON="$ROOT_DIR/package.json"
GRADLE="$ROOT_DIR/android/app/build.gradle"

# текущие
CUR_VER=$(node -p "require('$APP_JSON').expo.version" 2>/dev/null || grep -o '"version": *"[^"]*"' "$APP_JSON" | head -1 | cut -d'"' -f4)
CUR_CODE=$(grep -oP 'versionCode \K\d+' "$GRADLE" | head -1)

if [ -z "$1" ]; then
  echo "Текущая версия: $CUR_VER"
  echo "Текущий versionCode: $CUR_CODE"
  echo ""
  echo "Использование: bash scripts/bump-version.sh <version> [versionCode]"
  echo "Пример: bash scripts/bump-version.sh 1.0.1 2"
  echo "       bash scripts/bump-version.sh 1.0.2    # versionCode станет $((CUR_CODE+1))"
  exit 0
fi

NEW_VER="$1"
if [ -n "$2" ]; then
  NEW_CODE="$2"
else
  NEW_CODE=$((CUR_CODE + 1))
fi

# валидация
if ! echo "$NEW_VER" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "❌ version должен быть в формате x.y.z, например 1.0.1, получил: $NEW_VER"
  exit 1
fi
if ! echo "$NEW_CODE" | grep -qE '^[0-9]+$'; then
  echo "❌ versionCode должен быть числом, получил: $NEW_CODE"
  exit 1
fi
if [ "$NEW_CODE" -le "$CUR_CODE" ]; then
  echo "⚠️  versionCode $NEW_CODE <= текущего $CUR_CODE — RuStore не примет сборку!"
  echo "    Укажи больше чем $CUR_CODE"
  exit 1
fi

echo "→ $CUR_VER ($CUR_CODE)  ⇒  $NEW_VER ($NEW_CODE)"

# 1. app.json — expo.version
node -e "
const fs=require('fs');
const p='$APP_JSON';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.expo.version='$NEW_VER';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
console.log('✓ app.json expo.version = $NEW_VER');
"

# 2. package.json — version (без git tag)
if [ -f "$PKG_JSON" ]; then
  node -e "
  const fs=require('fs');
  const p='$PKG_JSON';
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  j.version='$NEW_VER';
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "
  echo "✓ package.json version = $NEW_VER"
fi

# 3. android/app/build.gradle — versionCode / versionName
sed -i "s/versionCode .*/versionCode $NEW_CODE/" "$GRADLE"
sed -i "s/versionName \".*\"/versionName \"$NEW_VER\"/" "$GRADLE"
echo "✓ android/app/build.gradle versionCode $NEW_CODE / versionName $NEW_VER"

echo ""
echo "Готово:"
grep -E '"version"' "$APP_JSON" | head -1 | sed 's/^/  app.json: /'
grep -E '"version"' "$PKG_JSON" | head -1 | sed 's/^/  package.json: /'
grep -E 'versionCode|versionName' "$GRADLE" | head -2 | sed 's/^/  build.gradle: /'
echo ""
echo "Дальше: git add -A && git commit -m 'chore: bump to $NEW_VER ($NEW_CODE)' && git push"
echo "Сборка RuStore: eas build --platform android --profile production"
