'use strict';
// Review already-generated DeepSeek content. Does not regenerate questions.
const fs=require('node:fs'),path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.resolve('docs/reviews/m11.3-glm-comparison-2026-11-17');const file=path.join(root,'parallel-deepseek-ja.json');
const record=JSON.parse(fs.readFileSync(file));if(record.contentReview)throw Error('Already reviewed');
const original=JSON.parse(fs.readFileSync(path.join(root,'oneshot.json'))).find(x=>x.case==='ja-kanji-daily-20');
const input=record.questions.filter(x=>x.question&&Array.isArray(x.question.options)).map(x=>({id:original.slots[x.index].id,prompt:x.question.prompt,options:x.question.options}));
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'snapshot.json')));
const bridge=fs.readFileSync(path.join(snapshot.frozen,'scripts/ops/m11.3-quiz-provider-bridge.cjs'),'utf8');
const command="node -e 'eval(Buffer.from(process.argv[1],\"base64\").toString())' "+Buffer.from(bridge).toString('base64');
const request={...original.reviewRequest,messages:[original.reviewRequest.messages[0],{role:'user',content:JSON.stringify(input)}]};
const started=Date.now();const r=spawnSync('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=15','langoo-vps',command],{input:JSON.stringify({kind:'chat',chat:request}),encoding:'utf8',timeout:80000,maxBuffer:2000000});
let response;try{response=JSON.parse(r.stdout.trim());}catch{response={ok:false,transportExit:r.status};}
let parsed;try{parsed=JSON.parse(response.result.content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{parsed=null;}
const reviews=parsed?.reviews||[];
record.contentReview={policy:'Server binds blind review id to original request slot; raw generated id preserved; answer key hidden',request,response,wallMs:Date.now()-started,parsed,complete:reviews.length===input.length&&new Set(reviews.map(x=>x.id)).size===input.length&&input.every(q=>reviews.some(x=>x.id===q.id)),answerAgreement:record.questions.filter(x=>x.question&&reviews.find(v=>v.id===original.slots[x.index].id)?.chosenIndex===x.question.answer_index).length,flags:reviews.filter(x=>x.quality!=='good'||x.alternateIndices?.length)};
fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({ok:response.ok,count:reviews.length,complete:record.contentReview.complete,agreement:record.contentReview.answerAgreement,flags:record.contentReview.flags}));
