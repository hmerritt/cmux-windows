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
const mutationLabels={
  en:['New file','New folder','Rename','Create','Cancel','An item with this name already exists.','Enter a valid Windows file name.','Unable to change this item.'],
  de:['Neue Datei','Neuer Ordner','Umbenennen','Erstellen','Abbrechen','Ein Element mit diesem Namen ist bereits vorhanden.','Geben Sie einen gültigen Windows-Dateinamen ein.','Dieses Element kann nicht geändert werden.'],
  fr:['Nouveau fichier','Nouveau dossier','Renommer','Créer','Annuler','Un élément portant ce nom existe déjà.','Saisissez un nom de fichier Windows valide.','Impossible de modifier cet élément.'],
  es:['Nuevo archivo','Nueva carpeta','Cambiar nombre','Crear','Cancelar','Ya existe un elemento con este nombre.','Introduce un nombre de archivo válido para Windows.','No se puede modificar este elemento.'],
  ar:['ملف جديد','مجلد جديد','إعادة تسمية','إنشاء','إلغاء','يوجد عنصر بهذا الاسم بالفعل.','أدخل اسم ملف صالحًا في Windows.','تعذر تغيير هذا العنصر.'],
  'zh-Hans':['新建文件','新建文件夹','重命名','创建','取消','已存在同名项目。','请输入有效的 Windows 文件名。','无法更改此项目。'],
  'zh-Hant':['新增檔案','新增資料夾','重新命名','建立','取消','已存在同名項目。','請輸入有效的 Windows 檔案名稱。','無法變更此項目。'],
  ko:['새 파일','새 폴더','이름 바꾸기','만들기','취소','같은 이름의 항목이 이미 있습니다.','올바른 Windows 파일 이름을 입력하세요.','이 항목을 변경할 수 없습니다.'],
  ja:['新規ファイル','新規フォルダー','名前を変更','作成','キャンセル','同じ名前の項目が既に存在します。','有効な Windows ファイル名を入力してください。','この項目を変更できません。']
};
for(const [locale,values] of Object.entries(mutationLabels))for(const [index,key] of ['newFile','newFolder','renameEntry','createEntry','cancel','entryExists','invalidName','mutationError'].entries())messages[locale][key]=values[index];
const searchLabels={
  en:['Install ripgrep and add rg to PATH to search this directory.','Unable to search this directory.','Search limit reached. Narrow your search.'],
  de:['Installieren Sie ripgrep und fügen Sie rg zu PATH hinzu, um dieses Verzeichnis zu durchsuchen.','Dieses Verzeichnis kann nicht durchsucht werden.','Suchgrenze erreicht. Grenzen Sie die Suche ein.'],
  fr:['Installez ripgrep et ajoutez rg au PATH pour rechercher dans ce dossier.','Impossible de rechercher dans ce dossier.','Limite de recherche atteinte. Affinez votre recherche.'],
  es:['Instala ripgrep y añade rg al PATH para buscar en esta carpeta.','No se puede buscar en esta carpeta.','Se alcanzó el límite de búsqueda. Acota la búsqueda.'],
  ar:['ثبّت ripgrep وأضف rg إلى PATH للبحث في هذا المجلد.','تعذر البحث في هذا المجلد.','تم بلوغ حد البحث. حدّد بحثك أكثر.'],
  'zh-Hans':['请安装 ripgrep 并将 rg 添加到 PATH，以搜索此目录。','无法搜索此目录。','已达到搜索上限。请缩小搜索范围。'],
  'zh-Hant':['請安裝 ripgrep 並將 rg 加入 PATH，以搜尋此目錄。','無法搜尋此目錄。','已達到搜尋上限。請縮小搜尋範圍。'],
  ko:['이 디렉터리를 검색하려면 ripgrep을 설치하고 rg를 PATH에 추가하세요.','이 디렉터리를 검색할 수 없습니다.','검색 한도에 도달했습니다. 검색 범위를 좁히세요.'],
  ja:['このディレクトリを検索するには ripgrep をインストールし、rg を PATH に追加してください。','このディレクトリを検索できません。','検索の上限に達しました。検索を絞り込んでください。']
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

const removalLabels={
  en:['Duplicate','Move to Recycle Bin','%@ copy'],
  de:['Duplizieren','In den Papierkorb verschieben','%@ Kopie'],
  fr:['Dupliquer','Déplacer vers la corbeille','%@ copie'],
  es:['Duplicar','Mover a la papelera de reciclaje','%@ copia'],
  ar:['تكرار','نقل إلى سلة المحذوفات','%@ نسخة'],
  'zh-Hans':['创建副本','移到回收站','%@ 副本'],
  'zh-Hant':['製作副本','移至資源回收筒','%@ 副本'],
  ko:['복제','휴지통으로 이동','%@ 복사본'],
  ja:['複製','ごみ箱に移動','%@ のコピー']
};
for(const [locale,values] of Object.entries(removalLabels))for(const [index,key] of ['duplicateEntry','trashEntry','duplicateName'].entries())messages[locale][key]=values[index];

const diffDisplayLabels={
  en:['Unified','Split','Word wrap','Line numbers','Change backgrounds','Unable to save diff display preferences.'],
  de:['Vereinheitlicht','Geteilt','Zeilenumbruch','Zeilennummern','Änderungshintergründe','Die Anzeigeeinstellungen für Diffs konnten nicht gespeichert werden.'],
  fr:['Unifié','Côte à côte','Retour à la ligne','Numéros de ligne','Arrière-plans des modifications','Impossible d’enregistrer les préférences d’affichage des différences.'],
  es:['Unificado','Dividido','Ajuste de línea','Números de línea','Fondos de cambios','No se pueden guardar las preferencias de visualización de diferencias.'],
  ar:['موحّد','جنبًا إلى جنب','التفاف الكلمات','أرقام الأسطر','خلفيات التغييرات','تعذر حفظ تفضيلات عرض الفروق.'],
  'zh-Hans':['统一视图','并排视图','自动换行','行号','变更背景','无法保存差异显示偏好设置。'],
  'zh-Hant':['統一檢視','並排檢視','自動換行','行號','變更背景','無法儲存差異顯示偏好設定。'],
  ko:['통합 보기','나란히 보기','자동 줄바꿈','줄 번호','변경 배경','차이 표시 환경설정을 저장할 수 없습니다.'],
  ja:['統合表示','左右分割','折り返し','行番号','変更箇所の背景','差分表示の設定を保存できません。']
};
for(const [locale,values] of Object.entries(diffDisplayLabels))for(const [index,key] of ['diffUnified','diffSplit','diffWordWrap','diffLineNumbers','diffBackgrounds','diffPreferenceError'].entries())messages[locale][key]=values[index];

const diffDetailLabels={
  en:['Word diffs','Expand unchanged context','Change indicators','Bars','Classic signs','No indicators','Full context exceeds the display limit. Showing compact context.'],
  de:['Wortunterschiede','Unveränderten Kontext erweitern','Änderungsmarkierungen','Balken','Klassische Zeichen','Keine Markierungen','Der vollständige Kontext überschreitet das Anzeigelimit. Kompakter Kontext wird angezeigt.'],
  fr:['Différences par mot','Développer le contexte inchangé','Indicateurs de modification','Barres','Signes classiques','Aucun indicateur','Le contexte complet dépasse la limite d’affichage. Le contexte réduit est affiché.'],
  es:['Diferencias de palabras','Expandir contexto sin cambios','Indicadores de cambios','Barras','Signos clásicos','Sin indicadores','El contexto completo supera el límite de visualización. Se muestra el contexto reducido.'],
  ar:['فروق الكلمات','توسيع السياق غير المتغير','مؤشرات التغيير','أشرطة','علامات تقليدية','بلا مؤشرات','يتجاوز السياق الكامل حد العرض. يُعرض السياق المختصر.'],
  'zh-Hans':['单词差异','展开未更改的上下文','变更标记','竖条','传统符号','无标记','完整上下文超出显示限制，正在显示精简上下文。'],
  'zh-Hant':['字詞差異','展開未變更的上下文','變更標記','直條','傳統符號','無標記','完整上下文超出顯示限制，正在顯示精簡上下文。'],
  ko:['단어 차이','변경되지 않은 문맥 펼치기','변경 표시','막대','기본 기호','표시 없음','전체 문맥이 표시 제한을 초과합니다. 축소된 문맥을 표시합니다.'],
  ja:['単語の差分','変更のない前後の行を展開','変更マーカー','バー','従来の記号','マーカーなし','全体の前後の行が表示上限を超えています。省略した前後の行を表示します。']
};
for(const [locale,values] of Object.entries(diffDetailLabels))for(const [index,key] of ['diffWordDiffs','diffExpandContext','diffIndicators','diffIndicatorBars','diffIndicatorClassic','diffIndicatorNone','diffContextLimit'].entries())messages[locale][key]=values[index];

const diffSourceLabels={
  en:['Diff source','Branch changes','Base branch or commit','Automatic base','Compare','Choose an existing branch or commit with shared history.','Unable to save the diff source.'],
  de:['Änderungsquelle','Branch-Änderungen','Basis-Branch oder Commit','Automatische Basis','Vergleichen','Wählen Sie einen vorhandenen Branch oder Commit mit gemeinsamer Historie.','Die Änderungsquelle konnte nicht gespeichert werden.'],
  fr:['Source des modifications','Modifications de la branche','Branche ou commit de base','Base automatique','Comparer','Choisissez une branche ou un commit existant ayant un historique commun.','Impossible d’enregistrer la source des modifications.'],
  es:['Origen de los cambios','Cambios de la rama','Rama o confirmación base','Base automática','Comparar','Elige una rama o confirmación existente con historial compartido.','No se puede guardar el origen de los cambios.'],
  ar:['مصدر الاختلافات','تغييرات الفرع','الفرع أو الالتزام الأساسي','أساس تلقائي','مقارنة','اختر فرعًا أو التزامًا موجودًا له سجل مشترك.','تعذر حفظ مصدر الاختلافات.'],
  'zh-Hans':['差异来源','分支更改','基准分支或提交','自动选择基准','比较','请选择具有共同历史记录的现有分支或提交。','无法保存差异来源。'],
  'zh-Hant':['差異來源','分支變更','基準分支或提交','自動選擇基準','比較','請選擇具有共同歷史記錄的現有分支或提交。','無法儲存差異來源。'],
  ko:['차이 소스','브랜치 변경 사항','기준 브랜치 또는 커밋','자동 기준','비교','공통 기록이 있는 기존 브랜치 또는 커밋을 선택하세요.','차이 소스를 저장할 수 없습니다.'],
  ja:['差分ソース','ブランチの変更','比較元のブランチまたはコミット','比較元を自動選択','比較','共通の履歴を持つ既存のブランチまたはコミットを選択してください。','差分ソースを保存できません。']
};
for(const [locale,values] of Object.entries(diffSourceLabels))for(const [index,key] of ['diffSource','diffBranchChanges','diffBase','diffAutomaticBase','diffCompare','diffBaseError','diffSourceSaveError'].entries())messages[locale][key]=values[index];
