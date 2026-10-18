const managementGroup=document.querySelector('.management-group'),managementToggle=document.querySelector('#management-toggle'),managementChildren=document.querySelector('#management-children');
let managementHoverTimer;
function setManagementOpen(open,focus=false){clearTimeout(managementHoverTimer);managementChildren.hidden=!open;managementToggle.setAttribute('aria-expanded',String(open));if(open&&matchMedia('(min-width:801px)').matches){managementChildren.style.left=(document.querySelector('#sidebar').getBoundingClientRect().right+8)+'px';managementChildren.style.top=Math.max(12,Math.min(managementToggle.getBoundingClientRect().bottom-managementChildren.offsetHeight,innerHeight-managementChildren.offsetHeight-12))+'px';}else{managementChildren.style.removeProperty('top');managementChildren.style.removeProperty('left');}if(focus)managementToggle.focus();}
managementToggle.onclick=()=>setManagementOpen(managementToggle.getAttribute('aria-expanded')!=='true');
managementGroup.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&matchMedia('(min-width:801px)').matches)setManagementOpen(true);});
managementGroup.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&matchMedia('(min-width:801px)').matches)managementHoverTimer=setTimeout(()=>{if(!managementChildren.contains(document.activeElement))setManagementOpen(false);},180);});
managementToggle.addEventListener('keydown',e=>{if(['ArrowRight','ArrowDown'].includes(e.key)){e.preventDefault();setManagementOpen(true);[...managementChildren.querySelectorAll('button')].find(b=>!b.hidden)?.focus();}});
managementGroup.addEventListener('keydown',e=>{if(e.key==='Escape'&&managementToggle.getAttribute('aria-expanded')==='true'){e.preventDefault();e.stopPropagation();setManagementOpen(false,true);}});
managementGroup.addEventListener('focusout',()=>{setTimeout(()=>{if(!managementGroup.contains(document.activeElement)&&!managementGroup.matches(':hover'))setManagementOpen(false);},0);});
managementChildren.addEventListener('click',e=>{if(e.target.closest('[data-view]'))setManagementOpen(false,true);});
document.addEventListener('pointerdown',e=>{if(!managementGroup.contains(e.target))setManagementOpen(false);});
matchMedia('(max-width:800px)').addEventListener('change',()=>setManagementOpen(false));
