'use strict';
// M11.3 research only. Synthetic inputs; no app/ENV/DB writes on VPS.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve('docs/reviews/m11.3-glm-comparison-2026-11-17');
const original=JSON.parse(fs.readFileSync(path.join(root,'oneshot.json'))).find(x=>x.case==='ja-kanji-daily-20');
if(!original||original.slots.length!==20)throw Error('Need original 20 JA slots');
const model=process.argv[2]||'zai-org/glm-5.3-flash';
if(!['zai-org/glm-5.3-flash','deepseek-ai/deepseek-v4.1-flash'].includes(model))throw Error('Unsupported experiment model');
const profile=process.argv[3]||'baseline';
if(!['baseline','paced-refined'].includes(profile))throw Error('Unsupported profile');
const launchIntervalMs=profile==='paced-refined'?300:0;
const output=path.join(root,profile==='paced-refined'?'parallel-deepseek-ja-paced-refined.json':model.startsWith('deepseek-')?'parallel-deepseek-ja.json':'parallel-ja.json');
if(profile==='paced-refined'&&!model.startsWith('deepseek-'))throw Error('Refined profile is DeepSeek only');
if(fs.existsSync(output))throw Error('Refusing to overwrite prior experiment');
const remote=`
const fs=require('node:fs');let input='';process.stdin.setEncoding('utf8');
process.stdin.on('data',s=>input+=s);process.stdin.on('end',async()=>{try{
 const cfg=require('/opt/langoo/app/node_modules/dotenv').parse(fs.readFileSync('/opt/langoo/app/.env'));
 const {OpenAiChatProvider}=require('/opt/langoo/app/dist/ai/providers/openai-chat.provider.js');
 const p=new OpenAiChatProvider({apiKey:cfg.AI_QUIZ_API_KEY||cfg.AI_API_KEY,baseUrl:cfg.AI_QUIZ_BASE_URL||cfg.AI_BASE_URL});
 const {requests,launchIntervalMs}=JSON.parse(input);const start=Date.now();
 await Promise.all(requests.map((request,i)=>new Promise(resolve=>setTimeout(resolve,launchIntervalMs?i*launchIntervalMs:Math.floor(i/5)*1000)).then(async()=>{
 const dispatchedMs=Date.now()-start;let response;
 try{response={ok:true,result:await p.chat(request)};}catch(e){response={ok:false,name:e.name,status:e.status||null,code:typeof e.code==='string'?e.code:undefined,causeCode:typeof e.cause?.code==='string'?e.cause.code:undefined};}
 console.log(JSON.stringify({kind:'result',index:i,dispatchedMs,completedMs:Date.now()-start,latencyMs:Date.now()-start-dispatchedMs,response}));
 })));
 console.log(JSON.stringify({kind:'done',totalMs:Date.now()-start}));
 }catch(e){console.log(JSON.stringify({kind:'fatal',name:e.name}));}});
`;
new Function(remote); // Validate embedded remote program before any network calls.
const command="node -e 'eval(Buffer.from(process.argv[1],\"base64\").toString())' "+Buffer.from(remote).toString('base64');
function run(requests,onEntry){return new Promise(resolve=>{
 const start=Date.now();const proc=spawn('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','langoo-vps',command],{stdio:['pipe','pipe','ignore']});let buffer='',entries=[],error=null;
 const timer=setTimeout(()=>{error='TransportTimeout';proc.kill('SIGTERM');},90000);
 proc.stdout.setEncoding('utf8');proc.stdout.on('data',s=>{buffer+=s;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const entry=JSON.parse(line);entries.push(entry);onEntry?.(entry);}catch{error='InvalidBridgeReply';}}});
 proc.on('error',e=>{error=e.code||e.name;});proc.on('close',code=>{clearTimeout(timer);resolve({wallMs:Date.now()-start,exitCode:code,error,entries});});
 proc.stdin.on('error',()=>{});proc.stdin.end(JSON.stringify({requests,launchIntervalMs}));
});}
function parse(s){try{return JSON.parse(s.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{return null;}}
function validate(q,slot){return !!q&&q.id===slot.id&&q.skill===slot.skill&&q.targetId===slot.targetId&&typeof q.prompt==='string'&&q.prompt.trim()&&Array.isArray(q.options)&&q.options.length===4&&q.options.every(s=>typeof s==='string'&&s.trim())&&new Set(q.options.map(s=>s.normalize('NFKC').trim().toLowerCase())).size===4&&Number.isInteger(q.answer_index)&&q.answer_index>=0&&q.answer_index<4;}
function refinedRequest(slot){
 const task={
  kanji_reading:'Write one natural Japanese sentence containing the exact written target in 【】, then explicitly ask its kana reading. The correct option must be exactly canonicalAnswer. Distractors must be plausible but incorrect kana readings, not corrupted characters or other valid readings.',
  kanji_orthography:'Write one natural Japanese sentence containing the target kana reading in 【】, explicitly ask which kanji spelling represents that marked reading. Never expose the written answer elsewhere in the prompt. Correct option must be exactly canonicalAnswer. Exclude any other legitimate spelling of the same word: 入口 and 入り口 are both valid, so never use them as competing choices. No simplified Chinese lookalikes.',
  context_cloze:'Write one natural Japanese sentence with exactly one ____ replacing the target noun. Supply concrete semantic clues that make only canonicalAnswer possible. All options must fit the grammatical slot but only one fits the stated situation. Avoid vague contexts like going somewhere in the morning, or a person being kind. Do not use synonyms or another word that could reasonably fit. Correct option must equal canonicalAnswer.'
 }[slot.skill];
 const canonicalAnswer=slot.skill==='kanji_reading'?slot.target.reading:slot.target.lemma;
 return {model,reasoningEffort:'low',timeoutMs:60000,maxTokens:1800,messages:[
  {role:'system',content:'You are a careful Japanese exercise author for Vietnamese learners. Generate exactly ONE practice question. Follow the supplied task and dictionary truth, without inventing a different sense. Return a single JSON object matching outputTemplate: retain the exact id, skill and targetId and replace the empty prompt/options with your content. Exactly four nonempty distinct options, Unicode Japanese text without replacement characters. Correct answer index is zero-based and must equal correctPosition; first build the correct option from canonicalAnswer, put it at that position, then fill the other positions with three incorrect distractors. Privately check the final array and solve every option again: exactly one must be defensible. Check grammar, particles, spelling variants, no answer leakage. If a check fails, revise before output. Output only the JSON question, no reasoning, explanations or Markdown. Do not claim official exam status.'},
  {role:'user',content:JSON.stringify({task,dictionary:{lemma:slot.target.lemma,reading:slot.target.reading,meaningVi:slot.target.meaningVi,glossEn:slot.target.glossEn,pos:slot.target.pos},canonicalAnswer,correctPosition:(slot.id-1)%4,outputTemplate:{id:slot.id,skill:slot.skill,targetId:slot.targetId,prompt:'',options:['','','',''],answer_index:(slot.id-1)%4}})}]};
}

(async()=>{
 const requests=original.slots.map(slot=>({model,reasoningEffort:'low',timeoutMs:60000,maxTokens:1800,messages:[{role:'system',content:'Create ONE excellent Japanese multiple-choice practice question for a Vietnamese learner. Return only a JSON object: {"id":1,"skill":"...","targetId":"...","prompt":"...","options":["...","...","...","..."],"answer_index":0}. Follow the slot and supplied sense exactly. Exactly four options and one defensible correct answer. Think carefully and privately solve EVERY option before responding. If any distractor could reasonably fit, rewrite the context/options first. Check Japanese grammar, particles, naturalness, dictionary meaning, spelling aliases and kana variants. Do not use two valid spellings such as 入口 and 入り口 as competing answers. context_cloze: use ____ in a natural sentence with enough specific clues to rule out all other options; respect the target part of speech. kanji_reading: use 【written target】 inside a natural sentence and ask for kana reading. kanji_orthography: use 【kana target】 inside a sentence and ask for written form, without exposing it elsewhere. No explanations or answer hints. Do not expose your private checking. Place the correct answer at the requested zero-based correctPosition.'},{role:'user',content:JSON.stringify({slot,correctPosition:(slot.id-1)%4})}]}));
 if(profile==='paced-refined')requests.splice(0,requests.length,...original.slots.map(refinedRequest));
 const record={profile,launchIntervalMs,task:'M11.3',date:'2026-11-17',model,policy:profile==='paced-refined'?'JA, DeepSeek low, refined prompts, one launch per300ms, no retry; review excluded from generation timing':'JA, low, 20 one-question prompts, 5 launches/sec, no retry; review after generation excluded from timing',requests,progress:[]};
 const save=()=>fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n');save();
 record.generation=await run(requests,e=>{record.progress.push(e);save();if(e.kind==='result')console.log(JSON.stringify({id:original.slots[e.index].id,ok:e.response.ok,completedMs:e.completedMs,latencyMs:e.latencyMs,status:e.response.status}));});
 const received=record.generation.entries.filter(e=>e.kind==='result');
 record.questions=received.map(e=>({index:e.index,question:parse(e.response.result?.content||''),structuralValid:!!validate(parse(e.response.result?.content||''),original.slots[e.index])})).sort((a,b)=>a.index-b.index);
 const valid=record.questions.filter(x=>x.structuralValid);
 record.summary={received:received.length,successful:received.filter(e=>e.response.ok).length,structuralValid:valid.length,firstValidMs:Math.min(...received.filter(e=>valid.some(v=>v.index===e.index)).map(e=>e.completedMs)),allCompletedMs:record.generation.entries.find(e=>e.kind==='done')?.totalMs,wallMs:record.generation.wallMs,tokensIn:received.reduce((n,e)=>n+(e.response.result?.tokensIn||0),0),tokensOut:received.reduce((n,e)=>n+(e.response.result?.tokensOut||0),0)};save();
 record.summary.returnedIdMismatches=record.questions.filter(x=>x.question&&x.question.id!==original.slots[x.index].id).length;
 record.summary.contentShapeValid=record.questions.filter(x=>x.question&&validate({...x.question,id:original.slots[x.index].id},original.slots[x.index])).length;
 record.sourceAnswerChecks=record.questions.flatMap(x=>{
  const q=x.question,slot=original.slots[x.index];if(!q||!Array.isArray(q.options))return [];
  const expected=slot.skill==='kanji_reading'?[slot.target.reading]:slot.skill==='kanji_orthography'?[slot.target.lemma,...(slot.target.kanjiPairs||[]).map(p=>p.written)]:[];
  if(!expected.length)return [];
  return [{requestId:slot.id,skill:slot.skill,selected:q.options[q.answer_index],expected:[...new Set(expected)],matchesSource:expected.includes(q.options[q.answer_index])}];
 });
 const dispatches=received.map(e=>e.dispatchedMs).sort((a,b)=>a-b);
 record.summary.maxDispatchesInRollingSecond=dispatches.length?Math.max(...dispatches.map(t=>dispatches.filter(x=>x>=t&&x<t+1000).length)):0;
 record.summary.unicodeReplacementQuestions=record.questions.filter(x=>x.question&&JSON.stringify(x.question).includes('\uFFFD')).length;
 record.summary.lastSuccessfulMs=received.some(e=>e.response.ok)?Math.max(...received.filter(e=>e.response.ok).map(e=>e.completedMs)):null;
 record.summary.skillFormatMismatches=record.questions.filter(x=>x.question).filter(x=>{
  const q=x.question,s=original.slots[x.index];
  return s.skill==='kanji_reading'&&!q.prompt.includes('【'+s.target.lemma+'】')||s.skill==='kanji_orthography'&&!q.prompt.includes('【'+s.target.reading+'】')||s.skill==='context_cloze'&&(q.prompt.match(/____/g)||[]).length!==1;
 }).map(x=>original.slots[x.index].id);
 record.summary.sourceAnswerMismatches=record.sourceAnswerChecks.filter(x=>!x.matchesSource).length;save();
 console.log(JSON.stringify(record.summary));
 if(valid.length){
  const blind=valid.map(x=>{const {id,prompt,options}=x.question;return {id,prompt,options};});
  const request={...original.reviewRequest,timeoutMs:60000,messages:[original.reviewRequest.messages[0],{role:'user',content:JSON.stringify(blind)}]};
  record.reviewRequest=request;record.review=await run([request]);
  const content=record.review.entries.find(e=>e.kind==='result')?.response?.result?.content;
  record.parsedReview=parse(content||'');const reviews=record.parsedReview?.reviews||[];
  record.summary.reviewComplete=reviews.length===valid.length&&new Set(reviews.map(x=>x.id)).size===valid.length&&valid.every(x=>reviews.some(r=>r.id===x.question.id));
  record.summary.answerAgreement=valid.filter(x=>reviews.find(r=>r.id===x.question.id)?.chosenIndex===x.question.answer_index).length;
  record.summary.flags=reviews.filter(x=>x.quality!=='good'||x.alternateIndices?.length);save();console.log(JSON.stringify({reviewComplete:record.summary.reviewComplete,answerAgreement:record.summary.answerAgreement,flags:record.summary.flags}));
 }
})().catch(e=>{console.error(e.name);process.exitCode=1;});
