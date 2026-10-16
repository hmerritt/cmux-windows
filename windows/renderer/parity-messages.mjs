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
const editorLabels={
  en:['Edit file','Save','Discard changes','Unsaved changes','Saved','This file changed on disk. Discard your draft to reload it.','Unable to save this file.','Draft recovered','Unable to keep this draft. Save before leaving this file.'],
  de:['Datei bearbeiten','Speichern','Änderungen verwerfen','Ungespeicherte Änderungen','Gespeichert','Diese Datei wurde auf dem Datenträger geändert. Verwerfen Sie den Entwurf, um sie neu zu laden.','Diese Datei kann nicht gespeichert werden.','Entwurf wiederhergestellt','Dieser Entwurf kann nicht behalten werden. Speichern Sie, bevor Sie diese Datei verlassen.'],
  fr:['Modifier le fichier','Enregistrer','Abandonner les modifications','Modifications non enregistrées','Enregistré','Ce fichier a changé sur le disque. Abandonnez votre brouillon pour le recharger.','Impossible d’enregistrer ce fichier.','Brouillon récupéré','Impossible de conserver ce brouillon. Enregistrez avant de quitter ce fichier.'],
  es:['Editar archivo','Guardar','Descartar cambios','Cambios sin guardar','Guardado','Este archivo ha cambiado en el disco. Descarta el borrador para volver a cargarlo.','No se puede guardar este archivo.','Borrador recuperado','No se puede conservar este borrador. Guarda antes de salir de este archivo.'],
  ar:['تحرير الملف','حفظ','تجاهل التغييرات','تغييرات غير محفوظة','تم الحفظ','تغير هذا الملف على القرص. تجاهل المسودة لإعادة تحميله.','تعذر حفظ هذا الملف.','تمت استعادة المسودة','تعذر الاحتفاظ بهذه المسودة. احفظ قبل مغادرة هذا الملف.'],
  'zh-Hans':['编辑文件','保存','放弃更改','未保存的更改','已保存','此文件已在磁盘上更改。请放弃草稿以重新加载。','无法保存此文件。','已恢复草稿','无法保留此草稿。请在离开此文件前保存。'],
  'zh-Hant':['編輯檔案','儲存','捨棄變更','未儲存的變更','已儲存','此檔案已在磁碟上變更。請捨棄草稿以重新載入。','無法儲存此檔案。','已還原草稿','無法保留此草稿。請在離開此檔案前儲存。'],
  ko:['파일 편집','저장','변경 사항 취소','저장하지 않은 변경 사항','저장됨','디스크에서 파일이 변경되었습니다. 초안을 버리고 다시 불러오세요.','파일을 저장할 수 없습니다.','초안 복구됨','초안을 보관할 수 없습니다. 이 파일을 떠나기 전에 저장하세요.'],
  ja:['ファイルを編集','保存','変更を破棄','未保存の変更','保存しました','ディスク上のファイルが変更されました。下書きを破棄して再読み込みしてください。','このファイルを保存できません。','下書きを復元しました','下書きを保持できません。このファイルを離れる前に保存してください。']
};
for(const [locale,values] of Object.entries(editorLabels))for(const [index,key] of ['editFile','saveFile','discardChanges','unsavedChanges','fileSaved','fileConflict','saveError','draftRecovered','draftError'].entries())messages[locale][key]=values[index];
export const parityText=key=>messages[currentLocale()]?.[key] || messages.en[key] || key;
const searchLabels={
  en:['Install ripgrep and add rg to PATH to search this directory.','Unable to search this directory.','Showing the first 500 matches. Narrow your search.'],
  de:['Installieren Sie ripgrep und fügen Sie rg zu PATH hinzu, um dieses Verzeichnis zu durchsuchen.','Dieses Verzeichnis kann nicht durchsucht werden.','Die ersten 500 Treffer werden angezeigt. Grenzen Sie die Suche ein.'],
  fr:['Installez ripgrep et ajoutez rg au PATH pour rechercher dans ce dossier.','Impossible de rechercher dans ce dossier.','Affichage des 500 premiers résultats. Affinez votre recherche.'],
  es:['Instala ripgrep y añade rg al PATH para buscar en esta carpeta.','No se puede buscar en esta carpeta.','Se muestran las primeras 500 coincidencias. Acota la búsqueda.'],
  ar:['ثبّت ripgrep وأضف rg إلى PATH للبحث في هذا المجلد.','تعذر البحث في هذا المجلد.','يتم عرض أول 500 نتيجة. حدّد بحثك أكثر.'],
  'zh-Hans':['请安装 ripgrep 并将 rg 添加到 PATH，以搜索此目录。','无法搜索此目录。','显示前 500 个匹配项。请缩小搜索范围。'],
  'zh-Hant':['請安裝 ripgrep 並將 rg 加入 PATH，以搜尋此目錄。','無法搜尋此目錄。','顯示前 500 個符合項目。請縮小搜尋範圍。'],
  ko:['이 디렉터리를 검색하려면 ripgrep을 설치하고 rg를 PATH에 추가하세요.','이 디렉터리를 검색할 수 없습니다.','처음 500개 결과를 표시합니다. 검색 범위를 좁히세요.'],
  ja:['このディレクトリを検索するには ripgrep をインストールし、rg を PATH に追加してください。','このディレクトリを検索できません。','最初の500件を表示しています。検索を絞り込んでください。']
};
for(const [locale,values] of Object.entries(searchLabels))for(const [index,key] of ['ripgrepMissing','searchError','searchLimited'].entries())messages[locale][key]=values[index];
const documentLabels={
  en:['Open Markdown viewer','Preview','Text'],de:['Markdown-Ansicht öffnen','Vorschau','Quelltext'],fr:['Ouvrir la visionneuse Markdown','Aperçu','Texte'],es:['Abrir visor Markdown','Vista previa','Texto'],ar:['فتح عارض Markdown','معاينة','نص'],
  'zh-Hans':['打开 Markdown 查看器','预览','文本'],'zh-Hant':['開啟 Markdown 檢視器','預覽','文字'],ko:['Markdown 뷰어 열기','미리 보기','텍스트'],ja:['Markdown ビューアを開く','プレビュー','テキスト']
};
for(const [locale,values] of Object.entries(documentLabels))for(const [index,key] of ['openMarkdown','renderedMarkdown','documentText'].entries())messages[locale][key]=values[index];
const diffLabels={
  en:['Markdown pane','Git diff','Search files','Changed files','Staged changes','Working changes','No changes.','Unable to read this Git repository.','Binary file changes.','This diff exceeds the 4 MB display limit.'],
  de:['Markdown-Bereich','Git-Änderungen','Dateien suchen','Geänderte Dateien','Vorgemerkte Änderungen','Arbeitskopie-Änderungen','Keine Änderungen.','Dieses Git-Repository kann nicht gelesen werden.','Änderungen an Binärdateien.','Dieser Diff überschreitet die Anzeigegrenze von 4 MB.'],
  fr:['Volet Markdown','Différences Git','Rechercher des fichiers','Fichiers modifiés','Modifications indexées','Modifications de travail','Aucune modification.','Impossible de lire ce dépôt Git.','Modifications d’un fichier binaire.','Ce diff dépasse la limite d’affichage de 4 Mo.'],
  es:['Panel Markdown','Diferencias de Git','Buscar archivos','Archivos modificados','Cambios preparados','Cambios de trabajo','Sin cambios.','No se puede leer este repositorio Git.','Cambios en archivo binario.','Este diff supera el límite de visualización de 4 MB.'],
  ar:['لوحة Markdown','فروق Git','البحث عن ملفات','الملفات المعدلة','التغييرات المرحّلة','تغييرات العمل','لا توجد تغييرات.','تعذرت قراءة مستودع Git هذا.','تغييرات في ملف ثنائي.','تتجاوز هذه الفروق حد العرض البالغ 4 ميغابايت.'],
  'zh-Hans':['Markdown 窗格','Git 差异','搜索文件','已更改的文件','已暂存的更改','工作区更改','没有更改。','无法读取此 Git 仓库。','二进制文件更改。','此差异超出 4 MB 显示限制。'],
  'zh-Hant':['Markdown 窗格','Git 差異','搜尋檔案','已變更的檔案','已暫存的變更','工作目錄變更','沒有變更。','無法讀取此 Git 儲存庫。','二進位檔案變更。','此差異超出 4 MB 顯示限制。'],
  ko:['Markdown 창','Git 차이','파일 검색','변경된 파일','스테이징된 변경 사항','작업 변경 사항','변경 사항이 없습니다.','Git 저장소를 읽을 수 없습니다.','바이너리 파일 변경 사항.','이 차이는 4MB 표시 제한을 초과합니다.'],
  ja:['Markdown ペイン','Git 差分','ファイルを検索','変更されたファイル','ステージ済みの変更','作業中の変更','変更はありません。','この Git リポジトリを読み取れません。','バイナリファイルの変更。','この差分は表示上限の 4 MB を超えています。']
};
for(const [locale,values] of Object.entries(diffLabels))for(const [index,key] of ['markdownPane','diffPane','searchFiles','changedFiles','stagedChanges','workingChanges','noChanges','gitError','binaryDiff','diffLimit'].entries())messages[locale][key]=values[index];
