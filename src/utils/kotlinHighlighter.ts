/**
 * JSX syntax highlighter (replaces Kotlin highlighter).
 * Returns { text, color } spans for CodeEditor overlay.
 * Palette same as VS Code Dark+.
 */
const KEYWORDS = new Set([
  'import','export','default','from','return','const','let','var','function','class','extends',
  'if','else','for','while','do','switch','case','break','continue','throw','try','catch','finally',
  'async','await','yield','new','this','super','extends','implements','typeof','instanceof',
  'true','false','null','undefined','useState','useEffect','useRef','useMemo','useCallback',
]);

const COLORS = {
  keyword: '#C586C0',
  tag: '#4EC9B0',
  attr: '#9CDCFE',
  string: '#CE9178',
  comment: '#6A9955',
  number: '#B5CEA8',
  plain: '#D4D4D4',
};

export const highlightJSX = (source) => {
  if (!source) return [];
  const spans = [];
  let i=0; const len=source.length;
  const push=(text,color)=>{ if(text) spans.push({text, color}); };
  while(i<len){
    const ch=source[i]; const nxt=source[i+1]||'';
    if(ch==='/' && nxt==='/'){ let j=i+2; while(j<len && source[j]!=='\n') j++; push(source.slice(i,j), COLORS.comment); i=j; continue; }
    if(ch==='/' && nxt==='*'){ let j=source.indexOf('*/', i+2); j=j<0?len:j+2; push(source.slice(i,j), COLORS.comment); i=j; continue; }
    if(ch==='"' || ch==="'" || ch==='`'){ let j=i+1; let quote=ch; while(j<len){ if(source[j]==='\\'){ j+=2; continue; } if(source[j]===quote){ j++; break; } if(quote==='`' && source[j]==='$' && source[j+1]==='{'){ break; } j++; } push(source.slice(i,j), COLORS.string); i=j; continue; }
    if(ch==='<'){
      // JSX tag
      let j=i+1; if(source[j]==='/') j++;
      let k=j; while(k<len && /[A-Za-z0-9_-]/.test(source[k])) k++;
      if(k>j){ push(source.slice(i,k), COLORS.tag); i=k; continue; }
    }
    if(/[0-9]/.test(ch) && !/[A-Za-z_]/.test(source[i-1]||'')){ let j=i; while(j<len && /[0-9._]/.test(source[j])) j++; push(source.slice(i,j), COLORS.number); i=j; continue; }
    if(/[A-Za-z_$]/.test(ch)){ let j=i; while(j<len && /[A-Za-z0-9_$]/.test(source[j])) j++; const w=source.slice(i,j); if(KEYWORDS.has(w)) push(w, COLORS.keyword); else if(j<len && source[j]==='=' ) push(w, COLORS.attr); else push(w, COLORS.plain); i=j; continue; }
    push(ch, COLORS.plain); i++;
  }
  return spans;
};

// Backward-compatible name retained while callers migrate from Kotlin terminology.
export const highlightKotlin = highlightJSX;
export default highlightKotlin;
