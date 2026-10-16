// Return a disposer so nested modal lifetimes restore prior inert states exactly.
export function containModalFocus(overlay,{title,initialFocus}={}) {
  const dialog=overlay.matches('[role=dialog]')?overlay:overlay.querySelector('[role=dialog]');
  if(title && dialog) {
    title.id ||= `cmux-dialog-${crypto.randomUUID()}`;
    dialog.setAttribute('aria-labelledby',title.id);
  }
  const siblings=[...document.body.children].filter(node=>node!==overlay && !node.contains(overlay));
  const previous=siblings.map(node=>[node,node.inert]);
  for(const [node] of previous)node.inert=true;
  const controller=new AbortController();
  const focusable=()=>[...overlay.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(node=>!node.disabled && node.tabIndex>=0 && node.getClientRects().length);
  overlay.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const nodes=focusable();if(!nodes.length)return;
    const first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey && (document.activeElement===first || !overlay.contains(document.activeElement))) {event.preventDefault();last.focus();}
    else if(!event.shiftKey && (document.activeElement===last || !overlay.contains(document.activeElement))) {event.preventDefault();first.focus();}
  },{signal:controller.signal});
  document.addEventListener('focusin',event=>{if(!overlay.contains(event.target))(initialFocus || focusable()[0])?.focus();},{signal:controller.signal});
  return ()=>{controller.abort();for(const [node,inert] of previous)if(node.isConnected)node.inert=inert;};
}
