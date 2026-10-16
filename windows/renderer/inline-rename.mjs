// Keep the editor outside recycled tab DOM, positioned over the exact label.
// Background state updates can replace labels without replacing a typed draft.
export function createInlineRename({errorText}) {
  let current=null;
  function releaseLabel(edit) {
    if(edit.label)edit.label.style.visibility=edit.visibility;
    if(edit.owner)edit.owner.draggable=edit.draggable;
    edit.label=edit.owner=null;
  }
  function close(edit,restoreFocus=false) {
    if(current!==edit)return;
    current=null;cancelAnimationFrame(edit.frame);releaseLabel(edit);edit.host.remove();
    if(restoreFocus)edit.options.findLabel()?.closest('[tabindex]')?.focus();
  }
  function position(edit) {
    if(current!==edit)return;
    const label=edit.options.findLabel();
    if(!edit.options.exists()){close(edit);return;}
    if(label!==edit.label) {
      releaseLabel(edit);edit.label=label;
      if(label){edit.visibility=label.style.visibility;label.style.visibility='hidden';edit.owner=label.closest('.workspace-row,.pane-tab');if(edit.owner){edit.draggable=edit.owner.draggable;edit.owner.draggable=false;}}
    }
    if(label) {
      const rect=label.getBoundingClientRect(),style=getComputedStyle(label);
      edit.host.style.cssText=`position:fixed;z-index:10000;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
      edit.input.style.font=style.font;edit.input.style.color=style.color;
    }
    edit.host.hidden=!label;
    edit.frame=requestAnimationFrame(()=>position(edit));
  }
  async function commit(edit,restoreFocus=false) {
    if(current!==edit)return true;
    if(edit.saving)return edit.saving;
    edit.input.readOnly=true;edit.error.hidden=true;
    edit.saving=(async()=>{
      try {
        if(!edit.options.exists()){close(edit);return true;}
        await edit.options.save(edit.input.value.trim());close(edit,restoreFocus);return true;
      }catch{
        if(current===edit){edit.error.textContent=errorText();edit.error.hidden=false;edit.input.setAttribute('aria-invalid','true');}
        return false;
      }finally{edit.input.readOnly=false;edit.saving=null;}
    })();
    return edit.saving;
  }
  document.addEventListener('pointerdown',event=>{if(current && !current.host.contains(event.target))void commit(current);},true);
  window.addEventListener('blur',()=>{if(current)void commit(current);});
  return {
    isEditing:()=>Boolean(current && !current.saving),
    async open(options) {
      if(current){if(current.options.key===options.key){current.input.focus();return true;}if(!await commit(current))return false;}
      const label=options.findLabel();if(!label)return false;
      const host=document.createElement('div');host.className='inline-rename';
      const input=document.createElement('input');input.type='text';input.className='inline-rename-input';input.maxLength=80;input.value=options.value;input.setAttribute('aria-label',options.label);
      const error=document.createElement('span');error.className='inline-rename-error';error.hidden=true;error.setAttribute('role','status');
      host.append(input,error);document.body.append(host);
      const edit={host,input,error,options,label:null,owner:null,saving:null};current=edit;position(edit);
      for(const name of ['pointerdown','click','dblclick'])host.addEventListener(name,event=>event.stopPropagation());
      input.addEventListener('keydown',event=>{
        event.stopPropagation();if(event.isComposing)return;
        if(event.key==='Enter'){event.preventDefault();void commit(edit,true);}
        if(event.key==='Escape'){event.preventDefault();close(edit,true);}
      });
      input.addEventListener('blur',()=>{if(current===edit)void commit(edit);});
      input.focus();input.select();return true;
    }
  };
}
