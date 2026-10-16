// This document runs with an opaque sandbox origin and no network/image access.
// Only the owning parent can submit one chart, and only static SVG is returned.
let rendering=false;
window.addEventListener('message',async event=>{
  if(rendering || event.source!==parent || typeof event.data?.id!=='string')return;
  rendering=true;
  const {id,spec,mode}=event.data;
  let result;
  try {
    const blocked=()=>Promise.reject(Error('external_chart'));
    result=await vegaEmbed(document.getElementById('chart'),spec,{mode:mode==='vega'?'vega':'vega-lite',actions:false,renderer:'svg',theme:'dark',loader:{load:blocked,sanitize:blocked}});
    const svg=await result.view.toSVG();
    parent.postMessage({id,svg},'*');
  }catch{parent.postMessage({id,error:true},'*');}
  finally{try{result?.finalize();}catch{}}
});
