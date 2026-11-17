'use strict';
// Supplementary blind review with no reasoning budget after long reasoning
// responses exhausted their output cap. Generation/validation is not rerun.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve('docs/reviews/m11.3-glm-comparison-2026-11-17');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'snapshot.json')));
const bridge=fs.readFileSync(path.join(snapshot.frozen,'scripts/ops/m11.3-quiz-provider-bridge.cjs'),'utf8');
const command="node -e 'eval(Buffer.from(process.argv[1],\"base64\").toString())' "+Buffer.from(bridge).toString('base64');
const audit=[];
for(const model of ['glm','deepseek']){
 const folder=path.join(root,model);const calls=JSON.parse(fs.readFileSync(path.join(folder,'calls.json')));
 const cases=JSON.parse(fs.readFileSync(path.join(folder,'summary.json'))).results;
 if(calls.length+cases.length>16)throw Error('Exceeds model experiment call budget');
 for(const result of cases){
  const previous=calls.find(c=>c.phase==='blind-review'&&c.case===result.name);
  if(!previous)throw Error('Missing blind prompt');
  const input=JSON.parse(previous.request.messages[1].content);
  if(input.some(q=>Object.hasOwn(q,'correctAnswer')||Object.hasOwn(q,'answer')||Object.hasOwn(q,'correctIndex')))throw Error('Answer leakage in blind prompt');
  const request={...previous.request,reasoningEffort:'none',timeoutMs:60000,maxTokens:5000};
  const started=Date.now();
  const r=spawnSync('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','langoo-vps',command],{input:JSON.stringify({kind:'chat',chat:request}),encoding:'utf8',timeout:75000,maxBuffer:2000000});
  let response;try{response=JSON.parse(r.stdout.trim());}catch{response={ok:false,name:r.error?.code||'InvalidBridgeReply'};}
  const entry={evaluated_model:model,case:result.name,judge:request.model,reasoningEffort:'none',wallMs:Date.now()-started,blind_ids:input.map(q=>q.id),response};
  audit.push(entry);fs.writeFileSync(path.join(root,'supplementary-blind-reviews.json'),JSON.stringify(audit,null,2)+'\n');
  console.log(JSON.stringify({model,case:result.name,ok:response.ok,wallMs:entry.wallMs}));
 }
}
