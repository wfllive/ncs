#!/bin/bash
set -e
# 1. Build React (Vite)
npm run build
# 2. Copy build output to Android assets
mkdir -p android/app/src/main/assets
cp -r dist/* android/app/src/main/assets/
echo "Build copied to android/app/src/main/assets/"
# 3. Build Android APK (if gradlew exists)
if [ -f android/gradlew ]; then
    ./android/gradlew :app:assembleDebug
fi
