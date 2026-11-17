'use strict';
// M11.3: experimental full-quiz generation; never used to serve learners.
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve('docs/reviews/m11.3-glm-comparison-2026-11-17');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'snapshot.json')));
const {pilotFixtures}=require(path.join(snapshot.frozen,'scripts/ops/m11.3-quiz-fixtures.js'));
const {planQuiz}=require(path.join(snapshot.frozen,'src/ai/quiz/v3/quiz-blueprint.js'));
const bridge=fs.readFileSync(path.join(snapshot.frozen,'scripts/ops/m11.3-quiz-provider-bridge.cjs'),'utf8').replace('status: error.status || null,', 'status: error.status || null, causeCode: typeof error.cause?.code === \'string\' ? error.cause.code : undefined,');
const command="node -e 'eval(Buffer.from(process.argv[1],\"base64\").toString())' "+Buffer.from(bridge).toString('base64');
function call(request){
 const start=Date.now();const r=spawnSync('ssh',['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','langoo-vps',command],{input:JSON.stringify({kind:'chat',chat:request}),encoding:'utf8',timeout:135000,maxBuffer:2000000});
 let response;try{response=JSON.parse(r.stdout.trim());}catch{response={ok:false,name:r.error?.code||'InvalidBridgeReply',transportExit:r.status};}
 return {wallMs:Date.now()-start,response};
}
function parse(content){try{return JSON.parse(content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{return null;}}
const results=[];
for(const fixture of pilotFixtures){
 const skills=fixture.skills.filter(s=>s!=='meaning'&&s!=='usage');
 const plan=planQuiz(fixture.items,fixture.languageId,skills,20);
 const slots=plan.slots.map(s=>({id:s.ordinal,skill:s.skill,targetId:s.targets[0].itemId,target:s.targets[0]}));
 const request={model:'zai-org/glm-5.3-flash',reasoningEffort:'low',timeoutMs:120000,maxTokens:10000,messages:[{role:'system',content:'Create a complete language-learning multiple-choice quiz for Vietnamese learners in ONE response. Return JSON only: {"questions":[{"id":1,"skill":"...","targetId":"...","prompt":"...","options":["...","...","...","..."],"answer_index":0}]}. Exactly 20 questions, following every supplied slot id, skill and targetId. Four distinct options per question, exactly one defensible answer, zero-based answer_index. Natural simple sentences in the target language. context_cloze: sentence with ____ and four words fitting the same grammatical category, only one fitting context; context_meaning: mark target with 【】 in a sentence, ask its Vietnamese meaning, four Vietnamese options. kanji_reading: mark written target with 【】 in a Japanese sentence, four kana readings; kanji_orthography: mark kana target with 【】, four written forms, no written answer elsewhere in prompt. Avoid answer leaks, ambiguous distractors, invented meanings. Match supplied dictionary senses. Vary answer positions. No explanations, no Markdown. These are practice questions, not official exam material.'},{role:'user',content:JSON.stringify({language:fixture.languageId===1?'English':'Japanese',slots})}]};
 const generated=call(request);const parsed=parse(generated.response.result?.content||'');
 const questions=parsed?.questions||[];
 const errors=[];
 if(questions.length!==20)errors.push('Expected exactly 20 questions');
 for(const slot of slots){const q=questions.filter(q=>q.id===slot.id);if(q.length!==1){errors.push('Missing/duplicate id '+slot.id);continue;}const x=q[0];if(x.skill!==slot.skill||x.targetId!==slot.targetId||typeof x.prompt!=='string'||!x.prompt.trim()||!Array.isArray(x.options)||x.options.length!==4||x.options.some(o=>typeof o!=='string'||!o.trim())||new Set(x.options.map(o=>String(o).trim().toLowerCase())).size!==4||!Number.isInteger(x.answer_index)||x.answer_index<0||x.answer_index>3)errors.push('Invalid structure/slot '+slot.id);}
 const entry={case:fixture.name,request,slots,generation:generated,structuralErrors:errors,count:questions.length,questions};
 results.push(entry);fs.writeFileSync(path.join(root,'oneshot.json'),JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({case:entry.case,wallMs:generated.wallMs,providerMs:generated.response.elapsedMs,count:entry.count,structuralErrors:errors}));
 if(questions.length&&generated.response.ok){
  const blind=questions.map(({id,prompt,options})=>({id,prompt,options}));
  const reviewRequest={model:'deepseek-ai/deepseek-v4.1-flash',reasoningEffort:'none',timeoutMs:60000,maxTokens:6000,messages:[{role:'system',content:'Independently solve and review language quiz questions. The answer key is hidden. Return JSON only: {"reviews":[{"id":1,"chosenIndex":0,"alternateIndices":[],"quality":"good","issue":""}]}. Zero-based indices. quality is good, ambiguous, invalid, or unnatural. Flag answer leaks, multiple plausible choices, incorrect readings, wrong sense, unnatural sentences. Include every id exactly once; issue briefly explains non-good quality.'},{role:'user',content:JSON.stringify(blind)}]};
  entry.review=call(reviewRequest);entry.reviewRequest=reviewRequest;entry.parsedReview=parse(entry.review.response.result?.content||'');
  fs.writeFileSync(path.join(root,'oneshot.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({case:entry.case,reviewOk:entry.review.response.ok,reviews:entry.parsedReview?.reviews?.length}));
 }
}
