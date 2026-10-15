(() => {
 const storageKey='operations-theme';
 let saved;
 try {saved=localStorage.getItem(storageKey);} catch {}
 let theme=['light','dark'].includes(saved)?saved:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
 function apply(){
  document.documentElement.dataset.theme=theme;
  const button=document.querySelector('#theme-toggle');
  if(button){const next=theme==='dark'?'light':'dark';button.textContent=theme==='dark'?'☀ Light':'☾ Dark';button.setAttribute('aria-label',`Switch to ${next} theme`);button.title=`Switch to ${next} theme`;button.setAttribute('aria-pressed',String(theme==='dark'));}
  document.querySelectorAll('iframe[title="Document preview"]').forEach(frame=>{try{frame.contentDocument.documentElement.dataset.theme=theme;}catch{}});
 }
 apply();
 document.addEventListener('DOMContentLoaded',()=>{apply();document.querySelector('#theme-toggle')?.addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';try{localStorage.setItem(storageKey,theme);}catch{}apply();});});
 addEventListener('storage',event=>{if(event.key===storageKey&&['light','dark'].includes(event.newValue)){theme=event.newValue;apply();}});
})();
