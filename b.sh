#!/data/data/com.termux/files/usr/bin/bash

# ==============================================================================
# Скрипт сборки React Native APK в Termux (Официальный метод с указанием cmake.dir)
# Скопируйте этот скрипт в корень вашего React Native проекта (рядом с package.json)
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}        Сборка React Native APK в Termux               ${NC}"
echo -e "${BLUE}======================================================${NC}"

# Проверка, что скрипт запущен в корне проекта
if [ ! -f "package.json" ]; then
    echo -e "${RED}✗ Ошибка: Скрипт должен быть запущен в корневой папке React Native проекта (рядом с package.json).${NC}"
    exit 1
fi

# Убедимся, что переменные окружения загружены
if [ -z "$ANDROID_HOME" ]; then
    if [ -f "$HOME/.bashrc" ]; then
        source "$HOME/.bashrc"
    fi
fi

if [ -z "$ANDROID_HOME" ]; then
    echo -e "${RED}✗ Ошибка: ANDROID_HOME не задана! Пожалуйста, запустите 'source ~/.bashrc' или перезапустите Termux.${NC}"
    exit 1
fi

# 1. Автоматическая генерация файлов конфигурации SDK и CMake
echo -e "\n${YELLOW}[1/5] Проверка локальной конфигурации Android...${NC}"
mkdir -p android

# Указываем cmake.dir на нативную системную директорию Termux.
# Это официально заставляет Gradle использовать нативный CMake 4.4.0 и Ninja из Termux,
# предотвращая скачивание несовместимых x86_64 версий!
cat > android/local.properties << EOF
# Сгенерировано скриптом сборки Termux React Native
sdk.dir=$ANDROID_HOME
cmake.dir=/data/data/com.termux/files/usr
EOF
echo -e "${GREEN}✓ Файл android/local.properties обновлен (путь к нативному CMake 4.4.0 прописан!).${NC}"

# Добавление нативных Gradle оптимизаций в проект, если их нет
if [ -f "android/gradle.properties" ]; then
    if ! grep -q "android.aapt2FromMavenOverride" "android/gradle.properties"; then
        echo -e "${BLUE}Добавление обхода AAPT2 в gradle.properties проекта...${NC}"
        cat << 'EOF' >> "android/gradle.properties"

# Termux Optimizations
android.aapt2FromMavenOverride=/data/data/com.termux/files/usr/bin/aapt2
reactNativeArchitectures=arm64-v8a
org.gradle.jvmargs=-Xmx2048m -XX:+UseSerialGC
org.gradle.daemon=false
org.gradle.parallel=false
EOF
    fi
fi

# --- ВАЖНЕЙШИЙ ШАГ: Автоматическое создание С++ заглушек Codegen JNI ---
# Это решает критическую ошибку React Native 0.76+ и 0.82+ при сборке нативного C++:
# "add_subdirectory given source ... codegen/jni which is not an existing directory"
create_codegen_stubs() {
    echo -e "${BLUE}Генерация защитных С++ заглушек для чисто Java-библиотек в node_modules...${NC}"
    find node_modules/ -maxdepth 4 -type d -name "android" 2>/dev/null | while read -r android_dir; do
        jni_dir="$android_dir/build/generated/source/codegen/jni"
        
        # Определяем имя библиотеки по родительской папке
        lib_name=$(basename "$(dirname "$android_dir")")
        
        # Определяем имя цели (target) в зависимости от библиотеки
        target_name=""
        case "$lib_name" in
            "async-storage")
                target_name="react_codegen_rnasyncstorage"
                ;;
            "react-native-gesture-handler")
                target_name="react_codegen_rngesturehandler_codegen"
                ;;
            "react-native-webview")
                target_name="react_codegen_RNCWebViewSpec"
                ;;
        esac
        
        if [ -n "$target_name" ]; then
            mkdir -p "$jni_dir"
            # Создаем пустой dummy.cpp, чтобы CMake мог скомпилировать статическую библиотеку
            echo "// Заглушка для сборки в Termux" > "$jni_dir/dummy.cpp"
            
            # Пишем CMakeLists.txt с объявлением СТАТИЧЕСКОЙ библиотеки
            cat > "$jni_dir/CMakeLists.txt" << EOF
