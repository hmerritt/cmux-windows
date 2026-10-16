// Match the native Markdown viewer's inline-data policy. Loader and mark
// references are blocked; arbitrary url/href/src columns in inline rows are data.
export function firstVegaExternalReference(value,path='spec') {
  if(value===null || typeof value!=='object')return null;
  if(Array.isArray(value)) {
    for(const [index,child] of value.entries()){const hit=firstVegaExternalReference(child,`${path}[${index}]`);if(hit)return hit;}
    return null;
  }
  for(const [key,child] of Object.entries(value)) {
    const lower=key.toLowerCase(),childPath=`${path}.${key}`;
    if(lower==='values')continue;
    if(lower==='datasets') {
      if(child && typeof child==='object' && !Array.isArray(child))for(const [name,dataset] of Object.entries(child)) {
        if(dataset && !Array.isArray(dataset) && typeof dataset.url==='string' && dataset.url.trim())return `${childPath}.${name}.url`;
      }
      continue;
    }
    const segments=childPath.replace(/\[[^\]]+\]/g,'').toLowerCase().split('.');
    if((lower==='url' && segments.at(-2)==='data') || (['url','href','src'].includes(lower) && segments.includes('marks'))) {
      if(typeof child==='string'?child.trim():child!=null)return childPath;
    }
    const hit=firstVegaExternalReference(child,childPath);if(hit)return hit;
  }
  return null;
}

export function parseVegaSource(source) {
  if(source.length>250000)throw Error('chart_limit');
  const spec=JSON.parse(source);
  if(!spec || typeof spec!=='object' || Array.isArray(spec))throw Error('invalid_chart');
  if(firstVegaExternalReference(spec))throw Error('external_chart');
  return spec;
}

export function renderVega(source,mode,{signal}={}) {
  const spec=parseVegaSource(source);
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('aborted'));return;}
    // Vega generates expression functions. Keep that permission in an opaque,
    // sandboxed frame; the privileged desktop document never enables eval.
    const frame=document.createElement('iframe');frame.hidden=true;frame.sandbox='allow-scripts';frame.src='/document-chart-frame.html';frame.setAttribute('aria-hidden','true');
    const id=crypto.randomUUID();let timer;
    const finish=(error,svg)=>{clearTimeout(timer);window.removeEventListener('message',receive);signal?.removeEventListener('abort',abort);frame.remove();if(error)reject(error);else resolve(svg);};
    const abort=()=>finish(Error('aborted'));
    const receive=event=>{
      if(event.source!==frame.contentWindow || event.data?.id!==id)return;
      if(event.data.error || typeof event.data.svg!=='string')finish(Error('invalid_chart'));
      else if(event.data.svg.length>2*1024*1024)finish(Error('chart_limit'));
      else finish(null,event.data.svg);
    };
    window.addEventListener('message',receive);signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(Error('chart_limit')),10000);
    frame.onerror=()=>finish(Error('invalid_chart'));
    frame.onload=()=>frame.contentWindow?.postMessage({id,spec,mode},'*');
    document.body.append(frame);
  });
}
