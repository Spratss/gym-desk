/* Gym Desk: core, storage, Train / Plan / Log. Food lives in food.js. */
(function(){
'use strict';
var GD=window.GD={};
// This copy of the app's version, from the ?v= on its own script address.
GD.clientVersion=(function(){try{return new URL(document.currentScript.src).searchParams.get('v')||''}catch(e){return ''}})();
var DAYS=['push','pull','legs'];
var DAY_NAME={push:'Push',pull:'Pull',legs:'Legs'};
var DAY_FOCUS={push:'Chest · Shoulders · Triceps',pull:'Back · Biceps',legs:'Legs · Core'};
var WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var CHECK='<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var CHECK_SM='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function $(s){return document.querySelector(s)}
var view;

var LS={
  get:function(k,d){try{var v=localStorage.getItem('gymdesk.'+k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set:function(k,v){try{localStorage.setItem('gymdesk.'+k,JSON.stringify(v))}catch(e){}},
  del:function(k){try{localStorage.removeItem('gymdesk.'+k)}catch(e){}}
};

var S=GD.S={
  tab:LS.get('tab','train'),phase:'loading',
  plan:{},settings:null,sessions:[],loaded:false,body:LS.get('body',null),
  active:null,focus:null,drafts:{},finished:{},
  planDay:LS.get('planDay','push'),planOpen:null,logOpen:null,confirmDel:null,addOpen:false,
  summary:null,rest:null,pendingRender:false,sound:LS.get('sound',true),
  online:true,unreachable:0,installPrompt:null
};
if(['train','food','plan','log'].indexOf(S.tab)<0)S.tab='train';
if(DAYS.indexOf(S.planDay)<0)S.planDay='push';

/* ---------- utils ---------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function pad(n){return String(n).padStart(2,'0')}
function dkey(d){d=d instanceof Date?d:new Date(d);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function parseKey(k){var p=String(k).split('-').map(Number);return new Date(p[0],p[1]-1,p[2])}
function fmtDay(k){var d=parseKey(k);return WD[d.getDay()]+' '+d.getDate()+' '+MO[d.getMonth()]}
function monday(d){var x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return x}
function addDays(d,n){var x=new Date(d);x.setDate(x.getDate()+n);return x}
function daysSince(k){return Math.round((parseKey(dkey(new Date()))-parseKey(k))/86400000)}
function clock(sec){sec=Math.max(0,Math.ceil(sec));return Math.floor(sec/60)+':'+pad(sec%60)}
function hms(ms){var t=Math.max(0,Math.floor(ms/1000)),h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60;return h?h+':'+pad(m)+':'+pad(s):m+':'+pad(s)}
function num(v){if(v==null||String(v).trim()==='')return null;var n=parseFloat(String(v).replace(',','.'));return isFinite(n)?n:null}
function r1(n){return n==null?null:Math.round(n*10)/10}
function r2(n){return Math.round(n*100)/100}
function kg(n){return n==null?'':String(r2(n))}
function clone(o){return JSON.parse(JSON.stringify(o))}
function rid(){return (crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2))}
function repsTxt(ex){if(ex.repMin==null&&ex.repMax==null)return 'max';if(ex.repMin==null||ex.repMin===ex.repMax)return String(ex.repMax);if(ex.repMax==null)return ex.repMin+'+';return ex.repMin+'–'+ex.repMax}
function target(ex){return ex.sets+' × '+repsTxt(ex)+(ex.perSide?' each side':'')}
function restLabel(s){s=s||60;if(s<60)return s+' s';return s%60?clock(s):(s/60)+' min'}
function linkify(t){return esc(t).replace(/https?:\/\/[^\s<]+/g,function(u){var host='link';try{host=new URL(u.replace(/&amp;/g,'&')).hostname.replace(/^www\./,'')}catch(e){}return '<a href="'+u+'" target="_blank" rel="noopener">'+esc(host)+' ↗</a>'})}
var T={};function debounce(k,fn,ms){clearTimeout(T[k]);T[k]=setTimeout(fn,ms)}
var toastT;function toast(m){var t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(function(){t.classList.remove('show')},2800)}
function haptic(){try{navigator.vibrate&&navigator.vibrate(12)}catch(e){}}
var reduceMotion=false;try{reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}

/* ---------- server + offline queue ---------- */
// Every change goes into an outbox kept in localStorage, then is sent in order.
// No signal at the gym? Changes wait and go out when the connection comes back.
var outbox=LS.get('outbox',[]);
function persistOutbox(){LS.set('outbox',outbox);setSync()}
var inflight=null; // id of the job currently being sent; never merge into or drop it
function queue(method,url,body,opts){
  opts=opts||{};
  if(method==='PUT')outbox=outbox.filter(function(j){return !(j.method==='PUT'&&j.url===url&&j.id!==inflight)});
  if(opts.entry){
    var post=outbox.find(function(j){return j.method==='POST'&&j.entry===opts.entry&&j.id!==inflight});
    if(post&&method==='DELETE'){outbox=outbox.filter(function(j){return j.entry!==opts.entry});persistOutbox();return}
    if(post&&method==='PATCH'){Object.assign(post.body,body);persistOutbox();kick();return}
  }
  outbox.push({id:rid(),method:method,url:url,body:body||null,entry:opts.entry||null,t:Date.now()});
  persistOutbox();kick();
}
function pending(url){return outbox.some(function(j){return j.url===url})}
var flushing=false,retryT=null,backoff=0;
function kick(){if(!flushing)flush()}
function flush(){
  if(flushing)return;flushing=true;setSync();
  (function next(){
    if(!outbox.length){flushing=false;setSync();if(GD.onFlushed)GD.onFlushed();return}
    var j=outbox[0];inflight=j.id;
    fetch(j.url,{method:j.method,headers:{'content-type':'application/json'},body:j.body?JSON.stringify(j.body):undefined,credentials:'same-origin'})
      .then(function(res){
        if(res.status===401){flushing=false;inflight=null;needLogin();return}
        if(res.status>=500||res.status===429||res.status===408)throw new Error('server '+res.status);
        var done=function(){outbox=outbox.filter(function(x){return x.id!==j.id});inflight=null;persistOutbox();backoff=0;S.online=true;S.unreachable=0;next()};
        if(!res.ok)return res.json().catch(function(){return {}}).then(function(b){toast(b.error||'The server turned down a change.');done()});
        done();
      })
      .catch(function(){
        flushing=false;inflight=null;S.online=false;S.unreachable++;setSync();
        backoff=Math.min(30000,(backoff||1500)*2);clearTimeout(retryT);retryT=setTimeout(kick,backoff);
      });
  })();
}
function api(method,url,body){
  return fetch(url,{method:method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'})
    .then(function(res){
      return res.json().catch(function(){return {}}).then(function(b){
        if(res.status===401){needLogin();throw {status:401,message:'Sign in first.'}}
        if(!res.ok)throw {status:res.status,message:b.error||'Something went wrong.',body:b};
        S.online=true;S.unreachable=0;setSync();return b;
      });
    },function(){S.online=false;setSync();throw {offline:true,message:'You’re offline.'}});
}
function setSync(){
  var el=$('#sync');if(!el)return;var label,cls='';
  if(!S.online&&S.unreachable>2&&navigator.onLine){label='Can’t reach server';cls='error'}
  else if(!S.online){label=outbox.length?outbox.length+' waiting':'Offline';cls='offline'}
  else if(outbox.length||flushing){label='Saving…';cls='saving'}
  else label='Saved';
  el.className='sync '+cls;el.querySelector('span').textContent=label;
}
window.addEventListener('online',function(){S.online=true;kick();setSync()});
window.addEventListener('offline',function(){S.online=false;setSync()});

/* ---------- audio + wake lock ---------- */
var actx=null;
function primeAudio(){try{if(!actx){var C=window.AudioContext||window.webkitAudioContext;if(C)actx=new C()}if(actx&&actx.state==='suspended')actx.resume()}catch(e){}}
function beep(){
  if(S.sound&&actx){try{[0,0.28].forEach(function(off){var o=actx.createOscillator(),g=actx.createGain(),t0=actx.currentTime+off;o.type='sine';o.frequency.value=880;g.gain.setValueAtTime(0.0001,t0);g.gain.exponentialRampToValueAtTime(0.35,t0+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t0+0.2);o.connect(g);g.connect(actx.destination);o.start(t0);o.stop(t0+0.22)})}catch(e){}}
  try{navigator.vibrate&&navigator.vibrate([180,90,180])}catch(e){}
}
var wake=null;
function keepAwake(on){try{
  if(on){if(!wake&&navigator.wakeLock&&document.visibilityState==='visible'){navigator.wakeLock.request('screen').then(function(w){wake=w;w.addEventListener('release',function(){wake=null})}).catch(function(){})}}
  else if(wake){wake.release().catch(function(){});wake=null}
}catch(e){}}

/* ---------- data helpers ---------- */
function st(){return S.settings||{}}
function bikeDef(){return st().bikeDefault||15}
function bikeRange(){return (st().bikeMin||10)+'–'+(st().bikeMax||20)+' min'}
function weeklyTarget(){return st().weeklyTarget||3}
function planEx(day){var p=S.plan[day];return p&&Array.isArray(p.exercises)?p.exercises:[]}
function dayFocus(d){return (S.plan[d]&&S.plan[d].focus)||DAY_FOCUS[d]}
function doneSessions(){return S.sessions.filter(function(s){return s.status==='done'}).sort(function(a,b){return (b.startedAt||0)-(a.startedAt||0)})}
function nextDay(){var d=doneSessions()[0];if(!d)return 'push';var i=DAYS.indexOf(d.day);return DAYS[(i+1)%3]}
function lastOf(day){return doneSessions().find(function(s){return s.day===day})}
function logArr(sess,id){return (sess.log&&sess.log[id])||[]}
function loggedSets(sess,id){return logArr(sess,id).filter(Boolean)}
function lastFor(id,excludeId){var ds=doneSessions();for(var i=0;i<ds.length;i++){var s=ds[i];if(s.id===excludeId)continue;if(loggedSets(s,id).length)return {s:s,sets:logArr(s,id)}}return null}
function totalSets(exs){return (exs||[]).filter(function(e){return !e.optional}).reduce(function(a,e){return a+(e.sets||0)},0)}
function estimate(exs){var t=0;(exs||[]).forEach(function(e){if(e.optional)return;var rest=e.superset?15:(e.rest||60);t+=e.sets*(40+rest)+45});return Math.max(5,Math.round(t/300)*5)}
function doneCount(sess,ex){return logArr(sess,ex.id).slice(0,ex.sets).filter(Boolean).length}
function exDone(sess,ex){return doneCount(sess,ex)>=ex.sets}
function setsDone(sess){return (sess.exercises||[]).filter(function(e){return !e.optional}).reduce(function(a,e){return a+doneCount(sess,e)},0)}
function minBanked(sess){var req=(sess.exercises||[]).filter(function(e){return !e.optional}).slice(0,3);return req.length>0&&req.every(function(e){return exDone(sess,e)})}
function hintFor(ex,excludeId){
  if(ex.bw||ex.repMax==null)return null;var last=lastFor(ex.id,excludeId);if(!last)return null;
  var a=last.sets.slice(0,ex.sets);if(a.length<ex.sets||a.some(function(x){return !x}))return null;
  var w=a[0].w;if(w==null)return null;
  if(!a.every(function(x){return x.w===w&&x.r>=ex.repMax}))return null;
  return {from:w,to:r2(w+(ex.step||2.5))};
}
function bikeStats(b){
  if(!b)return '';var p=[b.mins+' min'];
  if(b.km!=null)p.push(kg(b.km)+' km');if(b.watts!=null)p.push(b.watts+' W avg');if(b.avgHr!=null)p.push(b.avgHr+' bpm avg');if(b.level!=null)p.push('level '+b.level);
  return esc(p.join(' · '));
}
function fmtSets(arr,ex){
  var a=(arr||[]).filter(Boolean);if(!a.length)return '—';
  if(ex.bw||a.every(function(x){return x.w==null}))return a.map(function(x){return x.r}).join(' · ')+' reps';
  var ws={};a.forEach(function(x){ws[x.w]=1});
  if(Object.keys(ws).length===1)return '<b>'+kg(a[0].w)+' kg</b> × '+a.map(function(x){return x.r}).join(' · ');
  return a.map(function(x){return (x.w==null?'BW':kg(x.w))+'×'+x.r}).join(' · ');
}

/* ---------- saving ---------- */
function cacheState(){LS.set('state',{plan:S.plan,settings:S.settings,sessions:S.sessions.slice().sort(function(a,b){return (b.startedAt||0)-(a.startedAt||0)}).slice(0,200)})}
function upsertLocal(sess){var i=S.sessions.findIndex(function(x){return x.id===sess.id});if(i>=0)S.sessions[i]=sess;else S.sessions.unshift(sess)}
function saveActive(){if(!S.active)return;S.active.updatedAt=Date.now();var c=clone(S.active);upsertLocal(c);queue('PUT','/api/sessions/'+encodeURIComponent(c.id),c);cacheState()}
function savePlan(day){var p=S.plan[day];if(!p)return;p.updatedAt=Date.now();queue('PUT','/api/plan/'+day,clone(p));cacheState()}
function saveSettings(){if(!S.settings)S.settings={weeklyTarget:3,bikeDefault:15,bikeMin:10,bikeMax:20};S.settings.updatedAt=Date.now();queue('PUT','/api/settings',clone(S.settings));cacheState()}
function setSettings(obj,noRender){if(!S.settings)S.settings={weeklyTarget:3,bikeDefault:15,bikeMin:10,bikeMax:20};Object.assign(S.settings,obj);saveSettings();if(!noRender)render()}
function setSetting(k,v,noRender){if(!S.settings)S.settings={weeklyTarget:3,bikeDefault:15,bikeMin:10,bikeMax:20};S.settings[k]=v;saveSettings();if(!noRender)render()}

/* ---------- loading ---------- */
function applyPending(){
  // Changes still waiting in the outbox are newer than what the server sent.
  outbox.forEach(function(j){
    if(j.method==='PUT'&&j.url==='/api/settings')S.settings=clone(j.body);
    else if(j.method==='PUT'&&j.url.indexOf('/api/plan/')===0)S.plan[j.url.slice(10)]=clone(j.body);
    else if(j.method==='PUT'&&j.url.indexOf('/api/sessions/')===0)upsertLocal(clone(j.body));
    else if(j.method==='DELETE'&&j.url.indexOf('/api/sessions/')===0){var id=decodeURIComponent(j.url.slice(14));S.sessions=S.sessions.filter(function(s){return s.id!==id})}
  });
}
function loadState(){
  return api('GET','/api/state').then(function(b){
    S.plan=b.plan||{};S.settings=b.settings;S.sessions=(b.sessions||[]).filter(function(s){return !(S.finished[s.id]&&s.status==='active')});
    applyPending();S.loaded=true;S.phase='ready';cacheState();syncActive();render(true);
  },function(e){
    if(e.status===401)return;
    if(!S.loaded){var c=LS.get('state',null);if(c){S.plan=c.plan||{};S.settings=c.settings;S.sessions=c.sessions||[];applyPending();S.loaded=true;S.phase='ready';syncActive();render();toast('Offline. Showing what’s saved on this phone.')}else{S.phase='offline';render()}}
  });
}
var bodyLoading=false;
function loadBody(){if(bodyLoading)return Promise.resolve();bodyLoading=true;return api('GET','/api/body').then(function(b){bodyLoading=false;S.body=b.entries||[];
  outbox.forEach(function(j){if(j.url.indexOf('/api/body/')===0){var d=j.url.slice(10);S.body=S.body.filter(function(x){return x.date!==d});if(j.method==='PUT'&&j.body)S.body.push(Object.assign({date:d},j.body))}});
  S.body.sort(function(a,b){return a.date<b.date?1:-1});LS.set('body',S.body.slice(0,400));render(true)},function(){bodyLoading=false;if(S.body==null)S.body=[]})}
function needLogin(){if(S.phase!=='login'){S.phase='login';render()}}

/* ---------- session state ---------- */
function findEx(id){return S.active?S.active.exercises.find(function(e){return e.id===id}):null}
function exLog(id){var l=S.active.log||(S.active.log={});return l[id]||(l[id]=[])}
function firstOpen(){var s=S.active;var e=s.exercises.find(function(e){return !exDone(s,e)});return e?e.id:'bike'}
function nextOpenFrom(i){var s=S.active,exs=s.exercises,j;for(j=i+1;j<exs.length;j++)if(!exDone(s,exs[j]))return exs[j].id;for(j=0;j<i;j++)if(!exs[j].optional&&!exDone(s,exs[j]))return exs[j].id;return 'bike'}
function setFocus(id){S.focus=id;if(S.active)LS.set('focus',{sid:S.active.id,f:id})}

function syncActive(){
  if(S.active){
    var mine=S.sessions.find(function(s){return s.id===S.active.id});
    if(!mine||mine.status!=='active'){endLocal();return}
    if((mine.updatedAt||0)>(S.active.updatedAt||0))S.active=clone(mine);
    return;
  }
  var remote=S.sessions.find(function(s){return s.status==='active'&&!S.finished[s.id]});
  if(remote){
    S.active=clone(remote);
    var f=LS.get('focus',null);S.focus=(f&&f.sid===remote.id)?f.f:null;
    if(!S.focus||(S.focus!=='bike'&&!findEx(S.focus)))S.focus=firstOpen();
    var r=LS.get('rest',null);if(r&&r.sid===remote.id&&Date.now()-r.end<60000)S.rest=r;
    keepAwake(true);
  }
}
function endLocal(){S.active=null;S.focus=null;S.drafts={};S.addOpen=false;clearRest();LS.del('focus');keepAwake(false)}

function startSession(day){
  if(S.active){S.tab='train';render();return}
  var exs=clone(planEx(day));if(!exs.length){toast('Add some exercises to '+DAY_NAME[day]+' in Plan first.');return}
  var now=Date.now(),id=dkey(new Date())+'_'+day+'_'+now.toString(36);
  S.active={id:id,day:day,date:dkey(new Date()),startedAt:now,finishedAt:null,status:'active',exercises:exs,log:{},notes:{},note:'',bike:{mins:bikeDef(),level:null,done:false},updatedAt:now};
  S.drafts={};S.summary=null;S.tab='train';LS.set('tab','train');setFocus(exs[0].id);
  saveActive();keepAwake(true);render();window.scrollTo(0,0);
}
function finishSession(){
  var s=S.active;if(!s)return;var now=Date.now();
  if(now-s.startedAt>5*3600*1000){
    var ts=[];Object.keys(s.log||{}).forEach(function(k){(s.log[k]||[]).forEach(function(x){if(x&&x.t)ts.push(x.t)})});
    if(s.bike&&s.bike.at)ts.push(s.bike.at);
    now=ts.length?Math.max.apply(null,ts)+5*60000:s.startedAt+60*60000;
  }
  s.status='done';s.finishedAt=now;s.updatedAt=Date.now();
  var copy=clone(s);upsertLocal(copy);queue('PUT','/api/sessions/'+encodeURIComponent(s.id),copy);
  var p=S.plan[s.day];
  if(p&&Array.isArray(p.exercises)){var changed=false;
    s.exercises.forEach(function(e){if(e.bw)return;var a=loggedSets(s,e.id).filter(function(x){return x.w!=null});if(!a.length)return;var w=a[a.length-1].w;var pe=p.exercises.find(function(x){return x.id===e.id});if(pe&&pe.weight!==w){pe.weight=w;changed=true}});
    if(changed)savePlan(s.day);
  }
  S.finished[s.id]=1;S.summary=s.id;endLocal();cacheState();closeSheet();render();window.scrollTo(0,0);
}
function discardSession(){
  var s=S.active;if(!s)return;queue('DELETE','/api/sessions/'+encodeURIComponent(s.id));S.finished[s.id]=1;
  S.sessions=S.sessions.filter(function(x){return x.id!==s.id});
  endLocal();cacheState();closeSheet();render();window.scrollTo(0,0);toast('Session discarded.');
}

function toggleSet(row){
  var s=S.active;if(!s)return;var id=row.dataset.id,k=+row.dataset.k,ex=findEx(id);if(!ex)return;var log=exLog(id);
  if(log[k]){var L=log[k];S.drafts[id+':'+k]={w:L.w,r:L.r};log[k]=null;saveActive();render();return}
  var wi=row.querySelector('[data-f="w"]'),ri=row.querySelector('[data-f="r"]');
  var w=ex.bw?null:num(wi&&wi.value),r=num(ri&&ri.value);
  if(r==null||r<=0){toast('Add your reps first.');if(ri)ri.focus();return}
  while(log.length<k)log.push(null);
  log[k]={w:w==null?null:r2(w),r:Math.round(r),t:Date.now()};
  delete S.drafts[id+':'+k];haptic();
  var before=S.focus;afterLog(ex);saveActive();render();
  if(S.focus!==before)scrollToLift();
}
function afterLog(ex){
  var s=S.active,exs=s.exercises,i=exs.indexOf(ex),next=exs[i+1],prev=exs[i-1];
  var firstSS=ex.superset&&next,secondSS=prev&&prev.superset;
  if(firstSS&&doneCount(s,next)<next.sets){setFocus(next.id);toast('Superset: straight into '+next.name);return}
  var focusId=ex.id;
  if(secondSS&&doneCount(s,prev)<prev.sets)focusId=prev.id;
  else if(doneCount(s,ex)>=ex.sets)focusId=nextOpenFrom(i);
  setFocus(focusId);
  var restS=firstSS?(next.rest||60):(ex.rest||60);
  var fe=focusId==='bike'?null:findEx(focusId);
  var label=fe?'Next: set '+Math.min(doneCount(s,fe)+1,fe.sets)+' · '+fe.name:'Next: static bike';
  startTimer({kind:'rest',secs:restS,label:label});
}
function prefW(ex,k,log,last){
  for(var j=k-1;j>=0;j--){if(log[j]&&log[j].w!=null)return log[j].w;var d=S.drafts[ex.id+':'+j];if(d&&d.w!=null)return d.w}
  if(ex.weight!=null)return ex.weight;
  if(last){var a=last.sets,x=a[k]||a.filter(Boolean).slice(-1)[0];if(x&&x.w!=null)return x.w}
  return null;
}
function prefR(ex,k,last){if(last){var x=last.sets[k];if(x&&x.r)return x.r}return ex.repMax!=null?ex.repMax:null}
function commitInput(inp){
  var row=inp.closest('.set');if(!row||!S.active)return;var id=row.dataset.id,k=+row.dataset.k,f=inp.dataset.f;
  var v=num(inp.value);if(f==='r'&&v!=null)v=Math.round(v);
  var log=exLog(id);
  if(log[k]){log[k][f]=v==null&&f==='w'?null:(v==null?log[k][f]:v);debounce('active',saveActive,700)}
  else{var key=id+':'+k;S.drafts[key]=S.drafts[key]||{};S.drafts[key][f]=v}
}
function scrollToLift(){requestAnimationFrame(function(){var el=document.querySelector('.lift');if(el)el.scrollIntoView({block:'start',behavior:reduceMotion?'auto':'smooth'})})}

/* ---------- timer ---------- */
function startTimer(o){S.rest={kind:o.kind,end:Date.now()+o.secs*1000,total:o.secs,label:o.label,sid:S.active&&S.active.id,ready:false};LS.set('rest',S.rest);renderRest()}
function clearRest(){S.rest=null;LS.del('rest');renderRest()}
function renderRest(){
  var bar=$('#restBar');if(!bar)return;
  if(!S.rest){bar.hidden=true;document.body.classList.remove('has-rest');return}
  bar.hidden=false;document.body.classList.add('has-rest');bar.classList.toggle('ready',!!S.rest.ready);
  $('#restKind').textContent=S.rest.ready?(S.rest.kind==='bike'?'Bike done':'Rest done'):(S.rest.kind==='bike'?'Bike':'Rest');
  $('#restNext').textContent=S.rest.label||'';
  $('#restBtns').hidden=!!S.rest.ready;$('#readyBtns').hidden=!S.rest.ready;
  updateRestTime();
}
function updateRestTime(){
  if(!S.rest)return;var left=(S.rest.end-Date.now())/1000;
  $('#restTime').textContent=S.rest.ready?'Go':clock(left);
  var pct=S.rest.ready?100:Math.min(100,Math.max(0,(1-left/S.rest.total)*100));
  $('#restFill').style.width=pct+'%';
}
setInterval(function(){
  if(S.active){var el=document.getElementById('elapsed');if(el)el.textContent=hms(Date.now()-S.active.startedAt)}
  if(!S.rest)return;
  if(!S.rest.ready){
    if(S.rest.end-Date.now()<=0){
      S.rest.ready=true;S.rest.readyAt=Date.now();LS.set('rest',S.rest);beep();
      if(S.rest.kind==='bike'&&S.active&&S.active.bike&&!S.active.bike.done){S.active.bike.done=true;S.active.bike.at=Date.now();saveActive();render(true);toast('Bike logged. Finish the session when you’re ready.')}
      renderRest();
    } else updateRestTime();
  } else if(Date.now()-(S.rest.readyAt||0)>8000)clearRest();
},250);

/* ---------- render ---------- */
GD.views={};
function render(fromRemote){
  if(fromRemote){var ae=document.activeElement;if(ae&&(view.contains(ae)||ae.closest('#sheet'))&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)&&ae.type!=='checkbox'){S.pendingRender=true;return}}
  S.pendingRender=false;
  var day=S.tab==='food'?'food':S.active?S.active.day:(S.tab==='plan'?S.planDay:nextDay());
  ['push','pull','legs','food'].forEach(function(d){document.body.classList.toggle('d-'+d,d===day)});
  renderHeader();
  var html;
  if(S.phase==='login')html=loginView();
  else if(S.phase==='loading')html='<div class="skel">Loading…</div>';
  else if(S.phase==='offline')html='<div class="empty"><h2>Can’t reach Gym Desk</h2><p>Check your connection. If you sign in through Cloudflare, reload the page to sign in again.</p><button class="btn primary" data-act="reload">Reload</button></div>';
  else html=(GD.views[S.tab]||GD.views.train)();
  view.innerHTML=html;
  renderRest();
  if(GD.afterRender)GD.afterRender();
}
GD.render=render;
function renderHeader(){
  document.querySelectorAll('.nav button').forEach(function(b){if(b.dataset.tab===S.tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  document.querySelector('.nav').hidden=S.phase==='login';
  var strip=$('#strip');
  if(S.active&&S.phase==='ready'){strip.hidden=false;strip.innerHTML='<div class="wrap strip d-'+S.active.day+'"><span class="plate" style="--s:18px"></span><span class="sday">'+DAY_NAME[S.active.day]+'</span><span class="clock" id="elapsed">'+hms(Date.now()-S.active.startedAt)+'</span>'+(S.tab!=='train'?'<button class="btn sm primary" data-act="totrain">Back to session</button>':'')+'</div>'}
  else{strip.hidden=true;strip.innerHTML=''}
  setSync();
}
function loginView(){
  return '<form class="card login" id="loginForm"><h1>Gym Desk</h1><p class="muted">Enter your Gym Desk password.</p>'
    +'<div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>'
    +'<p class="warn" id="loginErr" hidden></p><button class="btn primary block big" type="submit">Sign in</button></form>';
}

GD.views.train=function(){
  if(!DAYS.some(function(d){return planEx(d).length}))return '<div class="empty"><h2>No plan yet</h2><p>Add your Push, Pull and Legs exercises in Plan, or import a backup from Plan → Settings.</p><button class="btn primary" data-act="toplan">Open Plan</button></div>';
  return S.active?activeView():idleView();
};

function idleView(){
  var nd=nextDay(),exs=planEx(nd),last=lastOf(nd),ds=doneSessions(),h='';
  if(S.summary)h+=summaryCard();
  h+='<section class="card next d-'+nd+'">'
    +'<div class="eyebrow">Up next in the rotation</div>'
    +'<div class="next-head"><span class="plate" style="--s:68px"></span><div><h1 class="next-day">'+DAY_NAME[nd]+'</h1><div class="next-focus">'+esc(dayFocus(nd))+'</div></div></div>'
    +'<p class="small">'+exs.filter(function(e){return !e.optional}).length+' exercises · '+totalSets(exs)+' sets · about '+estimate(exs)+' min, then the bike'+(last?' · last done '+fmtDay(last.date):'')+'</p>'
    +'<button class="btn primary block big" data-act="start" data-day="'+nd+'">Start '+DAY_NAME[nd]+'</button>'
    +'<div class="alt"><span>Or start</span>'+DAYS.filter(function(d){return d!==nd}).map(function(d){return '<button class="pick d-'+d+'" data-act="start" data-day="'+d+'"><span class="plate"></span>'+DAY_NAME[d]+'</button>'}).join('')+'</div>'
    +'</section>';
  if(ds[0]){var gap=daysSince(ds[0].date);if(gap>=3)h+='<p class="nudge">It’s been '+gap+' days since your last session. Short on time? The first three exercises count as a session.</p>'}
  h+=consistency();
  h+='<section class="blk d-'+nd+'"><h3 class="sec">In '+DAY_NAME[nd]+'</h3><ol class="plist">'
    +exs.map(function(e,i){return '<li><span class="pn">'+(i+1)+'</span><span class="pname">'+esc(e.name)+(e.optional?' <em class="chip">Optional</em>':'')+(e.superset?' <em class="chip">Superset ↓</em>':'')+'</span><span class="pmeta">'+target(e)+(e.bw?' · bodyweight':e.weight!=null?' · '+kg(e.weight)+' kg':'')+'</span></li>'}).join('')
    +'<li><span class="pn">+</span><span class="pname">Static bike</span><span class="pmeta">'+bikeRange()+' to finish</span></li></ol></section>';
  return h;
}

function summaryCard(){
  var s=S.sessions.find(function(x){return x.id===S.summary});if(!s)return '';
  var dur=s.finishedAt&&s.startedAt?Math.round((s.finishedAt-s.startedAt)/60000):null,total=totalSets(s.exercises),done=setsDone(s),ups=[];
  (s.exercises||[]).forEach(function(e){
    if(e.bw)return;var mine=loggedSets(s,e.id).map(function(x){return x.w}).filter(function(w){return w!=null});if(!mine.length)return;
    var prev=lastFor(e.id,s.id);if(!prev)return;var pv=prev.sets.filter(Boolean).map(function(x){return x.w}).filter(function(w){return w!=null});if(!pv.length)return;
    var top=Math.max.apply(null,mine),ptop=Math.max.apply(null,pv);if(top>ptop)ups.push(esc(e.name)+': '+kg(ptop)+' → '+kg(top)+' kg');
  });
  return '<section class="card done-card d-'+s.day+'"><div class="done-head"><span class="plate" style="--s:28px"></span><h2>'+DAY_NAME[s.day]+' done</h2><button class="x" data-act="dismiss" aria-label="Close summary">×</button></div>'
    +'<p>'+(dur!=null?dur+' min · ':'')+done+' of '+total+' sets'+(s.bike&&s.bike.done?' · bike '+bikeStats(s.bike):'')+(done<total&&minBanked(s)?' · minimum session banked':'')+'</p>'
    +(ups.length?'<ul class="ups">'+ups.map(function(u){return '<li>'+u+'</li>'}).join('')+'</ul>':'')+'</section>';
}

function consistency(){
  var tgt=weeklyTarget(),ds=doneSessions(),now=new Date(),mon=monday(now),today=dkey(now),byDate={},thisWeek=0,strip='';
  ds.forEach(function(s){(byDate[s.date]=byDate[s.date]||[]).push(s.day)});
  for(var i=0;i<7;i++){var d=addDays(mon,i),k=dkey(d),days=byDate[k]||[];thisWeek+=days.length;var isToday=k===today,future=k>today;
    strip+='<div class="wd'+(isToday?' today':'')+(future?' future':'')+'"><span>'+WD[d.getDay()].charAt(0)+'</span>'+(days.length?'<i class="plate d-'+days[days.length-1]+'" title="'+DAY_NAME[days[days.length-1]]+'"></i>':'<i></i>')+'</div>'}
  var weeks=[];for(var w=7;w>=0;w--){var start=addDays(mon,-7*w),end=addDays(start,7);
    weeks.push({start:start,list:ds.filter(function(s){var x=parseKey(s.date);return x>=start&&x<end}).sort(function(a,b){return a.startedAt-b.startedAt})})}
  var maxV=Math.max(tgt+1,Math.max.apply(null,weeks.map(function(x){return x.list.length})));
  var full=weeks.slice(0,7),hit=full.filter(function(x){return x.list.length>=tgt}).length,streak=0;
  for(var j=6;j>=0;j--){if(weeks[j].list.length>=tgt)streak++;else break}
  if(weeks[7].list.length>=tgt)streak++;
  var msg=ds.length?'You hit '+tgt+' sessions in '+hit+' of the last 7 full weeks'+(streak?'. Streak: '+streak+' week'+(streak===1?'':'s')+'.':'.'):'Finish your first session and this starts filling in.';
  return '<section class="blk"><div class="cons-head"><h3 class="sec">This week</h3><div class="cons-count"><b>'+thisWeek+'</b> of '+tgt+'</div></div><div class="week">'+strip+'</div></section>'
    +'<section class="blk"><h3 class="sec">Last 8 weeks</h3><div class="bars-wrap"><div class="bars" style="--max:'+maxV+'">'
    +weeks.map(function(x,i){return '<div class="wcol'+(i===7?' cur':'')+'" title="'+x.list.length+' session'+(x.list.length===1?'':'s')+'">'+x.list.map(function(s){return '<i class="d-'+s.day+'"></i>'}).join('')+'</div>'}).join('')
    +'<div class="tline" style="bottom:'+(tgt/maxV*100)+'%"><span>'+tgt+' a week</span></div></div>'
    +'<div class="blabels">'+weeks.map(function(x,i){return '<span>'+(i===7?'Now':x.start.getDate()+'/'+(x.start.getMonth()+1))+'</span>'}).join('')+'</div></div>'
    +'<p class="small">'+msg+'</p></section>';
}

function activeView(){
  var s=S.active,exs=s.exercises;
  if(!S.focus||(S.focus!=='bike'&&!findEx(S.focus)))S.focus=firstOpen();
  var total=totalSets(exs),done=setsDone(s),curIdx=exs.findIndex(function(e){return e.id===S.focus}),segs='';
  exs.forEach(function(e){if(e.optional)return;for(var i=0;i<e.sets;i++)segs+='<i'+(logArr(s,e.id)[i]?' class="on"':'')+'></i>'});
  var h='<section class="blk d-'+s.day+'">';
  if(Date.now()-s.startedAt>5*3600*1000)h+='<p class="stale">This session started '+fmtDay(s.date)+'. Finish it to keep what you logged, or discard it.</p>';
  h+='<div class="prog"><div class="prog-top"><span>'+(S.focus==='bike'?'Finisher':'Exercise '+(curIdx+1)+' of '+exs.length)+'</span><span>'+done+' of '+total+' sets</span></div><div class="bar">'+segs+'</div>'
    +(minBanked(s)&&done<total?'<div class="banked">Minimum session banked. Anything more is a bonus.</div>':'')+'</div>';
  h+=(S.focus==='bike'?bikeCard():liftCard(exs[curIdx],curIdx));
  h+='</section><section class="blk d-'+s.day+'"><h3 class="sec">Today’s list</h3><ol class="list">'+exs.map(rowHtml).join('')+bikeRow()+'</ol>'
    +(S.addOpen?addForm(s):'<button class="btn ghost block" data-act="sadd">+ Add an exercise to today</button>')+'</section>';
  h+='<section class="blk d-'+s.day+'"><div class="field"><label for="sessNote">Session notes</label><textarea id="sessNote" rows="2" placeholder="Energy, sleep, anything worth remembering">'+esc(s.note||'')+'</textarea></div>'
    +'<div class="end-row"><button class="btn primary" data-act="finish">Finish session</button><button class="btn ghost danger" data-act="discard">Discard</button></div></section>';
  return h;
}

function addForm(s){
  var opts=[];DAYS.forEach(function(d){planEx(d).forEach(function(e){if(!s.exercises.some(function(x){return x.id===e.id}))opts.push({d:d,e:e})})});
  return '<div class="card add-form">'
    +(opts.length?'<div class="field"><label for="addFrom">From your plan</label><select id="addFrom"><option value="">Pick an exercise, or type a new one below</option>'+opts.map(function(o){return '<option value="'+o.d+':'+esc(o.e.id)+'">'+esc(o.e.name)+' ('+DAY_NAME[o.d]+')</option>'}).join('')+'</select></div>':'')
    +'<div class="field"><label for="addName">New exercise</label><input id="addName" type="text" autocomplete="off" placeholder="e.g. Iso-Lateral Incline Press"></div>'
    +'<div class="fgrid"><div class="field"><label for="addW">Weight kg</label><input id="addW" type="text" inputmode="decimal" autocomplete="off" placeholder="–"></div>'
    +'<div class="field"><label for="addSets">Sets</label><input id="addSets" type="text" inputmode="numeric" autocomplete="off" value="3"></div>'
    +'<div class="field"><label for="addReps">Reps</label><input id="addReps" type="text" autocomplete="off" value="8-12"></div></div>'
    +'<label class="toggle" for="addPlan"><input type="checkbox" id="addPlan"> Also add a new one to '+DAY_NAME[s.day]+' for next time</label>'
    +'<div class="fgrid2"><button class="btn ghost" data-act="saddcancel">Cancel</button><button class="btn primary" data-act="saddgo">Add to today</button></div></div>';
}
function addToSession(){
  var s=S.active;if(!s)return;var ex;
  var from=$('#addFrom')&&$('#addFrom').value;
  if(from){var p=from.split(':'),pe=planEx(p[0]).find(function(e){return e.id===p.slice(1).join(':')});if(pe)ex=clone(pe)}
  if(!ex){
    var name=($('#addName').value||'').trim();if(!name){toast('Pick an exercise or type a name.');$('#addName').focus();return}
    var rr=String($('#addReps').value||'').trim().replace('–','-'),repMin=8,repMax=12;
    if(/^max$/i.test(rr)||rr===''){repMin=null;repMax=null}
    else if(rr.indexOf('-')>=0){var pr=rr.split('-').map(function(x){return parseInt(x,10)});repMin=pr[0]||null;repMax=pr[1]||repMin}
    else{repMin=repMax=parseInt(rr,10)||12}
    ex={id:'ex-'+Date.now().toString(36),name:name,sets:Math.max(1,Math.min(10,parseInt($('#addSets').value,10)||3)),repMin:repMin,repMax:repMax,weight:num($('#addW').value),step:2.5,rest:90,cue:'',optional:false,superset:false,bw:false,perSide:false};
    if($('#addPlan').checked){var pl=S.plan[s.day];if(pl&&Array.isArray(pl.exercises)){pl.exercises.push(clone(ex));savePlan(s.day)}}
  }
  ex.optional=false;ex.superset=false;
  var exs=s.exercises,idx=exs.findIndex(function(e){return e.id===S.focus});
  if(idx<0)idx=exs.length-1;else if(exs[idx].superset&&exs[idx+1])idx++;
  exs.splice(idx+1,0,ex);
  S.addOpen=false;setFocus(ex.id);saveActive();render();scrollToLift();toast(ex.name+' added to today.');
}

function liftCard(ex,i){
  var s=S.active,exs=s.exercises,log=exLog(ex.id),last=lastFor(ex.id,s.id),hint=hintFor(ex,s.id),prev=exs[i-1],next=exs[i+1];
  var partner=ex.superset&&next?next:(prev&&prev.superset?prev:null);
  var nLogged=log.slice(0,ex.sets).filter(Boolean).length,rows='';
  for(var k=0;k<ex.sets;k++)rows+=setRow(ex,k,log,last);
  var lastHtml=last
    ?'<div class="last"><span class="eyebrow">Last time · '+fmtDay(last.s.date)+'</span><div>'+fmtSets(last.sets,ex)+'</div>'+(last.s.notes&&last.s.notes[ex.id]?'<div class="last-note">“'+esc(last.s.notes[ex.id])+'”</div>':'')+'</div>'
    :'<div class="last"><span class="eyebrow">Last time</span><div class="muted">Nothing logged yet. '+(ex.bw?'Go for clean, controlled reps.':ex.weight!=null?'Starting from '+kg(ex.weight)+' kg.':'Pick a weight you can move for '+repsTxt(ex)+' clean reps.')+'</div></div>';
  var restTxt=(ex.superset&&next)?'no rest, straight into '+esc(next.name):'rest '+restLabel(ex.rest);
  return '<article class="card lift">'
    +'<div class="lift-top"><span class="lift-num">'+(i+1)+' / '+exs.length+'</span>'+(ex.optional?'<span class="chip">Optional</span>':'')+(partner?'<span class="chip sup">Superset with '+esc(partner.name)+'</span>':'')+'</div>'
    +'<h2 class="lift-name">'+esc(ex.name)+'</h2>'
    +'<div class="lift-target">'+target(ex)+' · '+restTxt+'</div>'
    +(ex.cue?'<p class="cue">'+linkify(ex.cue)+'</p>':'')
    +lastHtml
    +(hint&&nLogged<ex.sets?'<button class="hint" data-act="apply" data-id="'+esc(ex.id)+'" data-w="'+hint.to+'">↑ You hit '+ex.repMax+' on every set last time. Tap to load '+kg(hint.to)+' kg today.</button>':'')
    +'<div class="sets"><div class="set-head"><span>Set</span><span>'+(ex.bw?'':'kg')+'</span><span>Reps</span><span></span></div>'+rows+'</div>'
    +'<div class="set-tools"><button class="link" data-act="addset" data-id="'+esc(ex.id)+'">+ Add a set</button>'+(ex.sets>1&&!log[ex.sets-1]?'<button class="link" data-act="dropset" data-id="'+esc(ex.id)+'">− Remove last set</button>':'')+'</div>'
    +'<div class="field"><label for="note-'+esc(ex.id)+'">Notes</label><textarea id="note-'+esc(ex.id)+'" data-note="'+esc(ex.id)+'" rows="2" placeholder="Seat height, how it felt, left vs right">'+esc((s.notes||{})[ex.id]||'')+'</textarea></div>'
    +'<div class="lift-nav">'+(prev?'<button class="btn ghost" data-act="focus" data-id="'+esc(prev.id)+'" aria-label="Back to '+esc(prev.name)+'">←</button>':'<span></span>')
    +'<button class="btn" data-act="focus" data-id="'+esc(next?next.id:'bike')+'"><span>Next: '+esc(next?next.name:'Static bike')+'</span> →</button></div>'
    +'</article>';
}

function setRow(ex,k,log,last){
  var id=ex.id,L=log[k],dr=S.drafts[id+':'+k]||{};
  var w=L?L.w:(dr.w!==undefined?dr.w:prefW(ex,k,log,last));
  var r=L?L.r:(dr.r!==undefined?dr.r:prefR(ex,k,last));
  var wcell=ex.bw?'<span class="bw">Bodyweight</span>'
    :'<div class="step"><button data-act="w-" aria-label="Less weight">−</button><input id="w-'+esc(id)+'-'+k+'" data-f="w" type="text" inputmode="decimal" autocomplete="off" value="'+esc(kg(w))+'" placeholder="kg" aria-label="Set '+(k+1)+' weight in kilograms"><button data-act="w+" aria-label="More weight">+</button></div>';
  return '<div class="set'+(L?' done':'')+'" data-id="'+esc(id)+'" data-k="'+k+'"><span class="set-n">'+(k+1)+'</span>'+wcell
    +'<div class="step"><button data-act="r-" aria-label="One less rep">−</button><input id="r-'+esc(id)+'-'+k+'" data-f="r" type="text" inputmode="numeric" autocomplete="off" value="'+esc(r==null?'':r)+'" placeholder="reps" aria-label="Set '+(k+1)+' reps"><button data-act="r+" aria-label="One more rep">+</button></div>'
    +'<button class="tick" data-act="tick" aria-pressed="'+(!!L)+'" aria-label="'+(L?'Undo set ':'Log set ')+(k+1)+'">'+CHECK+'</button></div>';
}

function rowHtml(e,i){
  var s=S.active,n=doneCount(s,e),dn=n>=e.sets,cur=S.focus===e.id,a=logArr(s,e.id),dots='';
  for(var k=0;k<e.sets;k++)dots+='<i'+(a[k]?' class="on"':'')+'></i>';
  return '<li><button class="row'+(cur?' current':'')+(dn?' done':'')+'" data-act="focus" data-id="'+esc(e.id)+'"><span class="row-n">'+(dn?CHECK_SM:(i+1))+'</span><span class="row-name">'+esc(e.name)+'<small>'+target(e)+(e.optional?' · optional':'')+(e.superset?' · superset':'')+'</small></span><span class="dots">'+dots+'</span></button></li>';
}
function bikeRow(){
  var b=S.active.bike||{},cur=S.focus==='bike';
  return '<li><button class="row'+(cur?' current':'')+(b.done?' done':'')+'" data-act="focus" data-id="bike"><span class="row-n">'+(b.done?CHECK_SM:'+')+'</span><span class="row-name">Static bike<small>'+(b.done?bikeStats(b)+' done':'Finisher · '+bikeRange())+'</small></span><span class="dots"><i'+(b.done?' class="on"':'')+'></i></span></button></li>';
}
function bikeCard(){
  var s=S.active,b=s.bike||(s.bike={mins:bikeDef(),level:null,done:false}),running=S.rest&&S.rest.kind==='bike'&&!S.rest.ready;
  var opts=[10,12,13,15,18,20];if(opts.indexOf(b.mins)<0)opts.push(b.mins),opts.sort(function(x,y){return x-y});
  var fld=function(id,label,val,mode){return '<div class="field"><label for="'+id+'">'+label+'</label><input id="'+id+'" type="text" inputmode="'+mode+'" autocomplete="off" value="'+esc(val==null?'':val)+'" placeholder="optional"></div>'};
  return '<article class="card lift">'
    +'<div class="lift-top"><span class="lift-num">Finisher</span></div>'
    +'<h2 class="lift-name">Static bike</h2>'
    +'<div class="lift-target">'+bikeRange()+' to close out the session</div>'
    +'<div class="field"><span class="flabel">Minutes</span><div class="chips">'+opts.map(function(m){return '<button class="pick'+(b.mins===m?' on':'')+'" data-act="bmins" data-m="'+m+'" aria-pressed="'+(b.mins===m)+'">'+m+'</button>'}).join('')+'</div></div>'
    +'<div class="fgrid2"><div class="field"><label for="bLevel">Level</label><div class="step"><button data-act="bl-" aria-label="Lower level">−</button><input id="bLevel" type="text" inputmode="numeric" autocomplete="off" value="'+esc(b.level==null?'':b.level)+'" placeholder="–"><button data-act="bl+" aria-label="Higher level">+</button></div></div>'
    +fld('bKm','Distance km',b.km,'decimal')+fld('bW','Avg watts',b.watts,'numeric')+fld('bHr','Avg heart rate',b.avgHr,'numeric')+'</div>'
    +'<div class="bike-btns">'+(b.done
      ?'<button class="btn ghost" data-act="bundo">Undo bike</button><button class="btn primary" data-act="finish">Finish session</button>'
      :'<button class="btn" data-act="btimer"'+(running?' disabled':'')+'>'+(running?'Timer running':'Start '+b.mins+':00 timer')+'</button><button class="btn primary" data-act="bdone">Mark done</button>')+'</div>'
    +'</article>';
}

/* ---------- plan ---------- */
GD.views.plan=function(){
  var day=S.planDay,exs=planEx(day);
  var h='<div class="seg" role="group" aria-label="Day">'+DAYS.map(function(d){return '<button class="d-'+d+'" data-act="pday" data-day="'+d+'" aria-pressed="'+(d===day)+'"><span class="plate"></span>'+DAY_NAME[d]+'</button>'}).join('')+'</div>';
  h+='<section class="blk d-'+day+'"><div><div class="pm-focus">'+esc(dayFocus(day))+'</div><p class="small">'+exs.length+' exercises · '+totalSets(exs)+' working sets · about '+estimate(exs)+' min plus the bike</p></div>';
  if(S.active)h+='<p class="note">You have a session in progress. Changes here apply from your next one.</p>';
  if(!exs.length)h+='<p class="muted">No exercises in '+DAY_NAME[day]+' yet.</p>';
  h+='<ol class="plan-list">'+exs.map(function(e,i){return pexHtml(e,i,exs.length)}).join('')+'</ol>';
  h+='<button class="btn ghost block" data-act="padd">+ Add exercise</button></section>';
  h+=settingsHtml();
  return h;
};
function pexSummary(e,i){return '<span class="row-n">'+(i+1)+'</span><span class="row-name">'+esc(e.name||'Untitled')+'<small>'+target(e)+(e.bw?' · bodyweight':e.weight!=null?' · '+kg(e.weight)+' kg':' · weight not set')+' · '+(e.superset?'superset':'rest '+restLabel(e.rest))+(e.optional?' · optional':'')+'</small></span>'}
function pexHtml(e,i,n){
  var open=S.planOpen===e.id,id=esc(e.id);
  var h='<li class="pex'+(open?' open':'')+'"><button class="pex-row" data-act="popen" data-id="'+id+'" aria-expanded="'+open+'">'+pexSummary(e,i)+'<span class="chev" aria-hidden="true">'+(open?'−':'+')+'</span></button>';
  if(open){
    var f=function(k,label,val,attrs){return '<div class="field"><label for="pf-'+k+'-'+id+'">'+label+'</label><input id="pf-'+k+'-'+id+'" data-pf="'+k+'" data-id="'+id+'" type="text" autocomplete="off" value="'+esc(val==null?'':val)+'" '+(attrs||'')+'></div>'};
    var tg=function(k,label,on,dis){return '<label class="toggle" for="pf-'+k+'-'+id+'"><input type="checkbox" id="pf-'+k+'-'+id+'" data-pf="'+k+'" data-id="'+id+'"'+(on?' checked':'')+(dis?' disabled':'')+'>'+label+'</label>'};
    h+='<div class="pex-edit">'+f('name','Name',e.name)
      +'<div class="fgrid">'+f('sets','Sets',e.sets,'inputmode="numeric"')+f('repMin','Reps from',e.repMin,'inputmode="numeric" placeholder="max"')+f('repMax','Reps to',e.repMax,'inputmode="numeric" placeholder="max"')+'</div>'
      +'<div class="fgrid">'+f('weight','Weight kg',e.weight,'inputmode="decimal" placeholder="–"')+f('step','Jump kg',e.step==null?2.5:e.step,'inputmode="decimal"')
      +'<div class="field"><label for="pf-rest-'+id+'">Rest</label><select id="pf-rest-'+id+'" data-pf="rest" data-id="'+id+'">'+[45,60,90,120,150,180].map(function(v){return '<option value="'+v+'"'+((e.rest||60)===v?' selected':'')+'>'+restLabel(v)+'</option>'}).join('')+'</select></div></div>'
      +'<div class="field"><label for="pf-cue-'+id+'">Cue</label><textarea id="pf-cue-'+id+'" data-pf="cue" data-id="'+id+'" rows="2" placeholder="Form reminder, seat setting or a how-to link">'+esc(e.cue||'')+'</textarea></div>'
      +tg('optional','Optional (doesn’t count toward the session)',e.optional)
      +tg('superset','Superset with the next exercise',e.superset,i===n-1)
      +tg('bw','Bodyweight, no kg',e.bw)
      +tg('perSide','Reps are per side',e.perSide)
      +'<div class="pex-actions"><button class="btn ghost sm" data-act="pup" data-id="'+id+'"'+(i===0?' disabled':'')+'>Move up</button><button class="btn ghost sm" data-act="pdown" data-id="'+id+'"'+(i===n-1?' disabled':'')+'>Move down</button>'
      +(S.confirmDel===e.id?'<span class="confirm">Remove it? <button class="btn sm danger-fill" data-act="pdelyes" data-id="'+id+'">Remove</button><button class="btn ghost sm" data-act="cancelDel">Keep</button></span>':'<button class="btn ghost sm danger" data-act="pdel" data-id="'+id+'">Remove</button>')
      +'</div></div>';
  }
  return h+'</li>';
}
function settingsHtml(){
  var s=st();
  return '<section class="blk"><h3 class="sec">Settings</h3><div class="card settings">'
    +'<div class="srow"><div><b>Weekly target</b><div class="small">Training sessions per week</div></div><div class="step mini"><button data-act="tgt-" aria-label="Lower target">−</button><output>'+weeklyTarget()+'</output><button data-act="tgt+" aria-label="Raise target">+</button></div></div>'
    +'<div class="srow"><div><b>Bike finisher</b><div class="small">Default minutes on the static bike</div></div><div class="step mini"><button data-act="bdef-" aria-label="Fewer minutes">−</button><output>'+bikeDef()+'</output><button data-act="bdef+" aria-label="More minutes">+</button></div></div>'
    +'<div class="srow"><div><b>Work out targets</b><div class="small">From height, weight, age, activity and goal</div></div><button class="btn sm primary" data-act="copen">Open</button></div>'
    +'<div class="srow"><label for="setKcal"><b>Calorie target</b><span class="small" style="display:block">kcal a day</span></label><div class="step mini wide"><input id="setKcal" data-setting="kcalTarget" type="text" inputmode="numeric" value="'+esc(s.kcalTarget||'')+'" placeholder="–"></div></div>'
    +'<div class="srow"><label for="setProt"><b>Protein target</b><span class="small" style="display:block">grams a day</span></label><div class="step mini wide"><input id="setProt" data-setting="proteinTarget" type="text" inputmode="numeric" value="'+esc(s.proteinTarget||'')+'" placeholder="–"></div></div>'
    +'<div class="srow"><label for="soundT"><b>Beep when rest ends</b><span class="small" style="display:block">This phone only</span></label><input type="checkbox" id="soundT" style="width:22px;height:22px;accent-color:var(--day)"'+(S.sound?' checked':'')+'></div>'
    +(S.installPrompt?'<div class="srow"><div><b>Install app</b><div class="small">Adds Gym Desk to your home screen</div></div><button class="btn sm primary" data-act="install">Install</button></div>':'')
    +afcdRow()
    +'<div class="srow"><div><b>Backup</b><div class="small">Everything in one JSON file</div></div><a class="btn sm ghost" href="/api/export" download>Download</a></div>'
    +'<div class="srow"><div><b>Import</b><div class="small">A Gym Desk backup or export file</div></div><label class="btn sm ghost" for="importFile">Choose file</label><input id="importFile" type="file" accept="application/json,.json" hidden></div>'
    +(GD.me&&GD.me.passwordRequired?'<div class="srow"><div><b>Sign out</b><div class="small">On this device</div></div><button class="btn sm ghost" data-act="logout">Sign out</button></div>':'')
    +'</div><p class="small">Gym Desk '+esc((GD.me&&GD.me.version)||GD.clientVersion||'')+(GD.me&&GD.clientVersion&&GD.me.version!==GD.clientVersion?' · this phone has '+esc(GD.clientVersion)+', close and reopen to update':'')+'</p></section>';
}
function afcdRow(){
  if(S.afcd===undefined){S.afcd=null;api('GET','/api/afcd').then(function(st){S.afcd=st;if(S.tab==='plan')render(true)},function(){})}
  var a=S.afcd,txt;
  if(!a)txt='Checking…';
  else if(a.disabled)txt='Turned off (AFCD=off)';
  else if(a.loading)txt='Downloading from FSANZ…';
  else if(a.count)txt=a.count.toLocaleString()+' foods from FSANZ'+(a.release?' ('+esc(a.release)+')':'')+(a.ok===false?'. Last update failed: '+esc(a.error):'');
  else txt=a.error?'Not loaded: '+esc(a.error):'Not loaded yet';
  return '<div class="srow"><div><b>Australian foods</b><div class="small">'+txt+'</div></div><div class="chips" style="flex:none">'
    +(a&&!a.disabled&&!a.loading?'<button class="btn sm ghost" data-act="afcdretry">'+(a.count?'Update':'Retry')+'</button>':'')
    +'<label class="btn sm ghost" for="afcdFile">Upload</label><input id="afcdFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></div></div>';
}
function onPlanField(el){
  var p=S.plan[S.planDay];if(!p)return;var e=p.exercises.find(function(x){return x.id===el.dataset.id});if(!e)return;
  var k=el.dataset.pf,v;
  if(el.type==='checkbox')v=el.checked;
  else if(k==='name'){v=el.value.trim()||e.name}
  else if(k==='cue')v=el.value.trim();
  else if(k==='sets')v=Math.max(1,Math.min(10,parseInt(el.value,10)||e.sets||3));
  else if(k==='repMin'||k==='repMax'){v=el.value.trim()===''?null:Math.max(1,Math.min(100,parseInt(el.value,10)||1))}
  else if(k==='weight')v=num(el.value);
  else if(k==='step')v=num(el.value)||2.5;
  else if(k==='rest')v=parseInt(el.value,10)||60;
  if(e[k]===v)return;
  e[k]=v;
  if(k==='repMin'&&v!=null&&e.repMax!=null&&v>e.repMax)e.repMax=v;
  if(k==='repMax'&&v!=null&&e.repMin!=null&&v<e.repMin)e.repMin=v;
  savePlan(S.planDay);
  if(el.type==='checkbox'){render();return}
  var btn=view.querySelector('.pex-row[data-id="'+CSS.escape(e.id)+'"]');
  if(btn){var i=p.exercises.indexOf(e);btn.innerHTML=pexSummary(e,i)+'<span class="chev" aria-hidden="true">−</span>'}
}

/* ---------- log ---------- */
GD.views.log=function(){
  if(S.body==null)loadBody();
  var ds=doneSessions(),h=bodyCard();
  if(!ds.length)return h+'<div class="empty"><h2>No sessions yet</h2><p>Finished sessions land here with every set, your notes and the bike. Start one from Train.</p><button class="btn primary" data-act="totrain">Go to Train</button></div>';
  var now=new Date(),month=ds.filter(function(s){var d=parseKey(s.date);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()}).length;
  var bike=ds.reduce(function(a,s){return a+(s.bike&&s.bike.done?(s.bike.mins||0):0)},0);
  h+='<div class="stats"><div class="stat"><b>'+ds.length+'</b><span>sessions</span></div><div class="stat"><b>'+month+'</b><span>this month</span></div><div class="stat"><b>'+bike+'</b><span>bike minutes</span></div></div>';
  h+='<section class="blk"><h3 class="sec">Sessions</h3><ul class="sess">'+ds.map(sessHtml).join('')+'</ul></section>';
  h+=trends();
  return h;
};
function bodyCard(){
  var list=(S.body||[]).filter(function(x){return x.weight!=null}),today=dkey(new Date()),todays=(S.body||[]).find(function(x){return x.date===today});
  var latest=list[0],h='<section class="blk"><h3 class="sec">Bodyweight</h3><div class="card body-card">';
  if(latest){
    var avg=avgAround(list,0),old=list.find(function(x){return daysSince(x.date)>=28}),delta=old&&avg!=null?r1(avg-avgAround(list,list.indexOf(old))):null;
    h+='<div class="body-top"><div class="body-now"><b>'+kg(avg!=null?r1(avg):latest.weight)+'</b><span>kg, 7-day average</span></div>'
      +(delta!=null?'<div class="body-delta">'+(delta>0?'+':'')+delta+' kg vs 4 weeks ago</div>':'')+'</div>'+weightChart(list);
  } else h+='<p class="small">Weigh yourself a few mornings a week, after the toilet and before breakfast. The 7-day average smooths out water and food swings.</p>';
  h+='<div class="body-entry"><div class="field"><label for="bwIn">Today’s weight (kg)</label><input id="bwIn" type="text" inputmode="decimal" autocomplete="off" value="'+esc(todays&&todays.weight!=null?todays.weight:'')+'" placeholder="e.g. 74.6"></div><button class="btn primary" data-act="bwsave">'+(todays?'Update':'Save')+'</button></div>'
    +'</div></section>';
  return h;
}
function avgAround(list,i){var base=parseKey(list[i].date),vals=list.slice(i).filter(function(x){return (base-parseKey(x.date))/86400000<7}).map(function(x){return x.weight});return vals.length?vals.reduce(function(a,b){return a+b},0)/vals.length:null}
function weightChart(list){
  var pts=list.filter(function(x){return daysSince(x.date)<=90}).slice().reverse();if(pts.length<2)return '';
  var W=320,H=120,pl=30,pr=8,pt=8,pb=18,start=parseKey(pts[0].date),span=Math.max(1,(parseKey(pts[pts.length-1].date)-start)/86400000);
  var ws=pts.map(function(x){return x.weight}),mn=Math.floor(Math.min.apply(null,ws)-0.5),mx=Math.ceil(Math.max.apply(null,ws)+0.5);
  var X=function(d){return pl+((parseKey(d)-start)/86400000)/span*(W-pl-pr)},Y=function(v){return pt+(mx-v)/(mx-mn)*(H-pt-pb)};
  var desc=pts.slice().reverse(),avgPts=pts.map(function(x){return X(x.date).toFixed(1)+','+Y(avgAround(desc,desc.indexOf(x))).toFixed(1)});
  var g='';[mn,(mn+mx)/2,mx].forEach(function(v){g+='<line class="grid" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'"/><text x="'+(pl-6)+'" y="'+(Y(v)+4).toFixed(1)+'" text-anchor="end">'+r1(v)+'</text>'});
  var last=avgPts[avgPts.length-1].split(',');
  return '<svg class="wchart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Bodyweight, last 90 days">'+g
    +pts.map(function(x){return '<circle class="raw" cx="'+X(x.date).toFixed(1)+'" cy="'+Y(x.weight).toFixed(1)+'" r="2.5"/>'}).join('')
    +'<polyline class="avg" points="'+avgPts.join(' ')+'"/><circle class="end" cx="'+last[0]+'" cy="'+last[1]+'" r="4"/>'
    +'<text x="'+pl+'" y="'+(H-3)+'">'+fmtDay(pts[0].date)+'</text><text x="'+(W-pr)+'" y="'+(H-3)+'" text-anchor="end">'+fmtDay(pts[pts.length-1].date)+'</text></svg>';
}
function saveBody(){
  var v=num($('#bwIn').value);if(v==null||v<25||v>300){toast('Enter your weight in kg.');return}
  var d=dkey(new Date());S.body=(S.body||[]).filter(function(x){return x.date!==d});S.body.unshift({date:d,weight:r1(v)});
  queue('PUT','/api/body/'+d,{weight:r1(v)});LS.set('body',S.body.slice(0,400));render();toast('Saved '+r1(v)+' kg.');
}
function sessHtml(s){
  var open=S.logOpen===s.id,dur=s.finishedAt&&s.startedAt?Math.round((s.finishedAt-s.startedAt)/60000):null,total=totalSets(s.exercises),done=setsDone(s);
  var h='<li class="sess-item d-'+s.day+(open?' open':'')+'"><button class="sess-row" data-act="lopen" data-id="'+esc(s.id)+'" aria-expanded="'+open+'"><span class="plate" style="--s:22px"></span><span class="row-name">'+fmtDay(s.date)+' · '+DAY_NAME[s.day]+'<small>'+(dur!=null?dur+' min · ':'')+done+'/'+total+' sets'+(s.bike&&s.bike.done?' · bike '+s.bike.mins+' min':'')+'</small></span>'+(done<total&&minBanked(s)?'<span class="chip">Minimum</span>':'<span></span>')+'</button>';
  if(open){
    h+='<div class="sess-detail">'+(s.exercises||[]).map(function(e){var a=loggedSets(s,e.id);return '<div class="sd-row"><span>'+esc(e.name)+'</span><span>'+(a.length?fmtSets(logArr(s,e.id),e):'<span class="muted">skipped</span>')+'</span></div>'+(s.notes&&s.notes[e.id]?'<div class="sd-note">'+esc(s.notes[e.id])+'</div>':'')}).join('')
      +(s.bike?'<div class="sd-row"><span>Static bike</span><span>'+(s.bike.done?bikeStats(s.bike):'<span class="muted">skipped</span>')+'</span></div>':'')
      +(s.note?'<div class="sd-note">'+esc(s.note)+'</div>':'')
      +'<div class="sd-actions">'+(S.confirmDel===s.id?'<span class="confirm">Delete this session for good? <button class="btn sm danger-fill" data-act="ldelyes" data-id="'+esc(s.id)+'">Delete</button><button class="btn ghost sm" data-act="cancelDel">Keep</button></span>':'<button class="btn ghost sm danger" data-act="ldel" data-id="'+esc(s.id)+'">Delete session</button>')+'</div></div>';
  }
  return h+'</li>';
}
function trends(){
  var ds=doneSessions().slice().reverse(),groups='',any=false;
  DAYS.forEach(function(day){
    var exs=planEx(day).filter(function(e){return !e.bw});if(!exs.length)return;var rows='';
    exs.forEach(function(e){
      var pts=[];ds.forEach(function(s){var a=loggedSets(s,e.id).map(function(x){return x.w}).filter(function(w){return w!=null});if(a.length)pts.push(Math.max.apply(null,a))});
      var v=pts.slice(-10);if(v.length>1)any=true;
      rows+='<div class="trend"><span class="row-name">'+esc(e.name)+'</span>'+spark(v)+'<span class="tv">'+(v.length?kg(v[v.length-1])+' kg':'–')+'</span></div>';
    });
    groups+='<div class="trend-group d-'+day+'"><div class="tg-head"><span class="plate" style="--s:18px"></span>'+DAY_NAME[day]+'</div>'+rows+'</div>';
  });
  return '<section class="blk"><h3 class="sec">Top weight per session</h3>'+(any?'':'<p class="small">Lines appear once a lift has two sessions logged.</p>')+groups+'</section>';
}
function spark(v){
  if(v.length<2)return '<span class="spark-empty">'+(v.length?'1 session':'no data')+'</span>';
  var W=96,H=28,p=3,mn=Math.min.apply(null,v),mx=Math.max.apply(null,v),rg=mx-mn||1;
  var xs=function(i){return p+i*(W-2*p)/(v.length-1)},ys=function(x){return mx===mn?H/2:H-p-(x-mn)/rg*(H-2*p)};
  var pts=v.map(function(x,i){return xs(i).toFixed(1)+','+ys(x).toFixed(1)}).join(' '),lx=xs(v.length-1).toFixed(1),ly=ys(v[v.length-1]).toFixed(1);
  return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" aria-hidden="true"><polygon points="'+p+','+H+' '+pts+' '+lx+','+H+'"/><polyline points="'+pts+'"/><circle cx="'+lx+'" cy="'+ly+'" r="3"/></svg>';
}

/* ---------- sheets ---------- */
function openSheet(html,cls){
  var sh=$('#sheet');sh.innerHTML='<div class="scrim" data-act="scrim"><div class="sheet '+(cls||'')+'" role="dialog" aria-modal="true" aria-labelledby="sheetT">'+html+'</div></div>';sh.hidden=false;
  var b=sh.querySelector('.sheet input, .sheet button');if(b)b.focus();
}
function closeSheet(){var sh=$('#sheet');sh.hidden=true;sh.innerHTML='';if(GD.onSheetClose)GD.onSheetClose()}
function sessionSheet(kind){
  var s=S.active;if(!s)return;var total=totalSets(s.exercises),done=setsDone(s),h;
  if(kind==='finish'){
    h='<h2 id="sheetT">Finish '+DAY_NAME[s.day]+'?</h2><p>'+done+' of '+total+' sets logged'+(s.bike&&s.bike.done?', bike done.':', bike not logged.')
      +(done<total&&minBanked(s)?' The first three exercises are done, so this counts as a session.':'')+(done===0?' Nothing is logged yet, so this saves an empty session.':'')+'</p>'
      +'<div class="sheet-btns"><button class="btn primary block big" data-act="sfinish">Finish and save</button><button class="btn ghost block" data-act="sclose">Keep going</button></div>';
  } else {
    h='<h2 id="sheetT">Discard this session?</h2><p>This deletes '+done+' logged set'+(done===1?'':'s')+' from '+fmtDay(s.date)+'. It can’t be undone.</p>'
      +'<div class="sheet-btns"><button class="btn danger-fill block big" data-act="sdiscard">Discard session</button><button class="btn ghost block" data-act="sclose">Keep it</button></div>';
  }
  openSheet(h,'d-'+s.day);
}

/* ---------- actions ---------- */
var ACT=GD.ACT={
  start:function(t){startSession(t.dataset.day)},
  focus:function(t){setFocus(t.dataset.id);render();scrollToLift()},
  tick:function(t){toggleSet(t.closest('.set'))},
  'w-':step,'w+':step,'r-':step,'r+':step,
  apply:function(t){var ex=findEx(t.dataset.id);if(!ex)return;var w=num(t.dataset.w),log=exLog(ex.id);for(var k=0;k<ex.sets;k++){if(!log[k]){var key=ex.id+':'+k;S.drafts[key]=S.drafts[key]||{};S.drafts[key].w=w}}render()},
  addset:function(t){var ex=findEx(t.dataset.id);if(!ex)return;ex.sets=Math.min(10,ex.sets+1);saveActive();render()},
  dropset:function(t){var ex=findEx(t.dataset.id);if(!ex||ex.sets<2)return;var log=exLog(ex.id);if(log[ex.sets-1])return;log.length=Math.min(log.length,ex.sets-1);ex.sets--;saveActive();render()},
  sadd:function(){S.addOpen=true;render();var el=$('#addFrom')||$('#addName');if(el)el.focus()},
  saddcancel:function(){S.addOpen=false;render()},
  saddgo:addToSession,
  finish:function(){sessionSheet('finish')},
  discard:function(){sessionSheet('discard')},
  sfinish:finishSession,sdiscard:discardSession,sclose:closeSheet,
  scrim:function(t,e){if(e.target===t)closeSheet()},
  dismiss:function(){S.summary=null;render()},
  totrain:function(){goTab('train')},
  toplan:function(){goTab('plan')},
  reload:function(){location.reload()},
  bmins:function(t){S.active.bike.mins=+t.dataset.m;saveActive();render()},
  'bl-':bikeLevel,'bl+':bikeLevel,
  btimer:function(){var b=S.active.bike;startTimer({kind:'bike',secs:b.mins*60,label:'Static bike · '+b.mins+' min'});render()},
  bdone:function(){var b=S.active.bike;b.done=true;b.at=Date.now();if(S.rest&&S.rest.kind==='bike')clearRest();saveActive();render();toast('Bike logged. Finish the session when you’re ready.')},
  bundo:function(){S.active.bike.done=false;saveActive();render()},
  rminus:function(){if(!S.rest)return;S.rest.end=Math.max(Date.now()+1000,S.rest.end-15000);LS.set('rest',S.rest);updateRestTime()},
  rplus:function(){if(!S.rest)return;S.rest.end+=15000;var left=(S.rest.end-Date.now())/1000;if(left>S.rest.total)S.rest.total=Math.ceil(left);LS.set('rest',S.rest);updateRestTime()},
  rskip:function(){clearRest()},
  pday:function(t){S.planDay=t.dataset.day;LS.set('planDay',S.planDay);S.planOpen=null;S.confirmDel=null;render()},
  popen:function(t){S.planOpen=S.planOpen===t.dataset.id?null:t.dataset.id;S.confirmDel=null;render()},
  padd:function(){
    var day=S.planDay;if(!S.plan[day])S.plan[day]={name:DAY_NAME[day],focus:DAY_FOCUS[day],order:DAYS.indexOf(day)+1,exercises:[]};
    var id='ex-'+Date.now().toString(36);
    S.plan[day].exercises.push({id:id,name:'New exercise',sets:3,repMin:8,repMax:12,weight:null,step:2.5,rest:90,cue:'',optional:false,superset:false,bw:false,perSide:false});
    S.planOpen=id;savePlan(day);render();
    var inp=document.getElementById('pf-name-'+id);if(inp){inp.focus();inp.select()}
  },
  pup:function(t){movePlan(t.dataset.id,-1)},pdown:function(t){movePlan(t.dataset.id,1)},
  pdel:function(t){S.confirmDel=t.dataset.id;render()},
  pdelyes:function(t){var p=S.plan[S.planDay];if(!p)return;p.exercises=p.exercises.filter(function(e){return e.id!==t.dataset.id});var last=p.exercises[p.exercises.length-1];if(last)last.superset=false;S.confirmDel=null;S.planOpen=null;savePlan(S.planDay);render()},
  cancelDel:function(){S.confirmDel=null;render()},
  'tgt-':function(){setSetting('weeklyTarget',Math.max(1,weeklyTarget()-1))},
  'tgt+':function(){setSetting('weeklyTarget',Math.min(7,weeklyTarget()+1))},
  'bdef-':function(){setSetting('bikeDefault',Math.max(5,bikeDef()-1))},
  'bdef+':function(){setSetting('bikeDefault',Math.min(45,bikeDef()+1))},
  lopen:function(t){S.logOpen=S.logOpen===t.dataset.id?null:t.dataset.id;S.confirmDel=null;render()},
  ldel:function(t){S.confirmDel=t.dataset.id;render()},
  ldelyes:function(t){var id=t.dataset.id;queue('DELETE','/api/sessions/'+encodeURIComponent(id));S.sessions=S.sessions.filter(function(s){return s.id!==id});if(S.summary===id)S.summary=null;S.confirmDel=null;S.logOpen=null;cacheState();render();toast('Session deleted.')},
  bwsave:saveBody,
  install:function(){var p=S.installPrompt;if(!p)return;p.prompt();p.userChoice.finally(function(){S.installPrompt=null;render()})},
  afcdretry:function(){S.afcd=Object.assign({},S.afcd,{loading:true});render();api('POST','/api/afcd/refresh').then(function(st){S.afcd=st;render();toast(st.ok?'Loaded '+st.count+' Australian foods.':'Couldn’t update: '+st.error)},function(e){S.afcd=undefined;render();toast(e.message)})},
  logout:function(){api('POST','/api/logout').finally(function(){S.phase='login';render()})},
  syncinfo:function(){
    var msg=!S.online?(navigator.onLine?'Gym Desk can’t reach your server. If you sign in through Cloudflare, your sign-in may have expired: reload to sign in again.':'You’re offline. Changes are kept on this phone and sent when you’re back online.'):outbox.length?'Sending '+outbox.length+' change'+(outbox.length===1?'':'s')+'…':'Everything is saved to your server.';
    openSheet('<h2 id="sheetT">'+(S.online?'Sync':'Offline')+'</h2><p>'+msg+'</p><div class="sheet-btns">'+(!S.online?'<button class="btn primary block" data-act="reload">Reload</button>':'')+'<button class="btn ghost block" data-act="sclose">Close</button></div>');
  }
};
function goTab(t){S.tab=t;LS.set('tab',t);S.confirmDel=null;render();window.scrollTo(0,0);if(GD.onTab)GD.onTab(t)}
GD.goTab=goTab;
function step(t){
  var row=t.closest('.set');if(!row)return;var a=t.dataset.act,f=a.charAt(0),inp=row.querySelector('input[data-f="'+f+'"]');if(!inp)return;
  var ex=findEx(row.dataset.id);if(!ex)return;var v=num(inp.value),up=a.charAt(1)==='+';
  if(f==='w'){var stp=ex.step||2.5;v=r2(Math.max(0,(v==null?(ex.weight||0):v)+(up?stp:-stp)));inp.value=kg(v)}
  else{v=Math.max(0,(v==null?0:v)+(up?1:-1));inp.value=v}
  commitInput(inp);
}
function bikeLevel(t){var b=S.active.bike,inp=document.getElementById('bLevel'),v=num(inp.value);v=Math.max(1,Math.min(30,(v==null?(t.dataset.act==='bl+'?0:2):v)+(t.dataset.act==='bl+'?1:-1)));inp.value=v;b.level=v;debounce('active',saveActive,700)}
function movePlan(id,dir){var p=S.plan[S.planDay];if(!p)return;var a=p.exercises,i=a.findIndex(function(e){return e.id===id}),j=i+dir;if(i<0||j<0||j>=a.length)return;var x=a[i];a[i]=a[j];a[j]=x;a[a.length-1].superset=false;savePlan(S.planDay);render()}

function importFile(file){
  var rd=new FileReader();
  rd.onload=function(){
    var data;try{data=JSON.parse(rd.result)}catch(e){toast('That file isn’t valid JSON.');return}
    api('POST','/api/import',data).then(function(b){var c=b.counts||{};toast('Imported '+(c.sessions||0)+' sessions, '+(c.plan||0)+' plan days, '+(c.foodLog||0)+' food entries.');S.body=null;loadState();if(GD.onImported)GD.onImported()},function(e){toast(e.message)});
  };
  rd.readAsText(file);
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  primeAudio();
  var tab=e.target.closest('.nav [data-tab]');
  if(tab){goTab(tab.dataset.tab);return}
  var t=e.target.closest('[data-act]');if(!t||t.disabled)return;
  var fn=ACT[t.dataset.act];if(fn)fn(t,e);
});
document.addEventListener('input',function(e){
  var el=e.target;
  if(el.dataset&&el.dataset.f&&el.closest('.set')){commitInput(el);return}
  if(el.dataset&&el.dataset.note&&S.active){S.active.notes=S.active.notes||{};S.active.notes[el.dataset.note]=el.value;debounce('active',saveActive,800);return}
  if(el.id==='sessNote'&&S.active){S.active.note=el.value;debounce('active',saveActive,800);return}
  var BF={bLevel:'level',bKm:'km',bW:'watts',bHr:'avgHr'};
  if(BF[el.id]&&S.active){S.active.bike[BF[el.id]]=num(el.value);debounce('active',saveActive,800);return}
  if(el.dataset&&el.dataset.setting){var k=el.dataset.setting,v=num(el.value);debounce('set-'+k,function(){setSetting(k,v==null?null:Math.round(v),true)},600)}
});
document.addEventListener('change',function(e){
  var el=e.target;
  if(el.dataset&&el.dataset.pf){onPlanField(el);return}
  if(el.id==='soundT'){S.sound=el.checked;LS.set('sound',S.sound);if(S.sound){primeAudio();beep()}}
  if(el.id==='importFile'&&el.files&&el.files[0])importFile(el.files[0]);
  if(el.id==='afcdFile'&&el.files&&el.files[0]){
    toast('Uploading…');
    fetch('/api/afcd/upload',{method:'POST',headers:{'content-type':'application/octet-stream'},body:el.files[0],credentials:'same-origin'})
      .then(function(r){return r.json().then(function(b){if(!r.ok)throw new Error(b.error||'Upload failed.');S.afcd=b;render();toast('Loaded '+b.count+' Australian foods.')})})
      .catch(function(e){toast(e.message||'Upload failed.')});
  }
});
document.addEventListener('submit',function(e){
  if(e.target.id!=='loginForm')return;e.preventDefault();
  var pw=$('#pw').value,err=$('#loginErr');
  api('POST','/api/login',{password:pw}).then(function(){S.phase='loading';render();boot()},function(x){err.hidden=false;err.textContent=x.offline?'Can’t reach the server.':x.message});
});
document.addEventListener('focusin',function(e){var el=e.target;if(el.matches&&el.matches('.set input, #bLevel, .big-step input')){setTimeout(function(){try{el.select()}catch(x){}},0)}});
document.addEventListener('focusout',function(){setTimeout(function(){if(S.pendingRender)render(true)},0)});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&!$('#sheet').hidden){closeSheet();return}
  if(e.key==='Enter'&&e.target.matches&&e.target.matches('.set input')){e.preventDefault();var row=e.target.closest('.set');commitInput(e.target);if(!row.classList.contains('done'))toggleSet(row);else e.target.blur()}
  if(e.key==='Enter'&&e.target.id==='bwIn'){e.preventDefault();saveBody()}
});
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState!=='visible')return;
  if(S.active)keepAwake(true);
  if(S.phase==='ready'){kick();if(!outbox.length){loadState();if(GD.onResume)GD.onResume()}}
});
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();S.installPrompt=e;if(S.tab==='plan')render(true)});

/* ---------- boot ---------- */
function boot(){
  api('GET','/api/me').then(function(me){
    GD.me=me;
    // The server has a newer release than this copy: reload once to pick it up (not mid-workout).
    if(me.version&&GD.clientVersion&&me.version!==GD.clientVersion&&!S.active&&LS.get('reloadedFor','')!==me.version){LS.set('reloadedFor',me.version);location.reload();return}
    if(me.passwordRequired&&!me.authed){needLogin();return}
    loadState();kick();
    if(GD.onBoot)GD.onBoot();
  },function(){
    var c=LS.get('state',null);
    if(c){S.plan=c.plan||{};S.settings=c.settings;S.sessions=c.sessions||[];applyPending();S.loaded=true;S.phase='ready';syncActive();render();if(GD.onBoot)GD.onBoot()}
    else{S.phase='offline';render()}
  });
}
document.addEventListener('DOMContentLoaded',function(){
  view=$('#view');
  try{var qt=new URLSearchParams(location.search).get('tab');if(qt&&['train','food','plan','log'].indexOf(qt)>=0){S.tab=qt;LS.set('tab',qt)}if(location.search)history.replaceState(null,'','/')}catch(e){}
  var c=LS.get('state',null);
  if(c){S.plan=c.plan||{};S.settings=c.settings;S.sessions=c.sessions||[];applyPending();S.loaded=true;S.phase='ready';syncActive()}
  render();boot();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});
});

/* shared with food.js */
Object.assign(GD,{$:$,esc:esc,LS:LS,api:api,queue:queue,pending:pending,toast:toast,dkey:dkey,parseKey:parseKey,fmtDay:fmtDay,addDays:addDays,monday:monday,
  num:num,r1:r1,kg:kg,clone:clone,rid:rid,debounce:debounce,haptic:haptic,openSheet:openSheet,closeSheet:closeSheet,setSetting:setSetting,setSettings:setSettings,st:st,
  loadBody:loadBody,WD:WD,MO:MO,outbox:function(){return outbox}});
})();
