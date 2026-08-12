const {
  withAppBuildGradle,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin to inject Anti-Mod Security Guard & Release Signing into android/
 * during `npx expo prebuild` or `eas build`.
 */
function withSecurityGuard(config) {
  // 1. Copy native Kotlin security sources to android/app/src/main/java/ru/wfllive/nova/security/
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, 'src', 'native', 'security');
      const destDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        'ru',
        'wfllive',
        'nova',
        'security'
      );

      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        const files = fs.readdirSync(srcDir);
        for (const file of files) {
          fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }
      }

      // 2. Ensure proguard-rules.pro contains Security rules
      const proguardPath = path.join(projectRoot, 'android', 'app', 'proguard-rules.pro');
      if (fs.existsSync(proguardPath)) {
        let proguard = fs.readFileSync(proguardPath, 'utf-8');
        if (!proguard.includes('ru.wfllive.nova.security')) {
          proguard += `\n# Anti-Mod Security Guard Rules\n-keep class ru.wfllive.nova.security.** { *; }\n-keepclassmembers class ru.wfllive.nova.security.** { *; }\n`;
          fs.writeFileSync(proguardPath, proguard, 'utf-8');
        }
      }

      return config;
    },
  ]);

  // 3. Register SecurityPackage in MainApplication.kt
  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes('ru.wfllive.nova.security.SecurityPackage')) {
      if (contents.includes('PackageList(this).packages.apply {')) {
        contents = contents.replace(
          'PackageList(this).packages.apply {',
          'PackageList(this).packages.apply {\n          add(ru.wfllive.nova.security.SecurityPackage())'
        );
      }
      config.modResults.contents = contents;
    }

    return config;
  });

  // 4. Inject signingConfigs.release and EXPECTED_SIGNATURE_SHA256 into android/app/build.gradle
  config = withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes('EXPECTED_SIGNATURE_SHA256')) {
      const keystoreBlock = `
    // Load release signing configuration from keystore.properties if present
    def findKeystoreFile = { String name ->
        if (!name) return new File(projectRoot, "ncs")
        def f1 = new File(projectRoot, name)
        if (f1.exists()) return f1
        def f2 = rootProject.file(name)
        if (f2.exists()) return f2
        def f3 = file(name)
        if (f3.exists()) return f3
        return f1
    }

    def keystorePropsFile = findKeystoreFile("keystore.properties")
    def keystoreProps = new Properties()
    if (keystorePropsFile.exists()) {
        keystoreProps.load(new FileInputStream(keystorePropsFile))
    }
    def expectedSha256 = keystoreProps.getProperty('expectedSha256', System.getenv("EXPECTED_SIGNATURE_SHA256") ?: "")
`;
      if (contents.includes("namespace 'ru.wfllive.nova'")) {
        contents = contents.replace(
          "namespace 'ru.wfllive.nova'",
          "namespace 'ru.wfllive.nova'\n" + keystoreBlock
        );
      }

      if (contents.includes('versionName "1.0.0"')) {
        contents = contents.replace(
          'versionName "1.0.0"',
          'versionName "1.0.0"\n        buildConfigField "String", "EXPECTED_SIGNATURE_SHA256", "\\"${expectedSha256}\\""'
        );
      }

      const releaseSigningCode = `
        release {
            if (keystorePropsFile.exists()) {
                def sfPath = keystoreProps['storeFile'] ?: "ncs"
                storeFile findKeystoreFile(sfPath)
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
                enableV1Signing true
                enableV2Signing true
                enableV3Signing true
            } else if (System.getenv("KEYSTORE_FILE") != null) {
                storeFile file(System.getenv("KEYSTORE_FILE"))
                storePassword System.getenv("KEYSTORE_PASSWORD")
                keyAlias System.getenv("KEY_ALIAS")
                keyPassword System.getenv("KEY_PASSWORD")
                enableV1Signing true
                enableV2Signing true
                enableV3Signing true
            } else if (findProperty('MYAPP_RELEASE_STORE_FILE') != null) {
                storeFile file(findProperty('MYAPP_RELEASE_STORE_FILE'))
                storePassword findProperty('MYAPP_RELEASE_STORE_PASSWORD')
                keyAlias findProperty('MYAPP_RELEASE_KEY_ALIAS')
                keyPassword findProperty('MYAPP_RELEASE_KEY_PASSWORD')
                enableV1Signing true
                enableV2Signing true
                enableV3Signing true
            }
        }
`;
      if (contents.includes('signingConfigs {')) {
        contents = contents.replace('signingConfigs {', 'signingConfigs {' + releaseSigningCode);
      }

      const releaseSigningRegex = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
      if (releaseSigningRegex.test(contents)) {
        const replacement = `$1def hasReleaseKey = keystorePropsFile.exists() || System.getenv("KEYSTORE_FILE") != null || findProperty("MYAPP_RELEASE_STORE_FILE") != null\n            if (!hasReleaseKey) {\n                throw new GradleException("ОШИБКА ПОДПИСИ РЕЛИЗА: Не найден файл keystore.properties или ключ подписи! Перед сборкой релиза запустите 'npm run generate-key' в корне проекта.")\n            }\n            signingConfig signingConfigs.release`;
        contents = contents.replace(releaseSigningRegex, replacement);
      }

      config.modResults.contents = contents;
    }

    return config;
  });

  return config;
}

module.exports = withSecurityGuard;