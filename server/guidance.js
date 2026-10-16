import sanitizeHtml from 'sanitize-html';
export const richTextPrefix='richtext:v1:';
export function cleanGuide(value){
 if(!value.startsWith(richTextPrefix))return value;
 const html=sanitizeHtml(value.slice(richTextPrefix.length),{
  allowedTags:['p','h2','h3','h4','strong','b','em','i','u','s','ul','ol','li','blockquote','hr','br','a','table','thead','tbody','tr','th','td'],
  allowedAttributes:{'*':['style'],a:['href','target','rel'],ol:['start'],th:['colspan','rowspan'],td:['colspan','rowspan']},
  allowedStyles:{'*':{'text-align':[/^(left|center|right|justify)$/]}},allowedSchemes:['https'],allowProtocolRelative:false,
  transformTags:{a:(tag,attributes)=>{try{const url=new URL(attributes.href);if(url.protocol!=='https:'||url.username||url.password)throw new Error();return {tagName:'a',attribs:{href:url.href,target:'_blank',rel:'noopener noreferrer'}};}catch{return {tagName:'span',attribs:{}};}}}
 });
 return richTextPrefix+html;
}
