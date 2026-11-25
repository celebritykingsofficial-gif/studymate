import {supabase} from './supabase.js';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function mountShelf(root,user){
  if(!root||!user)return;
  const bucket=supabase.storage.from('sample-pages');
  const status=document.createElement('p');
  status.setAttribute('role','status');
  const body=document.createElement('section');
  root.replaceChildren(status,body);
  async function refresh(){
    status.textContent='Loading papers…';
    const [role,list]=await Promise.all([supabase.from('paper_creators').select('user_id').eq('user_id',user.id).maybeSingle(),supabase.from('sample_papers').select('*').order('exam_date',{ascending:false})]);
    if(list.error||role.error)throw list.error||role.error;
    const records=list.data;
    body.innerHTML=(role.data?'<details class="panel"><summary>Publish a sample paper</summary><form class="paper-form"><label>Subject<input name="subject" required></label><label>Subject code<input name="code" required></label><label>Exam date<input type="date" name="exam_date" required></label><label>Total marks<input type="number" name="marks" min="1" value="100" required></label><label>Page images (number filenames in reading order)<input type="file" name="images" accept="image/png,image/jpeg,image/webp" multiple required></label><button class="primary-button">Publish to students</button></form></details>':'')+records.map((p,i)=>'<article class="panel sheet"><small>'+escape(p.code)+' · '+escape(p.exam_date)+'</small><h2>'+escape(p.subject)+'</h2><p>'+p.marks+' marks · '+p.pages.length+' pages</p><button class="secondary-button" data-open="'+i+'">View paper</button> '+(role.data?'<button class="text-button" data-edit="'+i+'">Edit details</button>':'')+'<section></section></article>').join('');
    status.textContent=records.length?'':'Published papers will appear here.';
    body.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{
      const p=records[b.dataset.open], area=b.parentElement.querySelector('section');area.replaceChildren();
      for(const [i,path] of p.pages.entries()){
        const {data,error}=await bucket.createSignedUrl(path,600);
        if(error){status.textContent=error.message;return;}
        const img=new Image();img.src=data.signedUrl;img.alt=p.subject+' page '+(i+1);img.style.width='100%';
        const link=document.createElement('button');link.className='secondary-button';link.textContent='Download page '+(i+1);
        link.onclick=async()=>{const {data,error}=await bucket.download(path);if(error){status.textContent=error.message;return;}const a=document.createElement('a');a.href=URL.createObjectURL(data);a.download=p.code+'-page-'+(i+1)+'.'+path.split('.').pop();a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);};
        area.append(img,link);
      }
    });
    const form=body.querySelector('form');if(!form)return;
    body.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const p=records[b.dataset.edit];for(const k of ['subject','code','exam_date','marks'])form.elements[k].value=p[k];form.dataset.id=p.id;form.elements.images.required=false;form.querySelector('button').textContent='Save changes';form.parentElement.open=true;form.scrollIntoView();});
    form.onsubmit=async e=>{
      e.preventDefault();const button=form.querySelector('button');button.disabled=true;const uploaded=[];
      try{
        const id=form.dataset.id||crypto.randomUUID();const files=[...form.elements.images.files].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        for(const f of files){const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[f.type];if(!ext||f.size>10485760)throw Error('Use JPG, PNG or WebP images under 10 MB per page.');const path=id+'/'+crypto.randomUUID()+'.'+ext;const {error}=await bucket.upload(path,f);if(error)throw error;uploaded.push(path);}
        const fields=Object.fromEntries(['subject','code','exam_date','marks'].map(k=>[k,form.elements[k].value]));if(uploaded.length)fields.pages=uploaded;
        const table=supabase.from('sample_papers');const {error}=await(form.dataset.id?table.update(fields).eq('id',id):table.insert({...fields,id}));if(error)throw error;
        uploaded.length=0;await refresh();
      }catch(err){if(uploaded.length)await bucket.remove(uploaded);status.textContent=err.message;button.disabled=false;}
    };
  }
  try{await refresh();}catch(err){status.textContent=err.message;}
}
