function openDeleteCaseDialog(id){
 modal('Permanently delete file #'+id,`<div class="document-correction"><div><strong>This action cannot be undone.</strong><p>The client file, checklist, document records, conversations, email history and related records will be permanently deleted from the Operations database. GHL Media files and CRM records are not deleted.</p></div></div>`+form('delete-case-form',input('Administrator email','adminEmail','email','', 'required')+input('Administrator password','adminPassword','password','', 'required autocomplete="off"')+area('Reason for deletion','reason'),'Verify administrator & continue'));
 const f=document.querySelector('#delete-case-form'),button=f.querySelector('button.primary');button.classList.add('danger');let approval=null,readyAt=0;
 f.addEventListener('input',()=>{approval=null;readyAt=0;button.textContent='Verify administrator & continue';button.disabled=false;});
 f.onsubmit=async event=>{event.preventDefault();if(button.disabled)return;button.disabled=true;try{
  if(!approval){const values=Object.fromEntries(new FormData(f));const result=await api('cases/'+id+'/delete-approval','POST',{...values,confirm:true});approval=result.approval;readyAt=Date.now()+result.waitSeconds*1000;f.querySelector('[name=adminPassword]').value='';f.querySelectorAll('input,textarea').forEach(el=>el.disabled=true);
   const tick=()=>{if(!f.isConnected||!document.querySelector('#dialog').open)return;const remaining=Math.ceil((readyAt-Date.now())/1000);button.textContent=remaining>0?'Think carefully — delete in '+remaining+'s':'Permanently delete file';button.disabled=remaining>0;if(remaining>0)setTimeout(tick,200);};tick();return;
  }
  if(Date.now()<readyAt)return;await api('cases/'+id,'DELETE',{approval,confirm:true});closeModal();selectedCase=null;clientPreview=null;await render();success('Client file permanently deleted.');
 }catch(error){report(error);button.disabled=false;}};
}
