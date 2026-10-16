// Escape all authored text; only the supported formatting produces HTML.
function guideInline(text){
 return String(text).split(/(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g).map(token=>{
  if(token.startsWith('**')&&token.endsWith('**'))return '<strong>'+esc(token.slice(2,-2))+'</strong>';
  const link=token.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/);
  if(link){try{const url=new URL(link[2]);if(url.protocol==='https:'&&!url.username&&!url.password)return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(link[1])}</a>`;}catch{}}
  return esc(token);
 }).join('');
}
function guideMarkup(text){
 const lines=String(text||'').replace(/\r/g,'').split('\n');let html='',list=null;
 const close=()=>{if(list){html+='</'+list+'>';list=null;}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();if(!line){close();continue;}
  if(line.startsWith('|')&&i+1<lines.length&&/^\|?[\s:|-]+\|/.test(lines[i+1].trim())){
   close();const cells=v=>v.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
   html+='<div class="guide-table-wrap"><table><thead><tr>'+cells(line).map(x=>'<th>'+guideInline(x)+'</th>').join('')+'</tr></thead><tbody>';i++;
   while(i+1<lines.length&&lines[i+1].trim().startsWith('|')){i++;html+='<tr>'+cells(lines[i]).map(x=>'<td>'+guideInline(x)+'</td>').join('')+'</tr>';}
   html+='</tbody></table></div>';continue;
  }
  const item=line.match(/^([-*]|\d+\.)\s+(.+)$/);
  if(item){const kind=/\d/.test(item[1])?'ol':'ul';if(list!==kind){close();html+='<'+kind+'>';list=kind;}html+='<li>'+guideInline(item[2])+'</li>';continue;}
  close();const heading=line.match(/^#{1,3}\s+(.+)$/);html+=heading?'<h4>'+guideInline(heading[1])+'</h4>':'<p>'+guideInline(line)+'</p>';
 }
 close();return html;
}
function categoryGuidance(fields){const notes=fields.filter(f=>f.instructionRole);if(!notes.length)return '';return `<section class="category-guidance" aria-label="Before you upload">${notes.map(f=>`<article class="category-note ${f.instructionRole==='important'?'important':''}"><div class="note-symbol" aria-hidden="true">${f.instructionRole==='important'?'!':'i'}</div><div><h2>${esc(f.label)}</h2><div class="formatted-guide">${guideMarkup(f.guide)}</div></div></article>`).join('')}</section>`;}
function guideEditor(label,name,value){return `<div class="guide-editor" data-guide-editor><div class="guide-toolbar" role="group" aria-label="Text formatting">${[['heading','Heading'],['bold','Bold'],['bullets','Bullets'],['steps','Steps'],['link','Link'],['table','Table']].map(([key,text])=>`<button type="button" data-format="${key}">${text}</button>`).join('')}</div>${area(label,name,value)}<details><summary>Preview formatting</summary><div class="guide-live-preview formatted-guide"></div></details><p class="hint">Use the buttons to insert formatting, then replace the example text. HTML is displayed as text.</p></div>`;}
function bindGuideEditors(){document.querySelectorAll('[data-guide-editor]').forEach(editor=>{const textarea=editor.querySelector('textarea'),preview=editor.querySelector('.guide-live-preview');const update=()=>preview.innerHTML=guideMarkup(textarea.value);textarea.addEventListener('input',update);update();editor.querySelectorAll('[data-format]').forEach(button=>button.onclick=()=>{const selected=textarea.value.slice(textarea.selectionStart,textarea.selectionEnd)||'Your text';const snippets={heading:'\n## '+selected+'\n',bold:'**'+selected+'**',bullets:'\n- '+selected+'\n- Next item\n',steps:'\n1. '+selected+'\n2. Next step\n',link:'['+selected+'](https://example.com)',table:'\n| Document | Instructions |\n| --- | --- |\n| Passport | Clear copy of all pages |\n'};textarea.setRangeText(snippets[button.dataset.format],textarea.selectionStart,textarea.selectionEnd,'end');textarea.focus();update();});});}
function bindCategoryInstructions(chosen){action('#category-instructions',async()=>{
 const intro=chosen.fields.find(f=>f.instructionRole==='introduction'),important=chosen.fields.find(f=>f.instructionRole==='important');
 modal('Client instructions',`<p class="muted">These notes appear above the document checklist. Publish your draft to use them on newly initiated files. Existing files keep their saved version.</p>`+form('category-notes',input('Introduction title','introTitle','text',intro?.label||'Before you upload','maxlength="200"')+guideEditor('Introduction / preparation steps','intro',intro?.guide||'')+input('Important notes title','importantTitle','text',important?.label||'Important instructions','maxlength="200"')+guideEditor('Important instructions','important',important?.guide||''),'Save instructions'));
 bindGuideEditors();bindForm('category-notes',async v=>{const notes=[];for(const [role,title,body,old] of [['introduction',v.introTitle,v.intro,intro],['important',v.importantTitle,v.important,important]])if(body.trim())notes.push({...(old||{}),key:old?.key||crypto.randomUUID(),type:'paragraph',instructionRole:role,label:title.trim()||(role==='important'?'Important instructions':'Before you upload'),guide:body,required:false});await saveCategoryFields(chosen,[...notes,...chosen.fields.filter(f=>!f.instructionRole)]);closeModal();await render();success('Client instructions saved. Publish the draft when ready.');});
});}
