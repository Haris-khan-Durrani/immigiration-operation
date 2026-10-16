import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {TableKit} from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import DOMPurify from 'dompurify';

export const prefix='richtext:v1:';
export function sanitize(value){
 const safe=DOMPurify.sanitize(value,{ALLOWED_TAGS:['p','h2','h3','h4','strong','b','em','i','u','s','ul','ol','li','blockquote','hr','br','a','table','thead','tbody','tr','th','td'],ALLOWED_ATTR:['href','target','rel','style','start','colspan','rowspan']});
 const template=document.createElement('template');template.innerHTML=safe;
 template.content.querySelectorAll('*').forEach(node=>{
  const alignment=node.style.textAlign;node.removeAttribute('style');if(['left','center','right','justify'].includes(alignment))node.style.textAlign=alignment;
  if(node.tagName==='A'){try{const url=new URL(node.getAttribute('href'));if(url.protocol!=='https:'||url.username||url.password)throw new Error();node.setAttribute('href',url.href);node.setAttribute('target','_blank');node.setAttribute('rel','noopener noreferrer');}catch{node.replaceWith(...node.childNodes);}}
 });
 return template.innerHTML;
}
export function create(element,html,label,onChange,onSelection){
 return new Editor({element,content:sanitize(html),extensions:[
  StarterKit.configure({heading:{levels:[2,3,4]},code:false,codeBlock:false,link:{openOnClick:false,protocols:['https'],defaultProtocol:'https',isAllowedUri:url=>{try{const parsed=new URL(url);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password;}catch{return false;}}}}),
  TableKit.configure({table:{resizable:false}}),TextAlign.configure({types:['heading','paragraph']})
 ],editorProps:{attributes:{role:'textbox','aria-label':label,'aria-multiline':'true',class:'rich-text-content formatted-guide'},transformPastedHTML:sanitize},onUpdate:({editor})=>onChange(editor),onSelectionUpdate:({editor})=>onSelection(editor),onTransaction:({editor})=>onSelection(editor)});
}
