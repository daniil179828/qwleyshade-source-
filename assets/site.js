'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const timeout = () => AbortSignal.timeout(12000);
const safeText = value => String(value ?? '');
const menu = $('.menu-toggle');
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded',String(open));
  menu.setAttribute('aria-label',open ? 'Close menu' : 'Open menu');
  $('#mobile-nav').hidden = !open;
  $('.header').classList.toggle('menu-open',open);
});
function closeMenu(){menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open menu');$('#mobile-nav').hidden=true;$('.header').classList.remove('menu-open');}
$$('#mobile-nav a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const background = $('#backgroundVideo');
const motion = $('#motionToggle');
let userPaused = reduced.matches;
function motionLabel(){background.classList.toggle('motion-allowed',!background.paused);motion.textContent=background.paused?'Play background ▷':'Pause background Ⅱ';motion.setAttribute('aria-pressed',String(background.paused));}
if(reduced.matches){background.autoplay=false;background.pause();}
background.addEventListener('play',motionLabel);background.addEventListener('pause',motionLabel);
motion.addEventListener('click',()=>{if(background.paused){userPaused=false;background.play().catch(()=>{});}else{userPaused=true;background.pause();}motionLabel();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)background.pause();else if(!userPaused&&!reduced.matches)background.play().catch(()=>{});});
reduced.addEventListener('change',e=>{if(e.matches){userPaused=true;background.pause();}motionLabel();});
motionLabel();

function renderUpdates(entries,live,savedAt){
  const valid = entries.filter(x=>x&&typeof x.version==='string');
  if(!valid.length)throw new Error('No releases');
  const list=$('#updateList');list.replaceChildren();
  $$('[data-launcher-version]').forEach(el=>el.textContent=valid[0].version);
  for(const [index,entry] of valid.slice(0,4).entries()){
    const card=document.createElement('article');card.className='update-card'+(index===0?' latest':'');
    const top=document.createElement('div');top.className='update-top';
    const h=document.createElement('h3');h.textContent=entry.version;top.append(h);
    if(index===0){const badge=document.createElement('span');badge.className='new-tag';badge.textContent='LATEST';top.append(badge);}
    if(entry.date){const date=document.createElement('time');date.textContent=entry.date;top.append(date);}
    card.append(top);
    const items=(Array.isArray(entry.items)?entry.items:[]).filter(v=>typeof v==='string'&&/[\p{L}]/u.test(v));
    if(items.length){const ul=document.createElement('ul');for(const item of items){const li=document.createElement('li');li.textContent=item.replace(/^\[\+\]\s*/,'');ul.append(li);}card.append(ul);}
    if(entry.roblox){const p=document.createElement('p');p.className='roblox-version';p.textContent='Roblox / '+entry.roblox;card.append(p);}
    list.append(card);
  }
  $('#changelogState').textContent=live?'Synced from the GitHub changelog':'Saved copy · '+safeText(savedAt)+' · live updates unavailable';
}
async function refreshUpdates(){
  try{const r=await fetch('/api/updates',{cache:'no-store',signal:timeout()});if(!r.ok)throw Error();const data=await r.json();renderUpdates(data.entries,true);}
  catch{
    try{const r=await fetch('data/changelog.snapshot.json',{signal:timeout()});if(!r.ok)throw Error();const data=await r.json();renderUpdates(data.entries,false,data.savedAt);}
    catch{$('#changelogState').textContent='Changelog unavailable. Open GitHub for release notes.';$('#updateList').replaceChildren();const p=document.createElement('p');p.className='empty-state';p.textContent='Could not load release notes. Please try again later.';$('#updateList').append(p);}
  }
}
refreshUpdates();
setInterval(()=>{if(!document.hidden)refreshUpdates();},300000);

const errors={404:'No download file was found in the GitHub repository. Please try again later.',409:'More than one download file was found. The site owner needs to keep one active IPA or APK in its repository.',429:'GitHub is receiving too many requests. Please try again later.',502:'GitHub downloads are temporarily unavailable. Please try again.'};
async function getFile(type){const r=await fetch('/api/download?type='+type+'&meta=1',{cache:'no-store',signal:timeout()});if(!r.ok)throw Error(errors[r.status]||'Could not prepare the download. Please try again.');const info=await r.json();if(typeof info.filename!=='string'||!Number.isFinite(info.size))throw Error('Invalid file information');return info;}
async function refreshFile(type){try{const info=await getFile(type);const match=info.filename.match(/\d+(?:\.\d+){2,}/);$('[data-file-version="'+type+'"]').textContent=match?match[0]:'Latest file';$('[data-file-version="'+type+'"]').title=info.filename;$('[data-file-detail="'+type+'"]').textContent='.'+type+' · '+(info.size/1048576).toFixed(1)+' MB · GitHub';return info;}catch(e){$('[data-file-version="'+type+'"]').textContent='Unavailable';$('[data-file-detail="'+type+'"]').textContent='Download information unavailable';return null;}}
refreshFile('ipa');refreshFile('apk');
let toastTimer;
function toast(text){const box=$('#downloadStatus');box.textContent=text;box.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.hidden=true,9000);}
$$('[data-download]').forEach(link=>link.addEventListener('click',async e=>{
 if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
 e.preventDefault();if(link.getAttribute('aria-busy')==='true')return;
 link.setAttribute('aria-busy','true');
 try{await getFile(link.dataset.download);toast('Your download is starting…');window.location.assign(link.href);}
 catch(error){toast(error.name==='TimeoutError'?'The request timed out. Please try again.':error.message||'Download unavailable. Please try again.');}
 finally{link.removeAttribute('aria-busy');}
}));
