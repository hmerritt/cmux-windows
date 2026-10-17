// Keep line identity independent of display layout so toggling presentation
// never changes the patch or the navigation hunk boundaries.
export function parseDiffLines(patch) {
  const blocks=[];
  let block=null,oldLine=0,newLine=0;
  const lines=patch.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();
  for(const text of lines) {
    const range=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if(range) {
      oldLine=Number(range[1]);newLine=Number(range[2]);
      block={type:'hunk',header:text,rows:[]};blocks.push(block);continue;
    }
    if(block?.type==='hunk' && /^[ +\-\\]/.test(text)) {
      if(text.startsWith('\\')) {if(block.rows.length)block.rows.at(-1).note=text;continue;}
      const kind=text[0]==='+'?'added':text[0]==='-'?'removed':'context';
      block.rows.push({kind,text,oldLine:kind==='added'?null:oldLine++,newLine:kind==='removed'?null:newLine++});
    }else {
      if(block?.type!=='header'){block={type:'header',lines:[]};blocks.push(block);}
      block.lines.push(text);
    }
  }
  return blocks;
}

export function splitDiffRows(rows) {
  const result=[];
  for(let index=0;index<rows.length;) {
    const row=rows[index];
    if(row.kind==='context'){result.push({left:row,right:row});index++;continue;}
    const removed=[],added=[];
    while(index<rows.length && rows[index].kind!=='context') {
      const change=rows[index++];(change.kind==='removed'?removed:added).push(change);
    }
    for(let pair=0;pair<Math.max(removed.length,added.length);pair++)result.push({left:removed[pair]||null,right:added[pair]||null});
  }
  return result;
}
