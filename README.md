# NovaCompose Studio — конструктор Android-приложений

Compose Studio создаёт **нативные Android-проекты** на Kotlin, Material 3 и Jetpack Compose. Сам конструктор запускается как Android development build и использует Ubuntu arm64 для Gradle-сборки.

> 📖 **Новичок?** Читайте [`docs/ИНСТРУКЦИЯ.md`](docs/ИНСТРУКЦИЯ.md) — пошагово: сборка APK конструктора, первый запуск (Ubuntu → RAI → проекты), создание и сборка первого приложения.

## Возможности

- создание полноценного Gradle Kotlin DSL проекта;
- **код является источником истины**: вы пишете Kotlin-код экрана напрямую в коде-редакторе, и он сохраняется на диск как есть — ничего не перегенерируется и не искажается;
- **профессиональная IDE в стиле VS Code** на движке CodeMirror 6 (офлайн, встроен в приложение): точные темы VS Code Dark+/Light+, подсветка синтаксиса Kotlin, номера строк, подсветка активной строки, сворачивание кода, автозакрытие и подсветка парных скобок;
- **вкладки открытых файлов**, хлебные крошки пути, «грязные» точки несохранённых изменений и синяя строка состояния VS Code (Ln/Col, Spaces, UTF-8, Kotlin) с живым счётчиком проблем;
- **автодополнение**: ключевые слова Kotlin, сниппеты Compose (`Column`, `Scaffold`, `remember`…), слова из документа; поиск/замена по файлу; переход к строке; undo/redo; комментирование строк; панель символов над клавиатурой;
- **проводник файлов проекта** слева (как в VS Code): дерево файлов, открытие и редактирование любого файла проекта — экранов, темы, Gradle, манифеста, строк;
- вкладка **«Редактор»** — код-редактор, вкладка **«Дизайн»** — предпросмотр активного экрана;
- настройка редактора «на лету»: размер шрифта, табуляция и «пробелы вместо табуляции», перенос длинных строк, автосохранение, автодополнение, панель символов, строка состояния;
- управление импортами: редактор находит недостающие `import` и предлагает добавить их одной кнопкой;
- **двухуровневая проверка кода**: мгновенный Compose-aware анализатор (109 проверок в тестовом наборе): баланс скобок и строк с точными позициями; битые объявления; несоответствие типов литералов (`val x: Int = "текст"`, `val f: Float = 1.5`, битые char-литералы); переприсваивание `val` с учётом областей видимости, параметров функций/лямбд и переменных циклов; конфликтующие объявления; путаница **dp/sp** (`fontSize = 16.dp`, `Modifier.size(16.sp)`); присваивание в условии `if (x = true)`; `@Composable` не на функции; вызов composable вне `@Composable`-контекста — включая composable-код внутри `LaunchedEffect`/`onClick` (эффективные и callback-лямбды закрывают composable-контекст, контентные слоты — нет); `remember` внутри условий/циклов; `mutableStateOf` без `remember` (lint UnrememberedMutableState); именование composable-функций (lint FunctionNaming); параметр `modifier` у UI-компонентов (lint ModifierMissing/ModifierParameter); несуществующие именованные параметры у компонентов Material 3; `CompositionLocal` без `.current`; `Toast` без `.show()`; забытые импорты; устаревшие API; опечатки с подсказками «did you mean»; `!!`; импорты Material 2 — подчёркивает ошибки красным, предупреждения жёлтым прямо при наборе;
- **проверка настоящим компилятором**: кнопка «Проверить» запускает `gradlew compileDebugKotlin` в рабочей области proot, разбирает ошибки/предупреждения K2, показывает их как squiggles и в панели «Проблемы» с группировкой по файлам — нажатие открывает файл и ведёт к строке; при включённой автопроверке компилятор также запускается сам после сохранения и в фоне во время редактирования (не чаще раза в 45 с);
- вкладка **«Дизайн»** — живой предпросмотр экрана, отрисовываемый из кода;
- несколько экранов через Navigation Compose;
- Maven/Gradle библиотеки: подключение, разрешение и удаление;
- `assembleDebug`, `assembleRelease`, `bundleRelease`, unit tests и Android Lint;
- установка Debug APK и запуск собранного приложения;
- светлая/тёмная тема интерфейса, русский и английский язык.

