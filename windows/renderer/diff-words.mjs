import {splitDiffRows} from './diff-lines.mjs';
const segmenter=new Intl.Segmenter(undefined,{granularity:'word'});
const words=text=>Array.from(segmenter.segment(text),part=>part.segment);
function segments(tokens,changed) {
  const result=[];
  for(let index=0;index<tokens.length;index++) {
    const previous=result.at(-1);
    if(previous?.changed===changed[index])previous.text+=tokens[index];
    else result.push({text:tokens[index],changed:changed[index]});
  }
  return result;
}
export function diffWords(before,after,{maxCells=65536}={}) {
  const left=words(before),right=words(after),removed=left.map(()=>true),added=right.map(()=>true);
  let start=0,endLeft=left.length,endRight=right.length;
  while(start<endLeft && start<endRight && left[start]===right[start]){removed[start]=added[start]=false;start++;}
  while(endLeft>start && endRight>start && left[endLeft-1]===right[endRight-1]){removed[--endLeft]=false;added[--endRight]=false;}
  const width=endRight-start+1,height=endLeft-start+1,cells=width*height;
  if(cells<=Math.min(65536,maxCells)) {
    const lengths=new Uint16Array(cells);
    for(let row=height-2;row>=0;row--)for(let col=width-2;col>=0;col--) {
      lengths[row*width+col]=left[start+row]===right[start+col]?1+lengths[(row+1)*width+col+1]:Math.max(lengths[(row+1)*width+col],lengths[row*width+col+1]);
    }
    let row=0,col=0;
    while(row<height-1 && col<width-1) {
      if(left[start+row]===right[start+col]){removed[start+row++]=false;added[start+col++]=false;}
      else if(lengths[(row+1)*width+col]>=lengths[row*width+col+1])row++;else col++;
    }
  }
  // Large replacement blocks retain exact text and use the common boundary
  // words; the matrix and total patch work remain bounded.
  return {before:segments(left,removed),after:segments(right,added),work:Math.min(cells,Math.max(0,maxCells),65536)};
}
export function wordDiffRows(rows,budget={remaining:2000000}) {
  const result=new Map();
  for(const {left,right} of splitDiffRows(rows)) {
    if(left?.kind!=='removed' || right?.kind!=='added')continue;
    const diff=diffWords(left.text.slice(1),right.text.slice(1),{maxCells:Math.max(0,budget.remaining)});
    budget.remaining=Math.max(0,budget.remaining-diff.work);
    result.set(left,diff.before);result.set(right,diff.after);
  }
  return result;
}
