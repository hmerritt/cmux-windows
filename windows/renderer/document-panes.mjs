import {parityText} from './parity-messages.mjs';
import {attachWorkspaceFileEditor} from './file-editor.mjs';
import {createDocumentFind} from './document-find.mjs';

function button(key,run){const node=document.createElement('button');node.type='button';node.textContent=parityText(key);node.onclick=run;return node;}
let mermaidLoader;
function loadMermaid() {
  if(!mermaidLoader)mermaidLoader=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='/vendor-documents/mermaid.min.js';
    script.onload=()=>{globalThis.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'dark',maxTextSize:50000,maxEdges:500});resolve(globalThis.mermaid);};
    script.onerror=reject;document.head.append(script);
  });
  return mermaidLoader;
}
export function localDocumentPath(filePath,link) {
  if(!link || /^[a-z][a-z\d+.-]*:/i.test(link) || /^[\\/]/.test(link))return null;
  try {
    const base=filePath.replaceAll('\\','/').split('/').slice(0,-1).join('/');
    // Decode before resolving so encoded traversal is checked by the file service.
    return [...(base?[base]:[]),decodeURIComponent(link.split(/[?#]/)[0])].join('/');
  }catch{return null;}
}
export function createDocumentPanes({openMarkdown}={}) {
  const sessions=new Map();
  function dispose(id){const session=sessions.get(id);if(!session)return;session.disposed=true;clearInterval(session.timer);session.find.dispose();sessions.delete(id);}
  function renderMarkdown(session,text) {
    const sanitizer=globalThis.CmuxMarkdownSanitizer;
    const profile=sanitizer.markdownProfile({url:({tag,value})=>{
      if(tag==='a')return /^(?:https?:|mailto:|#)/i.test(value) || localDocumentPath(session.panel.filePath,value)?value:null;
      if(tag==='img')return /^https:\/\//i.test(value) || /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(value)?value:null;
      return null;
    },element:(source,clean)=>{
      if(clean.localName==='img' && !clean.hasAttribute('src')) {
        const path=localDocumentPath(session.panel.filePath,source.getAttribute('src'));
        if(path)clean.dataset.documentImage=path;
      }
      return true;
    }});
    session.article.replaceChildren(sanitizer.sanitizeToFragment(globalThis.marked.parse(text,{gfm:true}),{document,profile}));
    for(const code of session.article.querySelectorAll('pre code'))globalThis.hljs?.highlightElement(code);
    const counts=new Map();
    for(const heading of session.article.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const slug=heading.textContent.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s/g,'-');
      const count=counts.get(slug)||0;counts.set(slug,count+1);heading.id=slug+(count?`-${count}`:'');
    }
    for(const image of session.article.querySelectorAll('img[data-document-image]')) {
      window.cmuxNative.readWorkspaceImage(session.panel.cwd,image.dataset.documentImage).then(result=>{if(result?.ok && image.isConnected)image.src=result.dataUrl;}).catch(()=>{});
    }
    session.find.update();
    const revision=session.revision;
    for(const code of session.article.querySelectorAll('pre code.language-mermaid')) {
      if(code.textContent.length>50000)continue;
      const source=code.textContent;
      loadMermaid().then(async mermaid=>{
        if(session.disposed || session.revision!==revision)return;
        const {svg}=await mermaid.render(`cmux-diagram-${crypto.randomUUID()}`,source);
        if(session.disposed || session.revision!==revision || !code.isConnected)return;
        const diagram=document.createElement('div');diagram.className='document-diagram';
        diagram.append(sanitizer.sanitizeToFragment(svg,{document,profile:sanitizer.diagramProfile()}));code.parentElement.replaceWith(diagram);session.find.update();
      }).catch(()=>{}); // Invalid diagrams remain readable as their source code.
    }
  }
  function error(session,key){session.error.textContent=parityText(key);session.error.hidden=false;}
  async function refresh(session,{force=false}={}) {
    if(session.disposed || session.loading || (!force && !session.host.isConnected))return;
    session.loading=true;
    try {
      const file=await window.cmuxNative.readWorkspaceFile(session.panel.cwd,session.panel.filePath);
      if(session.disposed)return;
      if(!file?.ok){error(session,['binary_file','file_too_large'].includes(file?.error)?'previewLimit':'pathError');return;}
      session.error.hidden=true;
      if(file.revision===session.revision && !force)return;
      session.revision=file.revision;session.file=file;
      renderMarkdown(session,file.text);
      // A live refresh never replaces a draft the user is editing.
      if(session.editor && !session.editState?.isEditing()) {
        session.editor.remove();session.editor=null;
        if(session.mode==='text')setMode(session,'text');
      }
    }catch{if(!session.disposed)error(session,'pathError');}
    finally{session.loading=false;}
  }
  function setMode(session,mode) {
    session.mode=mode;
    session.article.hidden=mode!=='preview';
    session.previewButton.setAttribute('aria-pressed',String(mode==='preview'));
    session.textButton.setAttribute('aria-pressed',String(mode==='text'));
    if(mode==='text' && session.file && !session.editor) {
      session.editor=document.createElement('section');session.editor.className='document-text-editor workspace-file-preview';
      const text=document.createElement('textarea');text.value=session.file.text;text.readOnly=true;text.spellcheck=false;
      text.setAttribute('aria-label',session.panel.filePath);
      session.editor.append(text);session.content.append(session.editor);
      session.editState=attachWorkspaceFileEditor(session.editor,text,session.file,session.panel.cwd,session.panel.filePath,{reload:async()=>{
        session.editor?.remove();session.editor=null;
        await refresh(session,{force:true});setMode(session,'text');
      }});
    }
    if(session.editor)session.editor.hidden=mode!=='text';
    if(mode==='preview')refresh(session,{force:true});
  }
  return {
    render(panel,body) {
      let session=sessions.get(panel.id);
      const identity=JSON.stringify([panel.cwd,panel.filePath]);
      if(session && session.identity!==identity){dispose(panel.id);session=null;}
      if(!session) {
        const host=document.createElement('div');host.className='document-pane';host.tabIndex=0;host.dataset.documentPanelId=panel.id;
        const toolbar=document.createElement('div');toolbar.className='document-toolbar workspace-files-toolbar';
        const content=document.createElement('div');content.className='document-content';
        const article=document.createElement('article');article.className='markdown-body';article.style.fontSize='16px';
        const problem=document.createElement('p');problem.className='document-error';problem.setAttribute('role','alert');problem.hidden=true;
        session={panel,identity,host,content,article,error:problem,revision:null,file:null,mode:'preview',editor:null,fontSize:16,disposed:false,loading:false};
        session.previewButton=button('renderedMarkdown',()=>setMode(session,'preview'));session.previewButton.dataset.documentAction='preview';session.previewButton.setAttribute('aria-pressed','true');
        session.textButton=button('documentText',()=>setMode(session,'text'));session.textButton.dataset.documentAction='text';session.textButton.setAttribute('aria-pressed','false');
        const refreshButton=button('refresh',()=>refresh(session,{force:true}));
        toolbar.append(session.previewButton,session.textButton,refreshButton);content.append(problem,article);host.append(toolbar,content);
        session.find=createDocumentFind(article,toolbar);
        article.addEventListener('click',event=>{
          const link=event.target.closest('a');if(!link)return;
          event.preventDefault();const href=link.getAttribute('href') || '';
          if(href.startsWith('#')){try{article.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`)?.scrollIntoView();}catch{}return;}
          if(/^(?:https?:|mailto:)/i.test(href)){window.cmuxNative.openExternal(href);return;}
          const filePath=localDocumentPath(panel.filePath,href);
          if(filePath && /\.(md|markdown|mdown)$/i.test(filePath))openMarkdown?.(panel.cwd,filePath);
        });
        sessions.set(panel.id,session);
        session.timer=setInterval(()=>refresh(session),1000);
        refresh(session,{force:true});
      }
      if(session.host.parentElement!==body)body.replaceChildren(session.host);
    },
    focus(id){const session=sessions.get(id);if(session?.host.isConnected)session.host.focus();},
    zoom(id,delta,reset=false){const session=sessions.get(id);if(!session)return;session.fontSize=reset?16:Math.max(8,Math.min(48,session.fontSize+delta));session.article.style.fontSize=`${session.fontSize}px`;},
    find(id,{next=false,forward=true,hide=false}={}){const session=sessions.get(id);if(!session)return;if(hide)session.find.hide();else if(next)session.find.next(forward);else session.find.show();},
    dispose
  };
}
