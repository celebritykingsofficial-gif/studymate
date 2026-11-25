let encoder;
async function embed(lines) {
  const {pipeline,env}=await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm');
  env.allowLocalModels=false;
  encoder ||= pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{dtype:'q8'});
  const model=await encoder, vectors=[];
  for(let i=0;i<lines.length;i+=8) vectors.push(...(await model(lines.slice(i,i+8),{pooling:'mean',normalize:true})).tolist());
  return vectors;
}
export async function localAnalyze(subject,meta,syllabus,papers){
  const start=/^\s*(?:unit|chapter|module)\s*[-:.–]?\s*([IVX]+|\d+)\b[\s:–.-]*(.*)$/gim;
  const matches=[...syllabus.matchAll(start)];
  const chapters=matches.map((m,i)=>{
    const lines=(m[2]+'\n'+syllabus.slice(m.index+m[0].length,matches[i+1]?.index??syllabus.length)).split(/\n\s*(?:references|text\s*books|course outcomes)\b/i)[0].trim().split(/\n+/);
    const title=lines.shift()?.trim()||'Unit '+m[1];
    const topics=[...new Set(lines.join(' ').split(/[,;•]|\s+[–—-]\s+|\.\s+/).map(s=>s.trim()).filter(s=>s.length>=4&&s.length<=150&&/[a-z]{3}/i.test(s)))];
    return {title,number:m[1],topics,questions:[],questionCount:0,priority:'low'};
  });
  const catalog=chapters.flatMap(c=>c.topics.map((topic,i)=>({c,topic,half:i<c.topics.length/2?0:1})));
  if(!catalog.length) throw Error('Please upload a clearer syllabus, or use a TXT file with a Unit I heading followed by its comma-separated topics on the next line.');
  const rows=papers.flatMap(p=>p.text.replace(/\s+OR\s+/g,'\nOR\n').split(/\n(?=\s*(?:\d{1,2}\s*[.)]|\([ab]\)|OR\b))|\n\s*OR\s*\n/i).map(s=>s.trim()).filter(s=>s.length>18).map(text=>({text,paperYear:p.fileName,marks:Number(text.match(/\((\d{1,2})\)\s*$/)?.[1])||null})));
  if(!rows.length) throw Error('No readable questions found.');
  const vectors=await embed([...catalog.map(x=>x.c.title+': '+x.topic),...rows.map(x=>x.text)]);
  const unmappedQuestions=[];
  rows.forEach((q,i)=>{
    const v=vectors[catalog.length+i], scores=catalog.map((x,j)=>({x,s:v.reduce((a,b,k)=>a+b*vectors[j][k],0)})).sort((a,b)=>b.s-a.s);
    let best=scores[0];
    const option=q.text.match(/^\s*\d*\s*[.)]?\s*\(([ab])\)/i);
    if(option&&q.marks===16){const alt=scores.find(y=>y.x.c===best.x.c&&y.x.half===(option[1].toLowerCase()==='a'?0:1));if(alt&&best.s-alt.s<.025)best=alt;}
    if(best.s<.34||best.s-scores.find(y=>y.x!==best.x)?.s<.008){unmappedQuestions.push(q);return;}
    best.x.c.questions.push({...q,topic:best.x.topic});best.x.c.questionCount++;best.x.c.priority='medium';
  });
  return {subject,meta,chapters,unmappedQuestions,papersAnalyzed:papers.length,summary:'Topic frequency across your uploaded papers. Inspect the mapped questions to check the evidence.'};
}
