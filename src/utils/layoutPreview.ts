/**
 * layoutPreview.ts — горячий предпросмотр Android XML-макетов в IDE.
 *
 * Реализация «предпросмотра без мыслей» :) — работает без эмулятора и без
 * сервера: макет разбирается и рендерится встроенным движком
 * (см. layoutPreviewCore.js) в WebView. При каждом сохранении файла превью
 * перерисовывается за миллисекунды — это и есть hot reload макетов.
 *
 * Схема:
 *   сохранение .xml → перерисовка превью (мгновенно, из кода);
 *   кнопка «Собрать и установить» → кастомный build.sh → APK на устройстве.
 */
import { execute } from './shellExecutor';
import { getProjectDir } from '../config/runtime';
// @ts-ignore — чистый JS-модуль (общий код для RN и тестов на Node)
import * as core from './layoutPreviewCore';

export const parseXml = core.parseXml;
export const buildResources = core.buildResources;
export const renderPreviewDocument = core.renderPreviewDocument;
export const renderNode = core.renderNode;
export const resolveValue = core.resolveValue;
export const XmlParseError = core.XmlParseError;

export type PreviewTheme = {
  primary?: string;
  isDark?: boolean;
};

/** Простой кэш ресурсов проекта между перерисовками. */
const resCache = new Map<string, { at: number; res: any }>();
const RES_TTL_MS = 5000;

/**
 * Прочитать все файлы проекта (относительные пути) одним вызовом shell.
 * Возвращает карту путь → содержимое (отсутствующие файлы пропускаются).
 */
export const readProjectFiles = async (project: any, paths: string[]) => {
  if (!project || !paths?.length) return {};
  const dir = getProjectDir(project);
  const probe = paths
    .map((p) => `echo "@@F:${p.replace(/'/g, '')}@@"; cat '${p.replace(/'/g, "'\\''")}' 2>/dev/null || true`)
    .join('; ');
  try {
    const r = await execute(probe, dir);
    const out = String(r?.output || '');
    const files: Record<string, string> = {};
    const parts = out.split(/@@F:([^@]+)@@/);
    // split: [pre, name1, body1, name2, body2, ...]
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const name = parts[i].trim();
      const body = parts[i + 1];
      if (name && body != null && body !== '') files[name] = body.replace(/\n$/, '\n');
    }
    return files;
  } catch (e) {
    return {};
  }
};

/**
 * Загрузить ресурсы проекта (res/values/*.xml) с кэшем на 5 секунд —
 * чтобы при частом горячем обновлении не гонять shell на каждый чих.
 */
export const loadProjectResources = async (project: any, force = false) => {
  if (!project) return buildResources({});
  const key = project.id || project.slug || 'project';
  const hit = resCache.get(key);
  if (!force && hit && Date.now() - hit.at < RES_TTL_MS) return hit.res;
  const files = await readProjectFiles(project, [
    'res/values/strings.xml',
    'res/values/colors.xml',
    'res/values/dimens.xml',
    'res/values/themes.xml',
  ]);
  const res = buildResources(files);
  resCache.set(key, { at: Date.now(), res });
  return res;
};

export const invalidatePreviewCache = (project: any) => {
  const key = project?.id || project?.slug || 'project';
  resCache.delete(key);
};

/** Путь к макету экрана внутри проекта. */
export const layoutPathForScreen = (screen: any, index = 0) => {
  const safe = String(screen?.name || 'Main').replace(/[^A-Za-z0-9_]/g, '').toLowerCase() || 'main';
  return index === 0 ? 'app/res/layout/activity_main.xml' : `app/res/layout/activity_${safe}.xml`;
};

/**
 * Отрендерить превью макета экрана.
 * @param layoutXml — текущее содержимое файла макета (даже несохранённое —
 *                    тогда превью показывает ровно то, что в редакторе).
 */
export const renderScreenPreviewHtml = async (
  project: any,
  layoutXml: string,
  options: { fileName?: string; title?: string; widthDp?: number; heightDp?: number } = {},
) => {
  const resources = await loadProjectResources(project);
  const theme: PreviewTheme = {
    primary: /^#[0-9A-Fa-f]{6}$/.test(project?.theme?.primaryColor || '') ? project.theme.primaryColor : '#6750A4',
    isDark: Boolean(project?.theme?.isDark),
  };
  return renderPreviewDocument(layoutXml, resources, {
    title: options.title || project?.name || 'Превью',
    primary: theme.primary,
    isDark: theme.isDark,
    fileName: options.fileName,
    widthDp: options.widthDp,
    heightDp: options.heightDp,
  });
};

/**
 * Быстрая проверка макета без рендера: вернуть список ошибок (пусто = ок).
 * Используется для «живых» пометок в редакторе при наборе.
 */
export const validateLayout = (layoutXml: string) => {
  try {
    const node = parseXml(layoutXml);
    if (!node) return [{ message: 'Макет пуст', line: 1 }];
    return [];
  } catch (e: any) {
    return [{ message: e?.message || String(e), line: e?.line || 1 }];
  }
};

export default {
  parseXml,
  buildResources,
  renderPreviewDocument,
  renderScreenPreviewHtml,
  loadProjectResources,
  readProjectFiles,
  invalidatePreviewCache,
  validateLayout,
  layoutPathForScreen,
};
