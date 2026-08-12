/* One-off source migration from React Native StyleSheet objects to NativeWind class names. */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const files = cp.execSync("rg -l 'StyleSheet\\.create' src --glob '*.{ts,tsx}'", { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const unsupported = new Set();
const kebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const number = (node) => node.type === 'NumericLiteral' ? node.value : node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral' ? -node.argument.value : null;
const literal = (node) => node.type === 'StringLiteral' ? node.value : node.type === 'BooleanLiteral' ? node.value : number(node);
const arbitrary = (prefix, value) => `${prefix}-[${typeof value === 'number' ? `${value}px` : value}]`;
const size = (prefix, value) => {
  if (value === 0) return `${prefix}-0`;
  if (value === '100%') return `${prefix}-full`;
  if (value === '50%') return `${prefix}-1/2`;
  return arbitrary(prefix, value);
};
const spacing = (prefix, value) => value === 0 ? `${prefix}-0` : arbitrary(prefix, value);
const color = (prefix, node) => {
  if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'c') {
    return `${prefix}-${kebab(node.property.name)}`;
  }
  const value = literal(node);
  if (value === 'transparent') return `${prefix}-transparent`;
  if (typeof value === 'string') {
    if (value.toUpperCase() === '#FFFFFF') return `${prefix}-white`;
    if (value.toUpperCase() === '#000000') return `${prefix}-black`;
    return `${prefix}-[${value}]`;
  }
  return null;
};

function tokenFor(prop, node) {
  const value = literal(node);
  if (node.type === 'ConditionalExpression') {
    const yes = tokenFor(prop, node.consequent);
    const no = tokenFor(prop, node.alternate);
    if (yes && no) return t.conditionalExpression(node.test, t.stringLiteral(yes), t.stringLiteral(no));
  }
  const direct = {
    flexDirection: { row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' },
    alignItems: { center: 'items-center', 'flex-start': 'items-start', 'flex-end': 'items-end', stretch: 'items-stretch', baseline: 'items-baseline' },
    alignSelf: { center: 'self-center', 'flex-start': 'self-start', 'flex-end': 'self-end', stretch: 'self-stretch', auto: 'self-auto' },
    justifyContent: { center: 'justify-center', 'flex-start': 'justify-start', 'flex-end': 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly' },
    flexWrap: { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
    position: { absolute: 'absolute', relative: 'relative' },
    overflow: { hidden: 'overflow-hidden', visible: 'overflow-visible', scroll: 'overflow-scroll' },
    textAlign: { center: 'text-center', left: 'text-left', right: 'text-right', justify: 'text-justify', auto: 'text-auto' },
    textTransform: { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
    textDecorationLine: { underline: 'underline', 'line-through': 'line-through', none: 'no-underline' },
    fontStyle: { italic: 'italic', normal: 'not-italic' },
  };
  if (direct[prop] && direct[prop][value]) return direct[prop][value];
  if (prop === 'flex') return value === 1 ? 'flex-1' : value === 0 ? 'flex-none' : `flex-[${value}]`;
  if (prop === 'flexGrow') return value === 1 ? 'grow' : `grow-[${value}]`;
  if (prop === 'flexShrink') return value === 0 ? 'shrink-0' : value === 1 ? 'shrink' : `shrink-[${value}]`;
  if (prop === 'display') return value === 'none' ? 'hidden' : 'flex';
  if (prop === 'width') return size('w', value);
  if (prop === 'height') return size('h', value);
  if (prop === 'minWidth') return size('min-w', value);
  if (prop === 'maxWidth') return size('max-w', value);
  if (prop === 'minHeight') return size('min-h', value);
  if (prop === 'maxHeight') return size('max-h', value);
  const space = { padding: 'p', paddingHorizontal: 'px', paddingVertical: 'py', paddingTop: 'pt', paddingRight: 'pr', paddingBottom: 'pb', paddingLeft: 'pl', margin: 'm', marginHorizontal: 'mx', marginVertical: 'my', marginTop: 'mt', marginRight: 'mr', marginBottom: 'mb', marginLeft: 'ml', gap: 'gap', rowGap: 'gap-y', columnGap: 'gap-x', top: 'top', right: 'right', bottom: 'bottom', left: 'left' };
  if (space[prop]) return spacing(space[prop], value);
  if (prop === 'backgroundColor') return color('bg', node);
  if (prop === 'color') return color('text', node);
  if (prop === 'borderColor') return color('border', node);
  if (prop === 'borderTopColor') return color('border-t', node);
  if (prop === 'borderBottomColor') return color('border-b', node);
  if (prop === 'borderLeftColor') return color('border-l', node);
  if (prop === 'borderRightColor') return color('border-r', node);
  if (prop === 'borderWidth') return value === 1 ? 'border' : arbitrary('border', value);
  if (prop === 'borderTopWidth') return value === 1 ? 'border-t' : arbitrary('border-t', value);
  if (prop === 'borderBottomWidth') return value === 1 ? 'border-b' : arbitrary('border-b', value);
  if (prop === 'borderLeftWidth') return value === 1 ? 'border-l' : value === 0 ? 'border-l-0' : arbitrary('border-l', value);
  if (prop === 'borderRightWidth') return value === 1 ? 'border-r' : value === 0 ? 'border-r-0' : arbitrary('border-r', value);
  if (prop === 'borderRadius') return value >= 999 ? 'rounded-full' : value === 0 ? 'rounded-none' : arbitrary('rounded', value);
  const corners = { borderTopLeftRadius: 'rounded-tl', borderTopRightRadius: 'rounded-tr', borderBottomLeftRadius: 'rounded-bl', borderBottomRightRadius: 'rounded-br' };
  if (corners[prop]) return arbitrary(corners[prop], value);
  if (prop === 'fontSize') return arbitrary('text', value);
  if (prop === 'lineHeight') return arbitrary('leading', value);
  if (prop === 'letterSpacing') return arbitrary('tracking', value);
  if (prop === 'fontFamily') return value === 'monospace' ? 'font-mono' : `font-[${value}]`;
  if (prop === 'fontWeight') {
    const weight = Number(value);
    if (weight >= 700) return 'font-bold';
    if (weight >= 600) return 'font-semibold';
    if (weight >= 500) return 'font-medium';
    return 'font-normal';
  }
  if (prop === 'opacity') return `opacity-[${value}]`;
  if (prop === 'zIndex') return `z-[${value}]`;
  if (prop === 'aspectRatio') return `aspect-[${value}]`;
  if (prop === 'elevation' || prop === 'shadowColor') return 'shadow-lg';
  if (['shadowOpacity', 'shadowRadius', 'shadowOffset', 'includeFontPadding', 'textAlignVertical'].includes(prop)) return null;
  if (prop === 'transform' && node.type === 'ArrayExpression') {
    return node.elements.map((entry) => {
      if (entry?.type !== 'ObjectExpression' || entry.properties.length !== 1) return null;
      const item = entry.properties[0];
      const key = item.key.name;
      const itemValue = literal(item.value);
      if (key === 'translateX') return arbitrary('translate-x', itemValue);
      if (key === 'translateY') return arbitrary('translate-y', itemValue);
      if (key === 'rotate') return `rotate-[${itemValue}]`;
      if (key === 'scale') return `scale-[${itemValue}]`;
      return null;
    }).filter(Boolean).join(' ');
  }
  unsupported.add(prop);
  return null;
}

function convertStyleObject(object) {
  const staticTokens = [];
  const dynamicTokens = [];
  for (const item of object.properties) {
    if (item.type === 'SpreadElement') {
      if (generate(item.argument).code === 'StyleSheet.absoluteFillObject') staticTokens.push('absolute inset-0');
      else unsupported.add(`spread:${generate(item.argument).code}`);
      continue;
    }
    const prop = item.key.name || item.key.value;
    const token = tokenFor(prop, item.value);
    if (typeof token === 'string' && token) staticTokens.push(token);
    else if (token && token.type) dynamicTokens.push(token);
  }
  const base = t.stringLiteral(staticTokens.join(' '));
  return dynamicTokens.length ? t.callExpression(t.identifier('cn'), [base, ...dynamicTokens]) : base;
}

const isStylesRef = (node) => node?.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'styles';
const isClassExpression = (node) => {
  if (isStylesRef(node)) return true;
  if (node?.type === 'LogicalExpression') return isClassExpression(node.right);
  if (node?.type === 'ConditionalExpression') return (isClassExpression(node.consequent) || node.consequent.type === 'NullLiteral') && (isClassExpression(node.alternate) || node.alternate.type === 'NullLiteral');
  return false;
};

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  let migrated = false;
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier' || callee.object.name !== 'StyleSheet' || callee.property.name !== 'create') return;
      const object = p.node.arguments[0];
      if (object.type !== 'ObjectExpression') return;
      for (const property of object.properties) {
        if (property.type === 'ObjectProperty' && property.value.type === 'ObjectExpression') property.value = convertStyleObject(property.value);
      }
      p.replaceWith(object);
      migrated = true;
    },
    JSXAttribute(p) {
      const originalName = p.node.name.name;
      if (!['style', 'contentContainerStyle', 'columnWrapperStyle', 'ListHeaderComponentStyle'].includes(originalName)) return;
      if (p.node.value?.type !== 'JSXExpressionContainer') return;
      const expression = p.node.value.expression;
      const classProp = originalName === 'style' ? 'className' : originalName.replace(/Style$/, 'ClassName');
      if (isClassExpression(expression)) {
        p.node.name.name = classProp;
        return;
      }
      if (expression.type !== 'ArrayExpression') return;
      const classes = expression.elements.filter(isClassExpression);
      const styles = expression.elements.filter((entry) => entry && !isClassExpression(entry));
      if (!classes.length) return;
      const classValue = classes.length === 1 ? classes[0] : t.callExpression(t.identifier('cn'), classes);
      const classAttribute = t.jsxAttribute(t.jsxIdentifier(classProp), t.jsxExpressionContainer(classValue));
      p.insertBefore(classAttribute);
      if (styles.length === 0) p.remove();
      else if (styles.length === 1) p.node.value.expression = styles[0];
      else p.node.value.expression = t.arrayExpression(styles);
    },
  });
  if (!migrated) continue;
  // Remove StyleSheet from react-native imports and add the shared class combiner.
  traverse(ast, {
    ImportDeclaration(p) {
      if (p.node.source.value === 'react-native') {
        p.node.specifiers = p.node.specifiers.filter((specifier) => !(specifier.type === 'ImportSpecifier' && specifier.imported.name === 'StyleSheet'));
      }
    },
  });
  const relative = path.relative(path.dirname(file), path.join(process.cwd(), 'src/utils/cn')).replace(/\\/g, '/');
  const importPath = relative.startsWith('.') ? relative : `./${relative}`;
  ast.program.body.splice(ast.program.body.findIndex((node) => node.type !== 'ImportDeclaration'), 0,
    t.importDeclaration([t.importSpecifier(t.identifier('cn'), t.identifier('cn'))], t.stringLiteral(importPath)));
  fs.writeFileSync(file, generate(ast, { comments: true, retainLines: false }, source).code + '\n');
  console.log(`migrated ${file}`);
}
console.log('Unsupported StyleSheet properties:', [...unsupported].sort().join(', ') || 'none');