## Первый запуск: Ubuntu → RAI → проекты

1. **Установка Ubuntu** — страница «Подготовка рабочей среды» скачивает и
   распаковывает arm64 rootfs (можно свернуть — фоновая служба держит процесс).
2. **Установка RAI** — следующая страница выполняет скрипт установки из README
   RAI: `apt update && apt upgrade`, утилиты, Node.js 24, `rai install base`,
   `rai install sdk`, `rai status`. **RAI вендорен в этот репозиторий** — папка
   `rai/` с исходниками и бандлом `rai.sh` лежит в проекте и зашита в APK
   (assets модуля `apt-manager` → `/root/rai/rai.sh` в rootfs), поэтому GitHub
   не нужен. Каждый шаг идемпотентен — при обрыве установка продолжается с
   того же шага.
3. После успешного `rai status` открывается **список проектов** (главный экран).

Установка и сборка работают в фоне: foreground service + wakelock
(`BackgroundWorkService`), уведомление «Compose Studio — …». Для доступа к
`/sdcard/Download` приложение запрашивает разрешение «Память» (All files access
на Android 11+, runtime-диалог на более старых). Подробности — в
[`docs/RAI_SETUP.md`](docs/RAI_SETUP.md).

## Сгенерированный проект

```text
/root/compose-projects/my-app/
├── settings.gradle.kts
├── build.gradle.kts
├── gradlew
├── gradle.properties
└── app/
    ├── build.gradle.kts
    └── src/main/
        ├── AndroidManifest.xml
        └── java/com/example/app/
            ├── MainActivity.kt
            └── ui/
                ├── screens/*Screen.kt
                └── theme/Theme.kt
```

## Сборка проекта

```bash
./gradlew assembleDebug
./gradlew assembleRelease
./gradlew bundleRelease
./gradlew testDebugUnitTest
./gradlew lintDebug
```

Debug APK создаётся в `app/build/outputs/apk/debug/app-debug.apk`.

## Технологии сгенерированных приложений

- Android Gradle Plugin 9.2
- Gradle 9.4.1
- Kotlin / Compose Compiler 2.3.21
- Jetpack Compose BOM 2026.06.00
- Material 3
- Navigation Compose 2.9.8
- compileSdk 37 / targetSdk 36
- JDK 17+

> `@Preview` рендерится Android Studio через Layoutlib. Внутри конструктора макет рендерится **нативно** — реальным Jetpack Compose (Material 3 `Scaffold`, `TopAppBar`, `Card`, `Button`, `TextField`, …) через модуль `apt-manager` (`renderComposePreview`): off-screen `ComposeView` рисует дерево и отдаёт PNG. Это мгновенный preview без эмулятора и без Gradle. Для финальной валидации и проверки `@Preview` соберите Debug APK и установите его.

### Предпросмотр из `.kt` (code-first)

Предпросмотр строится **строго из текущего содержимого файла `.kt`** — он единственный источник истины:

