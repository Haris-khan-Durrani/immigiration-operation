const workspacePaths={overview:'dashboard',intake:'new-clients',cases:'client-files',documents:'file-review',tasks:'my-tasks',categories:'categories',statuses:'file-statuses',automations:'automations',users:'team',settings:'settings',audit:'activity-log',notifications:'notifications',account:'account'};
const workspaceTabs=['overview','tracking','documents','information','internal','tasks','activity'];
function parseWorkspaceUrl(value){
 const url=new URL(value,'https://operations.invalid'),parts=url.pathname.split('/').filter(Boolean),view=Object.keys(workspacePaths).find(key=>workspacePaths[key]===parts[0]||(key==='documents'&&parts[0]==='document-review'))||'overview';
 const id=value=>/^\d+$/.test(value||'')&&Number.isSafeInteger(Number(value))&&Number(value)>0?String(Number(value)):null;
 const caseId=view==='cases'?id(parts[1]):null,preview=!!caseId&&parts[2]==='client-view',tab=parts[preview?3:2];
 return {view,caseId,categoryId:view==='categories'?id(parts[1]):null,preview,tab:workspaceTabs.includes(tab)?tab:null,documentId:id(url.searchParams.get('document')),conversation:['conversation','emails','crm','notes'].includes(url.searchParams.get('conversation'))?url.searchParams.get('conversation'):'conversation',expanded:url.searchParams.get('expanded')==='1'};
}
function workspaceUrl(state){
 let path='/'+(workspacePaths[state.view]||'dashboard');const query=new URLSearchParams();
 if(state.view==='cases'&&state.caseId){path+='/'+encodeURIComponent(state.caseId)+(state.preview?'/client-view':'')+'/'+(workspaceTabs.includes(state.tab)?state.tab:'documents');if(state.documentId&&state.tab==='documents')query.set('document',state.documentId);if(!state.preview&&state.conversation&&state.conversation!=='conversation')query.set('conversation',state.conversation);if(!state.preview&&state.expanded)query.set('expanded','1');}
 if(state.view==='categories'&&state.categoryId)path+='/'+encodeURIComponent(state.categoryId);
 return path+(query.size?'?'+query.toString():'');
}
function restoreWorkspaceUrl(){
 const route=parseWorkspaceUrl(location.href);current=route.view;selectedCase=route.caseId;selectedCategory=route.categoryId;selectedDocument=route.documentId;clientPreview=route.preview&&user?.role!=='CLIENT'?{id:route.caseId}:null;
 fileTab=route.tab||(user?.role==='CLIENT'||clientPreview?'documents':'overview');conversationTab=route.conversation;conversationExpanded=route.expanded;
 if(user?.role==='CLIENT'&&!['overview','cases','account','notifications'].includes(current)){current='overview';selectedCase=null;}
 if(user?.must_change_password){current='account';selectedCase=null;clientPreview=null;}
 document.body.classList.toggle('client-preview-mode',!!clientPreview);
}
function syncWorkspaceUrl(replace=false){
 if(!user)return;const target=workspaceUrl({view:current,caseId:selectedCase,categoryId:selectedCategory,tab:fileTab,documentId:selectedDocument,preview:!!clientPreview,conversation:conversationTab,expanded:conversationExpanded});
 if(location.pathname+location.search!==target)history[replace?'replaceState':'pushState']({},'',target);
}
addEventListener('popstate',()=>{if(!user)return;closeModal();restoreWorkspaceUrl();render(true).catch(report);});