cmake_minimum_required(VERSION 3.10)
project(dummy_codegen)
add_library($target_name STATIC dummy.cpp)
EOF
            # Дополнительно для webview запишем обе возможные цели
            if [ "$lib_name" = "react-native-webview" ]; then
                echo "add_library(react_codegen_rnwebview STATIC dummy.cpp)" >> "$jni_dir/CMakeLists.txt"
            fi
            echo -e "${CYAN}Создана STATIC-заглушка для $lib_name -> $target_name${NC}"
        fi
    done
}

# 2. Подготовка ресурсов и ручная сборка JS-бандла (Секрет стабильности на телефонах)
echo -e "\n${YELLOW}[2/5] Ручная компиляция JS-бандла React Native...${NC}"
mkdir -p android/app/src/main/assets
mkdir -p android/app/src/main/res/drawable-mdpi

echo -e "${BLUE}Запуск сборщика бандла (npx react-native bundle)...${NC}"
npx react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res/ \
  --reset-cache

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ JS-бандл успешно скомпилирован.${NC}"
else
    echo -e "${YELLOW}⚠️ Предупреждение: npx react-native bundle завершился с ошибкой.${NC}"
    echo -e "Если у вас проект Expo, это нормально. Сборка продолжится средствами Gradle/Expo."
fi

# Перед любыми действиями с Gradle создаем заглушки
create_codegen_stubs

# 3. Очистка прошлых сборок (Важно: очистка может удалить заглушки, поэтому мы создадим их повторно после clean)
echo -e "\n${YELLOW}[3/5] Очистка кэша Gradle...${NC}"
cd android
./gradlew clean --no-daemon

# Воссоздаем заглушки после очистки clean!
cd ..
create_codegen_stubs
cd android

# 4. Процесс компиляции APK (Сборка ТОЛЬКО под ARM64 для ускорения)
echo -e "\n${YELLOW}[4/5] Запуск компиляции APK (assembleRelease)...${NC}"
echo -e "${CYAN}Это может занять от 10 до 40 минут в зависимости от мощности процессора.${NC}"
echo -e "${CYAN}Пожалуйста, держите Termux открытым и не выключайте экран устройства.${NC}\n"

./gradlew assembleRelease \
    --no-daemon \
    --max-workers=2 \
    -PreactNativeArchitectures=arm64-v8a

# 5. Проверка результатов сборки
echo -e "\n${YELLOW}[5/5] Проверка результата...${NC}"
APK_PATH="app/build/outputs/apk/release/app-release.apk"

if [ -f "$APK_PATH" ]; then
    APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
    echo -e "${GREEN}======================================================${NC}"
    echo -e "${GREEN}🎉 УСПЕШНО! APK-файл успешно собран!${NC}"
    echo -e "Размер APK: $APK_SIZE"
    echo -e "Путь к файлу: android/$APK_PATH"
    echo -e "======================================================${NC}"
    
    echo -e "${BLUE}Попытка скопировать APK в загрузки телефона...${NC}"
    if [ -d "/sdcard/Download" ]; then
        cp "$APK_PATH" "/sdcard/Download/react-native-release.apk"
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ APK успешно скопирован!${NC}"
            echo -e "Вы можете установить его из папки '${CYAN}Загрузки (Downloads)${NC}'."
            echo -e "Имя файла: ${CYAN}react-native-release.apk${NC}"
        else
            echo -e "${YELLOW}⚠️ Не удалось скопировать. Предоставьте доступ к памяти: run 'termux-setup-storage'${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️ Директория /sdcard/Download не найдена. Скопируйте APK вручную.${NC}"
    fi
else
    echo -e "${RED}======================================================${NC}"
    echo -e "${RED}✗ СБОРКА ЗАВЕРШИЛАСЬ ОШИБКОЙ!${NC}"
    echo -e "======================================================${NC}"
fi
cd ..
