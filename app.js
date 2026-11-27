const $=s=>document.querySelector(s);
const pages=["home","images","videos","edit","characters","gallery"];
function showPage(id){pages.forEach(p=>$("#"+p)?.classList.toggle("active",p===id));document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("selected",b.dataset.page===id));window.scrollTo({top:0,behavior:"smooth"});if(id==="gallery")renderGallery();}
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2300)}
const get=(k,d=[])=>{try{return JSON.parse(localStorage.getItem(k))||d}catch{return d}};
const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
$("#imageDemo").addEventListener("click",()=>{let p=$("#imagePrompt").value.trim();if(!p)return toast("اكتب وصف الصورة أولاً");let q=get("ai_master_prompts");q.unshift({type:"صورة",prompt:p,ratio:$("#ratio").value,date:new Date().toLocaleString("ar")});set("ai_master_prompts",q);$("#imageMsg").textContent="تم حفظ الوصف محلياً. لم يتم توليد صورة بعد.";toast("حُفظ الوصف في قائمة العمل");});
$("#videoDemo").addEventListener("click",()=>{let p=$("#videoPrompt").value.trim();if(!p)return toast("اكتب وصف الفيديو أولاً");let q=get("ai_master_prompts");q.unshift({type:"فيديو",prompt:p,date:new Date().toLocaleString("ar")});set("ai_master_prompts",q);$("#videoMsg").textContent="تم حفظ إعدادات الفيديو محلياً. محرك الفيديو غير مربوط بعد.";toast("حُفظت إعدادات الفيديو");});
$("#editFile").addEventListener("change",e=>{let f=e.target.files[0];if(!f)return;let u=URL.createObjectURL(f);$("#editPreview").src=u;$("#editPreview").classList.remove("hidden");});
$("#videoImage").addEventListener("change",e=>{if(e.target.files[0])toast("تم اختيار الصورة: "+e.target.files[0].name)});
$("#saveCharacter").addEventListener("click",()=>{let n=$("#charName").value.trim(),d=$("#charDesc").value.trim();if(!n||!d)return toast("أدخل اسم الشخصية ووصفها");let a=get("ai_master_characters");a.push({name:n,desc:d});set("ai_master_characters",a);$("#charName").value="";$("#charDesc").value="";renderCharacters();toast("تم حفظ الشخصية على هذا الجهاز");});
function renderCharacters(){let a=get("ai_master_characters");$("#characterList").innerHTML=a.length?a.map((x,i)=>`<article class="character"><b>${escapeHtml(x.name)}</b><p>${escapeHtml(x.desc)}</p></article>`).join(""):"<p class='hint'>لم تحفظ أي شخصية بعد.</p>";}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderGallery(){let a=get("ai_master_prompts");$("#galleryItems").innerHTML=a.length?a.map(x=>`<article class="gallery-card"><b>${escapeHtml(x.type)}</b><p>${escapeHtml(x.prompt)}</p><small>${escapeHtml(x.date||"")}</small></article>`).join(""):"<p class='hint'>لا توجد أعمال محفوظة بعد.</p>";}
$("#themeInfo").addEventListener("click",()=>toast("AI MASTER — نسخة تأسيسية خاصة بك"));
renderCharacters();renderGallery();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
