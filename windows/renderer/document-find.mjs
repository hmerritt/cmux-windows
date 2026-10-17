import {catalog} from './shortcut-engine.mjs';
import {actionLabel} from './shortcut-ui.mjs';
const label=id=>actionLabel(catalog.find(action=>action.id===id));
export function createDocumentFind(article,toolbar) {
  const bar=document.createElement('div');bar.className='document-find';bar.hidden=true;
  const input=document.createElement('input');input.type='search';input.setAttribute('aria-label',label('find'));input.placeholder=label('find');
  const status=document.createElement('output');status.setAttribute('aria-live','polite');
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label',label('hideFind'));
  bar.append(input,status,close);toolbar.append(bar);
  let ranges=[],index=-1;
  function highlight() {
    if(globalThis.Highlight && globalThis.CSS?.highlights) {
      CSS.highlights.set('cmux-document-find',new Highlight(...ranges));
      CSS.highlights.set('cmux-document-current',new Highlight(...(ranges[index]?[ranges[index]]:[])));
    }
    status.textContent=`${index+1}/${ranges.length}`;
  }
  function update() {
    ranges=[];index=-1;
    const query=input.value;
    if(query && !bar.hidden) {
      const walker=document.createTreeWalker(article,NodeFilter.SHOW_TEXT);
      const nodes=[];let node,offset=0;
      while((node=walker.nextNode())){nodes.push({node,start:offset,end:offset+node.length});offset+=node.length;}
      const pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
      let first=0,last=0;
      for(const match of article.textContent.matchAll(pattern)) {
        while(first<nodes.length && nodes[first].end<=match.index)first++;
        last=Math.max(last,first);
        while(last<nodes.length && nodes[last].end<match.index+match[0].length)last++;
        if(!nodes[first] || !nodes[last])continue;
        const range=document.createRange();range.setStart(nodes[first].node,match.index-nodes[first].start);range.setEnd(nodes[last].node,match.index+match[0].length-nodes[last].start);ranges.push(range);
        if(ranges.length>=5000)break;
      }
      if(ranges.length)index=0;
    }
    highlight();
  }
  function hide(){bar.hidden=true;ranges=[];index=-1;highlight();article.closest('.document-pane')?.focus();}
  input.oninput=update;
  input.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();}
    else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();next(!event.shiftKey);}
  };
  close.onclick=hide;
  function next(forward=true) {
    if(!ranges.length)return;
    index=(index+(forward?1:ranges.length-1))%ranges.length;highlight();ranges[index].startContainer.parentElement?.scrollIntoView({block:'nearest'});
  }
  return {update,hide,next,show(){bar.hidden=false;input.focus();input.select();update();},dispose(){CSS.highlights?.delete('cmux-document-find');CSS.highlights?.delete('cmux-document-current');}};
}
