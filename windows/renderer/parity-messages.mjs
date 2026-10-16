import {currentLocale} from './i18n.js';
export const messages={
  en:{renderer:'Rendering engine'},
  de:{renderer:'Rendering-Engine'},
  fr:{renderer:'Moteur de rendu'},
  es:{renderer:'Motor de renderizado'},
  ar:{renderer:'محرك العرض'},
  'zh-Hans':{renderer:'渲染引擎'},
  'zh-Hant':{renderer:'算繪引擎'},
  ko:{renderer:'렌더링 엔진'},
  ja:{renderer:'描画エンジン'}
};
const fileLabels={
  en:['Loading…','Refresh','Parent folder','File preview','Unable to open this path.','Preview supports UTF-8 text files up to 1 MB.','More entries are available; open a subfolder.','Close preview'],
  de:['Wird geladen…','Aktualisieren','Übergeordneter Ordner','Dateivorschau','Dieser Pfad kann nicht geöffnet werden.','Die Vorschau unterstützt UTF-8-Textdateien bis zu 1 MB.','Weitere Einträge vorhanden; öffnen Sie einen Unterordner.','Vorschau schließen'],
  fr:['Chargement…','Actualiser','Dossier parent','Aperçu du fichier','Impossible d’ouvrir ce chemin.','L’aperçu prend en charge les fichiers texte UTF-8 jusqu’à 1 Mo.','D’autres éléments sont disponibles ; ouvrez un sous-dossier.','Fermer l’aperçu'],
  es:['Cargando…','Actualizar','Carpeta superior','Vista previa del archivo','No se puede abrir esta ruta.','La vista previa admite archivos de texto UTF-8 de hasta 1 MB.','Hay más elementos; abre una subcarpeta.','Cerrar vista previa'],
  ar:['جارٍ التحميل…','تحديث','المجلد الأصل','معاينة الملف','تعذر فتح هذا المسار.','تدعم المعاينة ملفات UTF-8 النصية حتى 1 ميغابايت.','توجد عناصر إضافية؛ افتح مجلدًا فرعيًا.','إغلاق المعاينة'],
  'zh-Hans':['正在加载…','刷新','上级文件夹','文件预览','无法打开此路径。','预览支持最大 1 MB 的 UTF-8 文本文件。','还有更多项目，请打开子文件夹。','关闭预览'],
  'zh-Hant':['載入中…','重新整理','上層資料夾','檔案預覽','無法開啟此路徑。','預覽支援最大 1 MB 的 UTF-8 文字檔案。','還有更多項目，請開啟子資料夾。','關閉預覽'],
  ko:['불러오는 중…','새로 고침','상위 폴더','파일 미리 보기','이 경로를 열 수 없습니다.','미리 보기는 최대 1MB의 UTF-8 텍스트 파일을 지원합니다.','항목이 더 있습니다. 하위 폴더를 여세요.','미리 보기 닫기'],
  ja:['読み込み中…','更新','親フォルダー','ファイルプレビュー','このパスを開けません。','プレビューは最大 1 MB の UTF-8 テキストファイルに対応しています。','ほかにも項目があります。サブフォルダーを開いてください。','プレビューを閉じる']
};
for(const [locale,values] of Object.entries(fileLabels))for(const [index,key] of ['loading','refresh','parent','preview','pathError','previewLimit','truncated','closePreview'].entries())messages[locale][key]=values[index];
export const parityText=key=>messages[currentLocale()]?.[key] || messages.en[key] || key;
