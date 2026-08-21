/**
 * composeProject.ts — СЛОЙ СОВМЕСТИМОСТИ.
 *
 * Исторически здесь жили шаблоны проектов (сначала Kotlin/Compose, потом
 * React+Vite). Теперь проекты — **Java + XML** с кастомной сборкой без
 * Gradle; вся настоящая логика переехала в `javaProject.ts`.
 *
 * Старые имена сохранены, чтобы экраны менялись постепенно и ничего не
 * падало при сборке приложения.
 */
import {
  createJavaProjectFiles,
  writeJavaProject,
  syncJavaProject,
  ensureJavaProjectIntegrity,
  refreshJavaScaffold,
  generateLayoutXml,
  layoutFileName,
} from './javaProject';

/** Файлы шаблона проекта (манифест, ресурсы, сборщик, исходники экранов). */
export const createComposeProjectFiles = (project: any) => createJavaProjectFiles(project);

/** Полная запись проекта на диск. */
export const writeComposeProject = async (project: any) => writeJavaProject(project);

/** Синхронизация исходников экранов на диск перед сборкой. */
export const syncComposeProject = async (project: any) => syncJavaProject(project);

/** Самолечение: восстановить отсутствующие файлы шаблона. */
export const ensureProjectIntegrity = async (project: any) => ensureJavaProjectIntegrity(project);

/** Обновить служебные файлы (сейчас — только build.sh). */
export const refreshAndroidScaffold = async (project: any) => refreshJavaScaffold(project);

/**
 * Экран в редакторе представлен своим XML-макетом: возвращаем его сохранённую
 * версию либо генерируем из визуального дерева.
 */
export const generateScreenJSX = (screen: any, project: any = null) =>
  generateLayoutXml(project || {}, screen, screen?.__index || 0);

/** Путь к файлу экрана внутри проекта (макет). */
export const getScreenFilePath = (project: any, screen: any, index = 0) =>
  `app/res/layout/${layoutFileName(screen, index)}`;

/**
 * Сохранить код активного экрана. В модели Java + XML «код экрана» — это его
 * XML-макет; Java-активность редактируется через проводник файлов.
 */
export const writeScreenSource = async (project: any, screen: any, source: string) => {
  if (!project || !screen) return { success: false, output: 'No screen' };
  const { writeWorkspaceFile } = await import('./workspace');
  const index = Math.max(0, (project.screens || []).findIndex((s: any) => s.id === screen.id));
  const fileName = `app/res/layout/${layoutFileName(screen, index)}`;
  const r = await writeWorkspaceFile(project, fileName, source);
  if (!r?.success) return { success: false, output: `Failed to write ${fileName}: ${r?.output}` };
  await writeWorkspaceFile(project, '.rnstudio/model.json', `${JSON.stringify({
    ...project,
    screens: (project.screens || []).map((s: any) => (s.id === screen.id ? { ...s, layoutXml: source } : s)),
  }, null, 2)}\n`);
  return { success: true, output: fileName };
};

// Совместимость со старыми вызовами
export const buildScreenSource = () => null;
export const generateComposeScreen = (project: any, screen: any) => generateLayoutXml(project || {}, screen, 0);
export const generateComposePreviewSource = (project: any, screen: any) => generateLayoutXml(project || {}, screen, 0);
export const getComposeScreenClass = () => 'Activity';
export const getComposeRoute = () => 'main';
export const getBaseDependencies = () => [];
export const runBuildCommand = () => 'bash build.sh debug';