- во вкладке «Дизайн» отрисовывается ровно то, что сейчас в редакторе (даже если код неполный), без лага на «старое» дерево компонентов;
- раскраска повторяет объявленную тему: `Theme.kt` вызывает `lightColorScheme(primary=…, secondary=…, background=…)` — рендер воспроизводит ту же семантику и **не** переопределяет остальные роли палитры, поэтому preview совпадает с реальным приложением;
- кнопки по умолчанию — «таблетка» (M3 `CornerFull`), карточки — `RoundedCornerShape(12.dp)`, `TopAppBar` — цвета M3 по умолчанию (`surface`), как у `TopAppBar(title = { Text(...) })` в коде;
- `Modifier.weight(...)`, `size`, `fillMaxWidth(fraction)`, `padding(horizontal=, vertical=, start=, end=, …)`, `aspectRatio`, `offset`, `widthIn`/`heightIn`, `border`, `clip`, `lineHeight`, `letterSpacing`, `maxLines`, `MaterialTheme.typography.*` учитываются при отрисовке;
- дополнительно распознаются `FilledTonalButton`, `ElevatedButton`, `TextButton`, `FloatingActionButton`, `OutlinedCard`, `TextField`, `IconButton`, `Badge`, `LazyRow`;
- заголовок-`TopAppBar` синтезируется только если в коде есть `Scaffold`/`TopAppBar` — для простого `Column { … }` экрана приложение и preview показывают его без верхней панели, как в реальном APK;
- **заголовок topbar берётся из кода**: парсер читает фактический `TopAppBar(title = { Text("Мой экран") })` и показывает его название в preview (а не имя экрана/файла);
- **переключатель темы**: в панели preview есть кнопки **Auto / Light / Dark** — можно мгновенно посмотреть экран в светлой и тёмной теме независимо от темы самого IDE (Chrome устройства — рамка, статус-бар, навигация — тоже подстраивается под тему);
- под устройством выводится строка-статус: размер в dp, текущая тема и масштаб;
- **кнопки и текстовые лейблы**: `Text`/`Icon` внутри `Button`, `OutlinedButton`, `FilledTonalButton`, `ElevatedButton`, `TextButton`, `Card`, `TopAppBar` и т.д. наследуют правильный цвет контента (`LocalContentColor` — `onPrimary`/`onSurface`), а не всегда `onSurface`; у кнопок учитывается `enabled` (disabled-вид) и минимальная высота M3 (40dp), иконка+подпись рендерятся целиком;
- **дополнительные компоненты Material 3**: `Slider`, `RadioButton`, `AssistChip`, `FilterChip`, `SuggestionChip`, `InputChip`, `NavigationBar`/`NavigationBarItem`, `BottomAppBar`, `PrimaryTabRow`/`SecondaryTabRow`/`TabRow`/`Tab`, `AlertDialog`, `DropdownMenu`/`DropdownMenuItem`, `VerticalDivider`, `Surface`, `BasicTextField`, `SelectableText`, `ExtendedFloatingActionButton`, `RangeSlider`, `Snackbar`, `FlowRow`/`FlowColumn`, `SingleChoiceSegmentedButtonRow`/`SegmentedButton` — все они разбираются из `.kt`, рендерятся нативно и без потерь пере-генерируются при правках дизайна;
- **оверлеи и «экзотика»**: `ModalNavigationDrawer`/`DismissibleNavigationDrawer`/`PermanentNavigationDrawer` + `ModalDrawerSheet` + `NavigationDrawerItem`, `ModalBottomSheet`/`BottomSheet`, `DatePicker`/`DateRangePicker`/`DatePickerDialog`, `SearchBar` — рендерятся статичными, но узнаваемыми M3-приближениями (раскрытый drawer/bottom-sheet, сетка-календарь, поле поиска), чтобы preview не зависел от экспериментального API конкретной версии material3 и гарантированно собирался;
- **иконки**: `iconForName` покрывает ~50 частых Material-иконок (account, email, phone, calendar, notifications, share, send, download, play, location, lock, logout, cart, face, wifi, cloud, refresh, …) через `material-icons-extended`;
- **собственная тема из кода**: если `.kt` объявляет полную палитру `lightColorScheme(...)`/`darkColorScheme(...)` (как `LightColors`/`DarkColors`), preview читает эти роли из файла и воспроизводит их точно — цвета совпадают с APK. Если своей темы нет — используется базовая палитра M3, как у сгенерированного `AppTheme`;
- **пользовательские helper-функции**: вызовы ваших `@Composable`-функций (`HeroCard()`, `CounterButtons(...)`, `Tag(...)`, `InfoRow(...)`, …) встраиваются в preview (с подстановкой литеральных аргументов), поэтому карточки и экраны из вспомогательных функций рендерятся, а не показываются как заглушки `[HeroCard]`;
- `CenterAlignedTopAppBar` распознаётся как `TopAppBar`, `containerColor` у `Scaffold`/`TopAppBar`/карточек учитывается.

## Запуск самого конструктора

```bash
npm install
npx expo run:android
```

Expo используется только как оболочка **самого конструктора**. Создаваемые пользователем проекты являются обычными нативными Android/Jetpack Compose проектами и не содержат React Native или Expo.
