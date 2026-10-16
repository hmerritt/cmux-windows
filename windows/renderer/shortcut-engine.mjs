import catalog from './shortcut-catalog.mjs';

export {catalog};
const numbered = new Set(['selectSurfaceByNumber','selectWorkspaceByNumber','focusPaneByNumber']);
const disabled = new Set(['','none','clear','unbound','disabled']);
const aliases = {command:'cmd',control:'ctrl',option:'alt',win:'meta',super:'meta',return:'enter',escape:'esc',arrowleft:'left',arrowright:'right',arrowup:'up',arrowdown:'down',' ':'space',plus:'='};
const shifted = {'+':'=','_':'-','{':'[','}':']',':':';','"':"'",'<':',','>':'.','?':'/','|':'\\','~':'`',')':'0','!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9'};
function keyName(key) { return aliases[key.toLowerCase()] || key.toLowerCase(); }
export function parseStroke(value) {
  if (typeof value !== 'string') throw new Error('A shortcut stroke must be a string');
  const parts = value.toLowerCase().trim().replace(/\+\+$/, '+plus').split('+').map(part=>keyName(part.trim()));
  const key = parts.pop();
  const modifiers = new Set(parts);
  if (!key || [...modifiers].some(part=>!['ctrl','alt','shift','cmd','meta'].includes(part))) throw new Error(`Invalid shortcut: ${value}`);
  if (!/^(?:[\p{L}\p{N}\p{P}\p{S}]|space|enter|esc|tab|backspace|delete|insert|home|end|pageup|pagedown|left|right|up|down|f(?:[1-9]|1\d|2[0-4]))$/u.test(key)) throw new Error(`Invalid shortcut key: ${key}`);
  if (modifiers.has('cmd')) { modifiers.delete('cmd'); modifiers.add('ctrl'); }
  return [...['ctrl','alt','shift','meta'].filter(part=>modifiers.has(part)),key].join('+');
}
export function parseBinding(value, id) {
  if (value === null || (typeof value==='string' && disabled.has(value.trim().toLowerCase()))) return [];
  const strokes = Array.isArray(value) ? value : [value];
  if (strokes.length<1 || strokes.length>2) throw new Error('A binding needs one stroke or a two-stroke chord');
  let parsed = strokes.map(parseStroke);
  // The macOS Control+Command family has its own Windows prefix.
  if (strokes.length===1 && /(?:^|\+)(?:cmd|command)(?:\+|$)/i.test(strokes[0]) && /(?:^|\+)(?:ctrl|control)(?:\+|$)/i.test(strokes[0])) {
    parsed=['ctrl+shift+space',parseStroke(strokes[0].replace(/(?:^|\+)(?:ctrl|control)(?=\+|$)/i,''))];
  }
  if (numbered.has(id) && !/^[1-9]$/.test(parsed.at(-1).split('+').at(-1))) throw new Error(`${id} requires a digit from 1 to 9`);
  if (!parsed[0].includes('+') && parsed[0]!=='space' && !/^f(?:[1-9]|1\d|2[0-4])$/.test(parsed[0]) && !id?.startsWith('diffViewer') && !id?.startsWith('fileExplorer')) throw new Error('The first stroke needs a modifier');
  return parsed;
}

// Parse the boolean when-clause grammar without evaluating JavaScript.
export function compileWhen(source) {
  if (source === undefined || source === '') return () => true;
  if (typeof source !== 'string') throw new Error('A when clause must be a string');
  const tokens = source.match(/\s*(?:(&&|\|\||!|\(|\))|([A-Za-z_][\w.]*))/gy);
  if (!tokens || tokens.join('').trim() !== source.trim()) throw new Error('Invalid when clause');
  const input=tokens.map(token=>token.trim()); let index=0;
  function atom() {
    const token=input[index++];
    if (token==='!') { const child=atom(); return context=>!child(context); }
    if (token==='(') { const child=or(); if(input[index++]!==')') throw new Error('Missing closing parenthesis'); return child; }
    if (!token || !/^[A-Za-z_][\w.]*$/.test(token)) throw new Error('Expected context name');
    return context=>token==='true' || (token!=='false' && Boolean(context[token]));
  }
  function and() { let left=atom(); while(input[index]==='&&') { index++; const previous=left,right=atom(); left=context=>previous(context)&&right(context); } return left; }
  function or() { let left=and(); while(input[index]==='||') { index++; const previous=left,right=and(); left=context=>previous(context)||right(context); } return left; }
  const result=or(); if(index!==input.length) throw new Error('Unexpected when token'); return result;
}

export function eventStroke(event) {
  if (event.isComposing || event.key==='Process' || event.getModifierState?.('AltGraph') || event.altGraph) return null;
  const key=keyName(event.key || '');
  if (!key || ['control','ctrl','shift','alt','meta','dead'].includes(key)) return null;
  return [...[event.ctrlKey?'ctrl':null,event.altKey?'alt':null,event.shiftKey?'shift':null,event.metaKey?'meta':null].filter(Boolean),shifted[key]||key].join('+');
}
export class ShortcutRouter {
  constructor(actions=catalog) { this.actions=actions; this.configure({}); }
  configure(settings={}) {
    const entries=[];
    for (const action of this.actions) {
      const value=Object.hasOwn(settings.bindings||{},action.id) ? settings.bindings[action.id] : action.defaultBinding;
      entries.push({...action, strokes:parseBinding(value, action.id), when:compileWhen(settings.when?.[action.id])});
      if(!Object.hasOwn(settings.bindings||{},action.id)) for(const alias of action.aliases||[]) entries.push({...action,strokes:parseBinding(alias,action.id),when:compileWhen(settings.when?.[action.id])});
    }
    this.entries=entries.sort((a,b)=>Number(Object.hasOwn(settings.bindings||{},b.id))-Number(Object.hasOwn(settings.bindings||{},a.id))); this.pending=null;
  }
  handle(event, context, available=()=>true, now=Date.now()) {
    if (event.isComposing || event.key==='Process' || event.getModifierState?.('AltGraph') || event.altGraph) this.pending=null;
    const stroke=eventStroke(event);
    if (!stroke) return null;
    if (stroke==='esc' && this.pending) { this.pending=null; return {consume:true}; }
    const pending=this.pending && now-this.pending.time<1500 ? this.pending : null;
    this.pending=null;
    const matches=(expected,action)=>{
      if (!numbered.has(action.id)) return expected===stroke;
      return /^[1-9]$/.test(stroke.split('+').at(-1)) && expected.slice(0,-1)===stroke.slice(0,-1);
    };
    // The caller orders overlapping context-specific actions before app actions.
    const eligible=this.entries.filter(entry=>entry.strokes.length && available(entry.id,context) && entry.when(context));
    if (pending) {
      const action=eligible.find(entry=>entry.strokes.length===2 && entry.strokes[0]===pending.stroke && matches(entry.strokes[1],entry));
      if (action) return {consume:true,id:action.id,digit:Number(stroke.at(-1))||undefined,repeat:event.repeat};
      // An unmatched suffix is processed normally, including delivery to a shell.
    }
    const action=eligible.find(entry=>entry.strokes.length===2 ? entry.strokes[0]===stroke : matches(entry.strokes[0],entry));
    if (action?.strokes.length===1) return {consume:true,id:action.id,digit:Number(stroke.at(-1))||undefined,repeat:event.repeat};
    if (action?.strokes.length===2) {
      if (!event.repeat) this.pending={stroke,time:now};
      return {consume:true,prefix:true};
    }
    return null;
  }
}
