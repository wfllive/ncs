/**
 * Lightweight JS/JSX analyzer (replaces Kotlin analyzer).
 * Keeps same API: analyzeKotlin(source) -> problems[]
 * Now checks JSX syntax: bracket balance, unclosed strings, basic JSX errors.
 * Real validation is via `npm run build` (vite/oxlint).
 */

const maskSource = (source) => {
  const out = source.split('');
  const problems=[];
  const stack=[];
  const pairs={ ')':'(', ']':'[', '}':'{' };
  const closers={ '(':')', '[':']', '{':'}' };
  let line=1, col=1;
  const adv=(ch)=>{ if(ch==='\n'){line++;col=1;} else col++; };
  const blank=(i)=>{ if(out[i]!=='\n') out[i]=' '; };
  let i=0; const len=source.length;
  while(i<len){
    const ch=source[i], n2=source[i+1];
    if(ch==='/' && n2==='/'){ while(i<len && source[i]!=='\n'){ blank(i); adv(source[i]); i++; } continue; }
    if(ch==='/' && n2==='*'){ const sl=line, sc=col; blank(i); adv(ch); blank(i+1); adv(n2); i+=2; let closed=false; while(i<len){ if(source[i]==='*' && source[i+1]==='/'){ blank(i); adv('*'); blank(i+1); adv('/'); i+=2; closed=true; break; } blank(i); adv(source[i]); i++; } if(!closed) problems.push({line:sl,col:sc,severity:'error',code:'unclosed-comment',message:'Незакрытый блок-комментарий /*'}); continue; }
    if(ch==='"' || ch==="'" || ch==='`'){
      const quote=ch; const sl=line, sc=col; blank(i); adv(ch); i++; let closed=false;
      while(i<len){ if(source[i]==='\\'){ blank(i); adv(source[i]); if(i+1<len){ blank(i+1); adv(source[i+1]); } i+=2; continue; } if(source[i]===quote){ blank(i); adv(quote); i++; closed=true; break; } if(source[i]==='\n' && quote!=='`') break; blank(i); adv(source[i]); i++; }
      if(!closed) problems.push({line:sl,col:sc,severity:'error',code:'unclosed-string',message:`Незакрытая строка ${quote}`});
      continue;
    }
    if(ch==='('||ch==='['||ch==='{') stack.push({char:ch,line,col});
    else if(ch===')'||ch===']'||ch==='}'){
      const open=stack.pop();
      if(!open) problems.push({line,col,severity:'error',code:'bracket',message:`Лишняя '${ch}'`});
      else if(open.char!==pairs[ch]) problems.push({line,col,severity:'error',code:'bracket',message:`Несоответствие '${ch}' — ожидалось '${closers[open.char]}' (открыто ${open.line}:${open.col})`});
    }
    adv(ch); i++;
  }
  for(const open of stack) problems.push({line:open.line,col:open.col,severity:'error',code:'bracket',message:`Незакрытая '${open.char}'`});
  return {masked: out.join(''), lexProblems: problems};
};

export const analyzeKotlin = (source='') => {
  if(!source || typeof source!=='string') return [];
  const {masked, lexProblems}=maskSource(source);
  const problems=[...lexProblems];
  if(!lexProblems.length){
    const origLines=source.split('\n');
    const maskedLines=masked.split('\n');
    origLines.forEach((origLine, idx)=>{
      const ln=idx+1;
      const maskedLine=maskedLines[idx]||'';
      // Проверяем оригинальную строку (не masked) для import, иначе кавычки стираются и from 'react' не находится
      if(/^\s*import\s+/.test(maskedLine) && !/from\s+/.test(origLine) && /import\s+[\w*{]/.test(origLine)){
        // Только если это именно import без from (например, import 'style.css' — валидно, не ругаемся)
        // Для import 'x' без from — это side-effect import, валиден
        if(!/^\s*import\s+['"]/.test(origLine)){
          problems.push({line:ln,col:1,severity:'warning',code:'import',message:'Import без from — проверьте путь'});
        }
      }
    });
    // check required React import for JSX files
    if(/<[A-Za-z]/.test(masked) && !/import\s+.*react/i.test(masked)){
      problems.push({line:1,col:1,severity:'warning',code:'missing-import',message:'JSX файл без импорта React — добавьте import React from "react"'});
    }
  }
  problems.sort((a,b)=> (a.severity==='error'?0:1)-(b.severity==='error'?0:1) || a.line-b.line);
  const uniq=[]; const keys=new Set();
  for(const p of problems){ const k=`${p.line}:${p.col}:${p.code}`; if(!keys.has(k)){keys.add(k); uniq.push(p);} }
  return uniq;
};

export const summarizeProblems = (problems=[])=>({ errors: problems.filter(p=>p.severity==='error').length, warnings: problems.filter(p=>p.severity==='warning').length });
export default analyzeKotlin;
// support new name too
export const analyzeJSX = analyzeKotlin;
export const analyzeJS = analyzeKotlin;
