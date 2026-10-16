import {catalog} from './shortcut-engine.mjs';
import {scopes} from './shortcut-scopes.mjs';
const messages = {
  en:['Keyboard Shortcuts','Search','Unavailable on Windows','Unbound','Save','Reset','Close','Command → Ctrl; Option → Alt. Command+Control → Ctrl+Shift+Space, then the Ctrl shortcut.','Conflicts','Configuration error','Invalid shortcut','Default'],
  de:['Tastaturkurzbefehle','Suchen','Unter Windows nicht verfügbar','Nicht belegt','Speichern','Zurücksetzen','Schließen','Command → Strg; Option → Alt. Command+Control → Strg+Umschalt+Leertaste, dann der Strg-Kurzbefehl.','Konflikte','Konfigurationsfehler','Ungültiger Kurzbefehl','Standard'],
  fr:['Raccourcis clavier','Rechercher','Indisponible sous Windows','Non attribué','Enregistrer','Réinitialiser','Fermer','Command → Ctrl ; Option → Alt. Command+Control → Ctrl+Maj+Espace, puis le raccourci Ctrl.','Conflits','Erreur de configuration','Raccourci invalide','Par défaut'],
  es:['Atajos de teclado','Buscar','No disponible en Windows','Sin asignar','Guardar','Restablecer','Cerrar','Command → Ctrl; Option → Alt. Command+Control → Ctrl+Mayús+Espacio y después el atajo Ctrl.','Conflictos','Error de configuración','Atajo no válido','Predeterminado'],
  ar:['اختصارات لوحة المفاتيح','بحث','غير متاح على Windows','غير معيّن','حفظ','إعادة تعيين','إغلاق','Command → Ctrl؛ Option → Alt. ‏Command+Control → Ctrl+Shift+Space، ثم اختصار Ctrl.','تعارضات','خطأ في الإعدادات','اختصار غير صالح','الافتراضي'],
  'zh-Hans':['键盘快捷键','搜索','Windows 上不可用','未绑定','保存','重置','关闭','Command → Ctrl；Option → Alt。Command+Control → 先按 Ctrl+Shift+Space，再按 Ctrl 快捷键。','冲突','配置错误','无效的快捷键','默认'],
  'zh-Hant':['鍵盤快捷鍵','搜尋','Windows 上無法使用','未綁定','儲存','重設','關閉','Command → Ctrl；Option → Alt。Command+Control → 先按 Ctrl+Shift+Space，再按 Ctrl 快捷鍵。','衝突','設定錯誤','無效的快捷鍵','預設'],
  ko:['키보드 단축키','검색','Windows에서 사용할 수 없음','지정되지 않음','저장','초기화','닫기','Command → Ctrl; Option → Alt. Command+Control → Ctrl+Shift+Space를 누른 다음 Ctrl 단축키를 누르세요.','충돌','구성 오류','잘못된 단축키','기본값'],
  ja:['キーボードショートカット','検索','Windowsでは利用できません','未割り当て','保存','リセット','閉じる','Command → Ctrl、Option → Alt。Command+Control → Ctrl+Shift+Spaceの後にCtrlショートカットを押します。','競合','設定エラー','無効なショートカット','デフォルト']
};
const requested=new URL(globalThis.location?.href || 'http://localhost').searchParams.get('locale') || globalThis.navigator?.language || 'en';
export const shortcutLocale = /^zh-(TW|HK|Hant)/i.test(requested)?'zh-Hant':/^zh/i.test(requested)?'zh-Hans':requested.split('-')[0];
export const shortcutText = index => (messages[shortcutLocale] || messages.en)[index];
export const actionLabel = action => action.translations[shortcutLocale] || action.label;
export function createShortcutSettings(controller) {
  const button=document.createElement('button');
  button.type='button'; button.className='setting-action'; button.textContent=shortcutText(0);
  button.onclick=()=>controller.open(); return button;
}
export function shortcutDialog({getSnapshot,save,parseBinding,onClose}) {
  const dialog=document.createElement('dialog'); dialog.className='shortcut-dialog';
  const heading=document.createElement('h2'); heading.textContent=shortcutText(0);
  const help=document.createElement('p'); help.textContent=shortcutText(7);
  const config=document.createElement('p'); config.className='shortcut-config';
  const errors=document.createElement('p'); errors.setAttribute('role','alert');
  const search=document.createElement('input'); search.type='search'; search.placeholder=shortcutText(1); search.setAttribute('aria-label',shortcutText(1));
  const list=document.createElement('div'); list.className='shortcut-list';
  const close=document.createElement('button'); close.type='button'; close.textContent=shortcutText(6); close.onclick=()=>dialog.close();
  dialog.append(heading,help,config,errors,search,list,close);
  let previousFocus;
  dialog.addEventListener('close',()=>{ onClose?.(); previousFocus?.focus?.(); });
  function render() {
    const snapshot=getSnapshot(); config.textContent=snapshot.path || '';
    errors.textContent=snapshot.error ? `${shortcutText(9)}: ${snapshot.error}` : '';
    list.replaceChildren();
    for(const action of catalog) {
      if(!`${actionLabel(action)} ${action.id}`.toLowerCase().includes(search.value.toLowerCase())) continue;
      const row=document.createElement('div'); row.className='shortcut-row'; row.dataset.shortcutAction=action.id;
      const label=document.createElement('label'); label.textContent=actionLabel(action);
      const id=document.createElement('code'); id.textContent=action.id; label.append(id);
      const input=document.createElement('input'); input.setAttribute('aria-label',actionLabel(action));
      const value=Object.hasOwn(snapshot.settings?.bindings||{},action.id)?snapshot.settings.bindings[action.id]:action.defaultBinding;
      input.value=Array.isArray(value)?value.join(', '):value||''; input.placeholder=shortcutText(3);
      const status=document.createElement('small'); status.textContent=scopes[action.id] ? `${shortcutText(11)}: ${Array.isArray(action.defaultBinding)?action.defaultBinding.join(', '):action.defaultBinding||shortcutText(3)}${action.aliases.length?' / '+action.aliases.join(' / '):''}` : shortcutText(2);
      input.disabled=!scopes[action.id];
      const submit=document.createElement('button'); submit.type='button'; submit.textContent=shortcutText(4); submit.disabled=input.disabled;
      const reset=document.createElement('button'); reset.type='button'; reset.textContent=shortcutText(5); reset.disabled=input.disabled;
      const feedback=document.createElement('small'); feedback.setAttribute('role','status');
      submit.onclick=async()=>{
        let binding;
        try {
          const text=input.value.trim(); binding=text?text.includes(', ')?text.split(', ').map(s=>s.trim()):text:null;
          // JSON arrays support comma as a key without ambiguous chord delimiters.
          if(text.startsWith('[')) binding=JSON.parse(text);
          const parsed=parseBinding(binding,action.id);
          const conflicts=catalog.filter(other=>other.id!==action.id && scopes[other.id] && JSON.stringify(parseBinding(Object.hasOwn(snapshot.settings?.bindings||{},other.id)?snapshot.settings.bindings[other.id]:other.defaultBinding,other.id))===JSON.stringify(parsed) && parsed.length);
          if(conflicts.length) feedback.textContent=`${shortcutText(8)}: ${conflicts.map(actionLabel).join(', ')}`;
          await save(action.id,binding); if(!conflicts.length) render();
        } catch { feedback.textContent=shortcutText(10); }
      };
      reset.onclick=async()=>{ try {await save(action.id,null,true);render();} catch {feedback.textContent=shortcutText(9);} };
      label.append(input); row.append(label,submit,reset,status,feedback); list.append(row);
    }
  }
  search.oninput=render; document.body.append(dialog);
  return {open(){ previousFocus=document.activeElement; render();dialog.showModal();search.focus(); },isOpen:()=>dialog.open,refresh(){if(dialog.open) render();}};
}
