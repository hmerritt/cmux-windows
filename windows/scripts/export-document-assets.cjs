const fs=require('node:fs');
const path=require('node:path');
const source=path.resolve(__dirname,'../../Resources/markdown-viewer');
const destination=path.resolve(__dirname,'../renderer/vendor-documents');
fs.mkdirSync(destination,{recursive:true});
for(const file of ['marked.min.js','markdown-sanitizer.js','highlight.min.js','github-markdown.css','highlight-github-dark.css','mermaid.min.js','vega.min.js','vega-lite.min.js','vega-embed.min.js'])fs.copyFileSync(path.join(source,file),path.join(destination,file));
console.log('Exported shared Markdown viewer assets.');
