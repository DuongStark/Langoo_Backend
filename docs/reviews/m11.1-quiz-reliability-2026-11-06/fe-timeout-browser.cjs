// Browser integration: actual FE createQuiz + Axios XHR, synthetic 46s local API.
// Requires local FE Vite with VITE_API_BASE_URL=http://127.0.0.1:5199/__mock_api.
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const profile=fs.mkdtempSync('/tmp/langoo-m111-chrome-');
 const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run','--remote-debugging-port=9299','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let socket;
 try{
  let target;
  for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:9299/json/new?about:blank',{method:'PUT'});target=await r.json();break}catch{await delay(100)}}
  assert(target,'Chrome CDP started');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});
  let id=0;const pending=new Map();const errors=[];let posts=0;
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}))});
  const html=`<!doctype html><meta charset="utf-8"><script type="module">
  import RefreshRuntime from '/@react-refresh';
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;
  window.__m111={state:'loading'};
  try {
    const {createQuiz}=await import('/src/api/quizzes.ts');
    const {api}=await import('/src/api/client.ts');
    const start=performance.now();
    const quiz=await createQuiz({question_types:['multiple_choice'],question_count:1});
    window.__m111={state:'done',elapsed_ms:performance.now()-start,quiz,global_timeout_ms:api.defaults.timeout};
  }catch(e){window.__m111={state:'failed',code:e.code,message:e.message}}
  </script>`;
  socket.onmessage=async event=>{
   const data=JSON.parse(event.data);
   if(data.id){const p=pending.get(data.id);pending.delete(data.id);if(data.error)p.reject(data.error);else p.resolve(data.result);return}
   if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text);
   if(data.method==='Fetch.requestPaused'){
    const {requestId,request}=data.params;
    try{
     if(request.url==='http://127.0.0.1:5199/__m111'){
      await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'text/html'}],body:Buffer.from(html).toString('base64')});
     }else if(request.url.endsWith('/__mock_api/v1/quizzes')){
      assert.equal(request.method,'POST');posts++;await delay(46_000);
      await send('Fetch.fulfillRequest',{requestId,responseCode:201,responseHeaders:[{name:'content-type',value:'application/json'}],body:Buffer.from(JSON.stringify({id:'synthetic-quiz',status:'ready',question_count:1})).toString('base64')});
     }else{await send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});errors.push('unexpected intercepted request')}
    }catch(e){errors.push(e.message??String(e))}
   }
  };
  await send('Runtime.enable');await send('Page.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:5199/__m111'},{urlPattern:'http://127.0.0.1:5199/__mock_api/*'}]});
  await send('Page.navigate',{url:'http://127.0.0.1:5199/__m111'});
  let state;
  for(let i=0;i<150;i++){
   const r=await send('Runtime.evaluate',{expression:'window.__m111',returnByValue:true});state=r.result?.value;
   if(state?.state==='done'||state?.state==='failed')break;
   await delay(500);
  }
  assert.equal(state?.state,'done',JSON.stringify(state));assert.equal(state.quiz.id,'synthetic-quiz');
  assert(state.elapsed_ms>=45_000);assert.equal(state.global_timeout_ms,45_000);assert.equal(posts,1);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({code:'M11.1',fixture:'actual FE module + Chrome XHR; local synthetic 46s API',result:'PASS',...state,posts,errors}));
 }finally{socket?.close();chrome.kill('SIGTERM')}
})().catch(e=>{console.error(e);process.exitCode=1});
