/* Gym Desk: Food tab. Barcode scan, search, custom foods, grams, daily calories and protein. */
(function(){
'use strict';
var GD=window.GD,S=GD.S,$=GD.$,esc=GD.esc,LS=GD.LS,num=GD.num,r1=GD.r1;
var MEALS=['breakfast','lunch','dinner','snacks'];
var MEAL_NAME={breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',snacks:'Snacks'};
var STAR='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" fill="currentColor"/></svg>';
var STAR_O='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
var SCAN_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8"/></svg>';

var CAM_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
var TORCH_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1 5H9zM9 8h6v3l-1.5 2v8h-3v-8L9 11z"/></svg>';
S.foodDate=GD.dkey(new Date());
S.foodDays=LS.get('foodDays',{});
S.foodLoaded={};
S.weekTotals={};
S.recent=LS.get('recentFoods',null);
S.add=null;
S.meals=LS.get('meals',null);

/* ---------- helpers ---------- */
function today(){return GD.dkey(new Date())}
function g(v){return v==null?'–':v<10?String(r1(v)):String(Math.round(v))}
function kc(v){return v==null?'–':String(Math.round(v))}
function defaultMeal(){var h=new Date().getHours();return h>=4&&h<11?'breakfast':h<15?'lunch':h>=17&&h<21?'dinner':'snacks'}
function targets(){var s=GD.st();return {kcal:s.kcalTarget||null,protein:s.proteinTarget||null,carbs:s.carbTarget||null,fat:s.fatTarget||null}}
function sum(list,k){return list.reduce(function(a,e){return a+(e[k]||0)},0)}
function calc(f,grams){var x=function(k){return f[k]==null||grams==null?null:r1(f[k]*grams/100)};return {kcal:x('kcal'),protein:x('protein'),carbs:x('carbs'),fat:x('fat')}}
function hasNutrition(f){return f&&(f.kcal!=null||f.protein!=null)}
function saveCache(){var keys=Object.keys(S.foodDays).sort().slice(-14),o={};keys.forEach(function(k){o[k]=S.foodDays[k]});S.foodDays=o;LS.set('foodDays',o)}
function latestWeight(){var b=(S.body||[]).find(function(x){return x.weight!=null});return b?b.weight:null}

/* ---------- loading ---------- */
function mergePending(date,entries){
  var out=GD.outbox(),list=entries.slice();
  out.forEach(function(j){
    if(j.method==='POST'&&j.url==='/api/food/log'&&j.body.date===date&&!list.some(function(e){return e.id===j.body.id})&&j.body._local){var c=GD.clone(j.body._local);applyPatch(c,j.body);list.push(c)}
    if(j.method==='DELETE'&&j.entry)list=list.filter(function(e){return e.id!==j.entry});
    if(j.method==='PATCH'&&j.entry){var e=list.find(function(x){return x.id===j.entry});if(e)applyPatch(e,j.body)}
  });
  return list.sort(function(a,b){return (a.created_at||0)-(b.created_at||0)});
}
function loadDay(date,force){
  if(S.foodLoaded[date]==='loading')return;
  if(S.foodLoaded[date]&&!force)return; // true or 'failed': GD.onTab / resume / flush retry
  S.foodLoaded[date]='loading';
  GD.api('GET','/api/food/day/'+date).then(function(b){
    S.foodDays[date]=mergePending(date,b.entries||[]);S.foodLoaded[date]=true;saveCache();rerender();
  },function(){S.foodLoaded[date]='failed';if(!S.foodDays[date])S.foodDays[date]=mergePending(date,[]);rerender()});
}
function loadWeek(date){
  var mon=GD.monday(GD.parseKey(date)),from=GD.dkey(mon),to=GD.dkey(GD.addDays(mon,6));
  GD.api('GET','/api/food/totals?from='+from+'&to='+to).then(function(b){(b.days||[]).forEach(function(d){S.weekTotals[d.date]=d});rerender()},function(){});
}
var recentLoading=false;
function loadRecent(){if(recentLoading)return;recentLoading=true;return GD.api('GET','/api/foods/recent').then(function(b){recentLoading=false;S.recent=b.foods||[];LS.set('recentFoods',S.recent);if(S.add){if(S.add.tab==='recent'&&!S.add.picked)renderAddBody()}else rerender()},function(){recentLoading=false;if(S.recent==null)S.recent=[]})}
function rerender(){if(S.tab==='food')GD.render(true)}
function loadMeals(){return GD.api('GET','/api/meals').then(function(b){S.meals=b.meals||[];LS.set('meals',S.meals);if(S.add&&S.add.tab==='recent'&&!S.add.picked)renderAddBody()},function(){})}

/* ---------- day view ---------- */
GD.views.food=function(){
  var date=S.foodDate,prev=GD.dkey(GD.addDays(GD.parseKey(date),-1));loadDay(date);loadDay(prev);if(!S.weekTotals.__loaded||S.weekTotals.__week!==weekKey(date)){S.weekTotals.__loaded=1;S.weekTotals.__week=weekKey(date);loadWeek(date)}
  if(S.body==null)GD.loadBody();
  if(S.recent==null)loadRecent();
  var entries=S.foodDays[date],t=targets(),isToday=date===today();
  var d=GD.parseKey(date),label=isToday?'Today':date===GD.dkey(GD.addDays(new Date(),-1))?'Yesterday':GD.WD[d.getDay()];
  var h='<div class="daynav"><button class="arrow" data-act="fday" data-d="-1" aria-label="Previous day">‹</button><div><h1>'+label+'</h1><p>'+GD.fmtDay(date)+'</p></div><button class="arrow" data-act="fday" data-d="1" aria-label="Next day"'+(isToday?' disabled':'')+'>›</button></div>';
  if(!entries)return h+'<div class="skel">Loading food…</div>';
  var tot={kcal:sum(entries,'kcal'),protein:sum(entries,'protein'),carbs:sum(entries,'carbs'),fat:sum(entries,'fat')};
  h+='<section class="card macros">'+macro('Protein',tot.protein,t.protein,'g','prot')+macro('Calories',tot.kcal,t.kcal,'kcal','kcal')
    +'<div class="macro-minor"><span>Carbs <b>'+g(tot.carbs)+'</b>'+(t.carbs?' / '+t.carbs:'')+' g</span><span>Fat <b>'+g(tot.fat)+'</b>'+(t.fat?' / '+t.fat:'')+' g</span><button class="link" data-act="copen" style="margin-left:auto;min-height:0;padding:0">Targets</button></div></section>';
  h+='<div class="food-actions"><button class="btn primary" data-act="fadd" data-t="scan">'+SCAN_ICON+'Scan</button><button class="btn" data-act="fadd" data-t="search">Search</button><button class="btn" data-act="fquick">Quick add</button></div>';
  h+=GD.coach.cards(date,entries,tot,t);
  var prevEntries=S.foodDays[prev]||[];
  MEALS.forEach(function(m){
    var list=entries.filter(function(e){return e.meal===m}),yest=prevEntries.filter(function(e){return e.meal===m});
    h+='<section class="meal"><div class="meal-head"><h3>'+MEAL_NAME[m]+'</h3><span class="meal-sum">'+(list.length?kc(sum(list,'kcal'))+' kcal · '+g(sum(list,'protein'))+' g protein':'')+'</span></div>'
      +list.map(entryHtml).join('')
      +(!list.length&&yest.length?'<button class="copy" data-act="fcopy" data-meal="'+m+'"><span class="row-name">Same as '+(date===today()?'yesterday':'the day before')+'<small>'+esc(yest.map(function(e){return e.name}).join(', '))+'</small></span><span class="entry-nums">'+kc(sum(yest,'kcal'))+' kcal<small>'+g(sum(yest,'protein'))+' g protein</small></span></button>':'')
      +'<div class="meal-links"><button class="link" data-act="fadd" data-meal="'+m+'" data-t="recent">+ Add to '+MEAL_NAME[m].toLowerCase()+'</button>'
      +(list.length?'<button class="link" data-act="fsavemeal" data-meal="'+m+'">Save as meal</button>':'')+'</div></section>';
  });
  h+=weekStrip(date,t);
  return h;
};
function weekKey(date){return GD.dkey(GD.monday(GD.parseKey(date)))}
function macro(name,val,tgt,unit,cls){
  var pct=tgt?Math.min(100,val/tgt*100):0,over=tgt&&val>tgt*1.1&&cls==='kcal',left=tgt?tgt-val:null;
  var leftTxt=tgt==null?'No target set':left>0?(unit==='g'?g(left):kc(left))+' '+unit+' to go':(cls==='prot'?'Target hit':'Target reached');
  return '<div class="macro"><div class="macro-top"><span class="macro-name">'+name+'</span><span class="macro-left'+(tgt&&left<=0&&cls==='prot'?' hit':'')+'">'+leftTxt+'</span></div>'
    +'<div class="macro-val"><b>'+(unit==='g'?g(val):kc(val))+'</b><span>'+(tgt?'of '+tgt+' '+unit:unit)+'</span></div>'
    +'<div class="mbar '+cls+'"><i'+(over?' class="over"':'')+' style="width:'+pct.toFixed(1)+'%"></i></div></div>';
}
function entryHtml(e){
  return '<button class="entry" data-act="fedit" data-id="'+esc(e.id)+'"><span class="row-name">'+esc(e.name)+'<small>'+(e.brand?esc(e.brand)+' · ':'')+(e.grams!=null?g(e.grams)+' g':'quick add')+'</small></span>'
    +'<span class="entry-nums">'+kc(e.kcal)+' kcal<small>'+g(e.protein)+' g protein</small></span></button>';
}
function weekStrip(date,t){
  var mon=GD.monday(GD.parseKey(date)),td=today(),h='<section class="blk"><div class="sec-row"><h3 class="sec">Protein this week</h3><span class="small">'+(t.protein?'target '+t.protein+' g':'')+'</span></div><div class="pweek">';
  var hits=0;
  for(var i=0;i<7;i++){
    var d=GD.dkey(GD.addDays(mon,i)),local=S.foodDays[d],p=local?sum(local,'protein'):(S.weekTotals[d]?S.weekTotals[d].protein:0),future=d>td;
    var hit=t.protein&&p>=t.protein;if(hit)hits++;
    var pct=t.protein?Math.min(100,p/t.protein*100):0;
    h+='<button class="pday'+(d===date?' sel':'')+'" data-act="fgo" data-date="'+d+'"'+(future?' disabled':'')+' aria-label="'+GD.fmtDay(d)+': '+g(p)+' g protein"><div class="pcol'+(hit?' hit':'')+'"><i style="height:'+pct.toFixed(0)+'%"></i></div><span>'+GD.WD[GD.addDays(mon,i).getDay()].charAt(0)+'</span></button>';
  }
  return h+'</div>'+(t.protein?'<p class="small">Hit your protein on '+hits+' of 7 days.</p>':'')+GD.coach.progressNote()+'</section>';
}

/* ---------- adding food ---------- */
function openAdd(meal,tab){
  S.add={meal:meal||defaultMeal(),tab:tab||'recent',q:'',results:null,searching:false,picked:null,grams:null,worldwide:false,custom:null,msg:''};
  var sh=$('#sheet');
  sh.innerHTML='<div class="fs d-food" role="dialog" aria-modal="true" aria-labelledby="fsT"><div class="fs-head"><div class="wrap"><div class="fs-bar"><button class="x" data-act="fback" aria-label="Back">‹</button><h2 id="fsT">Add food</h2><button class="x" data-act="fclose" aria-label="Close">×</button></div>'
    +'<div class="fs-tabs" role="group" aria-label="Ways to add">'+[['recent','Recent'],['search','Search'],['scan','Scan'],['custom','New']].map(function(x){return '<button data-act="ftab" data-t="'+x[0]+'">'+x[1]+'</button>'}).join('')+'</div></div></div>'
    +'<div class="fs-body"><div class="wrap fs-inner" id="fsBody"></div></div></div>';
  sh.hidden=false;document.body.style.overflow='hidden';
  try{history.pushState({gdAdd:true},'')}catch(e){}
  if(S.recent==null||tab==='recent')loadRecent();
  loadMeals();
  renderAddBody();
}
function closeAdd(fromPop){stopCamera();S.add=null;var sh=$('#sheet');sh.hidden=true;sh.innerHTML='';document.body.style.overflow='';
  if(!fromPop&&history.state&&history.state.gdAdd){try{history.back()}catch(e){}}}
window.addEventListener('popstate',function(){
  if(!S.add)return;
  if(S.add.picked||S.add.forRecipe){GD.ACT.fback();try{history.pushState({gdAdd:true},'')}catch(e){}}
  else closeAdd(true);
});
GD.onSheetClose=function(){if(S.add)closeAdd();document.body.style.overflow=''};
function setTab(t){stopCamera();S.add.tab=t;S.add.picked=null;S.add.msg='';renderAddBody()}
function renderAddBody(){
  var a=S.add;if(!a)return;var body=$('#fsBody');if(!body)return;
  document.querySelectorAll('.fs-tabs button').forEach(function(b){b.setAttribute('aria-pressed',String(!a.picked&&b.dataset.t===a.tab))});
  $('.fs-tabs').hidden=!!a.picked;
  $('#fsT').textContent=a.forRecipe?(a.picked?'How much went in?':'Add an ingredient'):a.picked?'How much?':(a.tab==='custom'&&a.newKind==='recipe')?'Recipe':'Add to '+MEAL_NAME[a.meal].toLowerCase();
  if(a.picked){body.innerHTML=amountHtml();return}
  if(a.tab==='recent')body.innerHTML=recentHtml();
  else if(a.tab==='search'){body.innerHTML=searchHtml();var i=$('#fq');if(i&&!a.results)i.focus()}
  else if(a.tab==='scan'){body.innerHTML=scanHtml();startCamera()}
  else body.innerHTML=customHtml();
}
function resRow(f,i,group){
  var sub=[f.brand,f.last_grams?'last time '+g(f.last_grams)+' g':f.serving_label?'serve '+f.serving_label:''].filter(Boolean).join(' · ');
  return '<button class="res" data-act="fpick" data-g="'+group+'" data-i="'+i+'"><span class="row-name">'+(f.favourite?'<span style="color:var(--gold-ink)">★</span> ':'')+esc(f.name)+(sub?'<small>'+esc(sub)+'</small>':'')+'</span>'
    +'<span class="res-nums">'+(f.kcal!=null?kc(f.kcal)+' kcal':'no kcal')+'<small>'+(f.protein!=null?g(f.protein)+' g P':'')+' /100 g</small></span></button>';
}
function mealsHtml(){
  var ms=S.meals||[];if(!ms.length)return '';
  return '<section class="blk"><h3 class="sec">Your meals</h3><div class="results">'+ms.map(function(m){
    var k=sum(m.items,'kcal'),p=sum(m.items,'protein');
    if(S.add.confirmMeal===m.id)return '<div class="res"><span class="row-name">Delete “'+esc(m.name)+'”?</span><span class="chips"><button class="btn sm danger-fill" data-act="mdelyes" data-id="'+esc(m.id)+'">Delete</button><button class="btn sm ghost" data-act="mdelno">Keep</button></span></div>';
    return '<div class="res mrow"><button class="mlog" data-act="mlog" data-id="'+esc(m.id)+'"><span class="row-name">'+esc(m.name)+'<small>'+m.items.length+' item'+(m.items.length===1?'':'s')+': '+esc(m.items.map(function(e){return e.name}).join(', '))+'</small></span><span class="res-nums">'+kc(k)+' kcal<small>'+g(p)+' g protein</small></span></button><button class="x" data-act="mdel" data-id="'+esc(m.id)+'" aria-label="Delete '+esc(m.name)+'">×</button></div>';
  }).join('')+'</div></section>';
}
function recentHtml(){
  var list=S.recent;
  if(list==null)return mealsHtml()+'<div class="skel">Loading your foods…</div>';
  if(!list.length&&(S.meals||[]).length)return mealsHtml();
  if(!list.length)return '<div class="empty"><h2>Nothing yet</h2><p>Foods you log show up here with the amount you had last time, so repeats take two taps. Scan a barcode or search to add your first.</p><div class="chips"><button class="btn primary" data-act="ftab" data-t="scan">Scan a barcode</button><button class="btn" data-act="ftab" data-t="search">Search</button></div></div>';
  S.add.lists={recent:list};
  var mh=S.add.forRecipe?'':mealsHtml();
  return mh+'<section class="blk">'+(mh?'<h3 class="sec">Recent foods</h3>':'')+'<div class="results">'+list.map(function(f,i){return resRow(f,i,'recent')}).join('')+'</div></section>';
}
function searchHtml(){
  var a=S.add,h='<form class="search-row" id="fsearch"><input id="fq" type="search" enterkeyhint="search" autocomplete="off" placeholder="e.g. chicken breast, Chobani" value="'+esc(a.q)+'"><button class="btn primary" type="submit">Search</button></form>';
  if(a.searching)return h+'<div class="skel">Searching…</div>';
  if(!a.results)return h+'<p class="small">Searches your saved foods, the Australian Food Composition Database (whole foods like chicken, rice, eggs), and Open Food Facts (packaged products, Australian first).</p>';
  var r=a.results,groups=[['local','Your foods'],['afcd','Australian foods · FSANZ'],['off','Packaged · Open Food Facts'],['usda','More whole foods · USDA']],any=false;
  a.lists=r;
  groups.forEach(function(gp){var list=r[gp[0]]||[];if(!list.length)return;any=true;h+='<section class="blk"><h3 class="sec">'+gp[1]+'</h3><div class="results">'+list.map(function(f,i){return resRow(f,i,gp[0])}).join('')+'</div></section>'});
  if(r.offline)h+='<p class="note">You’re offline, so this only searched foods saved on this phone.</p>';
  if(r.errors&&r.errors.off)h+='<p class="small">Open Food Facts didn’t answer, so packaged results are missing. Try again in a moment.</p>';
  if(!any)h+='<p class="muted">No matches for “'+esc(a.q)+'”. Try fewer words, or add it yourself under New.</p>';
  if(!r.offline&&!a.worldwide)h+='<button class="link" data-act="fworld">Search all countries</button>';
  return h;
}
function doSearch(q){
  var a=S.add;a.q=q;if(!q)return;a.searching=true;a.results=null;renderAddBody();
  GD.api('GET','/api/foods/search?q='+encodeURIComponent(q)+(a.worldwide?'&worldwide=1':'')).then(function(b){if(S.add!==a)return;a.searching=false;a.results=b;renderAddBody()},function(e){
    if(S.add!==a)return;a.searching=false;var ql=q.toLowerCase();
    a.results={local:(S.recent||[]).filter(function(f){return (f.name+' '+(f.brand||'')).toLowerCase().indexOf(ql)>=0}),afcd:[],off:[],usda:[],offline:!!e.offline,errors:{}};
    if(!e.offline)GD.toast(e.message);renderAddBody();
  });
}

/* ---------- scanning ---------- */
var cam={stream:null,timer:null,det:null};
function scanHtml(){
  var supported='BarcodeDetector' in window;
  return (supported?'<div class="scanbox"><video id="scanVid" playsinline muted></video><div class="aim"></div><button class="torch" id="torchBtn" data-act="ftorch" aria-pressed="false" hidden>'+TORCH_ICON+'<span>Torch</span></button><div class="scanmsg" id="scanMsg">Starting camera…</div></div>'
    :'<p class="note">This browser can’t read barcodes from the camera. Chrome on Android can. Type the number under the barcode instead.</p>')
    +(S.add.msg?'<p class="note">'+esc(S.add.msg)+'</p>':'')
    +'<form class="search-row" id="fbar"><input id="fcode" type="text" inputmode="numeric" autocomplete="off" placeholder="Barcode number"><button class="btn" type="submit">Look up</button></form>'
    +'<button class="link" data-act="ftab" data-t="custom">No barcode? Photograph the nutrition panel instead</button>';
}
function startCamera(){
  if(!('BarcodeDetector' in window))return;
  var vid=$('#scanVid'),msg=$('#scanMsg');if(!vid)return;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){msg.textContent='Camera isn’t available here. Type the number below.';return}
  var formats=['ean_13','ean_8','upc_a','upc_e','code_128'];
  Promise.resolve(BarcodeDetector.getSupportedFormats?BarcodeDetector.getSupportedFormats():formats).then(function(sup){
    cam.det=new BarcodeDetector({formats:formats.filter(function(f){return sup.indexOf(f)>=0})});
    return navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
  }).then(function(stream){
    if(!S.add||S.add.tab!=='scan'||S.add.picked){stream.getTracks().forEach(function(t){t.stop()});return}
    cam.stream=stream;cam.torch=false;vid.srcObject=stream;
    return vid.play().then(function(){
      msg.textContent='Point at the barcode';
      var track=stream.getVideoTracks()[0],caps=track&&track.getCapabilities?track.getCapabilities():{};
      if(caps&&caps.torch){cam.track=track;var b=$('#torchBtn');if(b)b.hidden=false}
      loop();
    });
  }).catch(function(e){if(msg)msg.textContent=e&&e.name==='NotAllowedError'?'Camera blocked. Allow it in your browser’s site settings, or type the number below.':'Couldn’t start the camera. Type the number below.'});
  function loop(){
    if(!cam.stream)return;
    cam.det.detect(vid).then(function(codes){
      var c=codes.find(function(x){return /^\d{6,14}$/.test(x.rawValue)});
      if(c){GD.haptic();stopCamera();lookupBarcode(c.rawValue);return}
      cam.timer=setTimeout(loop,180);
    },function(){cam.timer=setTimeout(loop,400)});
  }
}
function stopCamera(){clearTimeout(cam.timer);if(cam.stream){cam.stream.getTracks().forEach(function(t){t.stop()});cam.stream=null}cam.track=null;cam.torch=false}
function toggleTorch(){
  if(!cam.track)return;var want=!cam.torch;
  cam.track.applyConstraints({advanced:[{torch:want}]}).then(function(){cam.torch=want;var b=$('#torchBtn');if(b){b.setAttribute('aria-pressed',String(want));b.classList.toggle('on',want);b.querySelector('span').textContent=want?'Torch on':'Torch'}},function(){GD.toast('This phone won’t turn the torch on from the browser.')});
}
function lookupBarcode(code){
  var a=S.add;if(!a)return;var body=$('#fsBody');if(body)body.innerHTML='<div class="skel">Looking up '+esc(code)+'…</div>';
  GD.api('GET','/api/foods/barcode/'+encodeURIComponent(code)).then(function(b){if(S.add!==a)return;pick(b.food);if(b.from==='off'&&!hasNutrition(b.food))GD.toast('Found it, but it has no nutrition info. Add it from the label.')},function(e){
    if(S.add!==a)return;
    if(e.status===404){a.tab='custom';a.newKind='food';a.custom={barcode:code};a.msg='Barcode '+code+' isn’t in Open Food Facts yet. Photograph the nutrition panel (or type it in) and the next scan will find it.';renderAddBody();return}
    var local=(S.recent||[]).find(function(f){return f.barcode===code});
    if(local){pick(local);return}
    a.msg=e.offline?'You’re offline and this product isn’t saved on this phone yet.':e.message;renderAddBody();
  });
}

/* ---------- custom food ---------- */
function kindToggle(){
  if(S.add.forRecipe)return '';var k=S.add.newKind||'food';
  return '<div class="seg" role="group" aria-label="What are you adding" style="grid-template-columns:1fr 1fr"><button data-act="nkind" data-v="food" aria-pressed="'+(k==='food')+'">Food from a label</button><button data-act="nkind" data-v="recipe" aria-pressed="'+(k==='recipe')+'">Recipe or batch</button></div>';
}
function customHtml(){
  if(S.add.newKind==='recipe'&&!S.add.forRecipe)return kindToggle()+recipeHtml();
  return kindToggle()+foodFormHtml();
}
function foodFormHtml(){
  var c=S.add.custom||{},perServe=!!c.perServe,v=function(k){return esc(c[k]==null?'':c[k])};
  if(S.add.reading)return '<div class="skel">Reading the label'+(S.labelEngine==='claude'?' with Claude':'')+'…</div>';
  if(S.labelEngine===undefined){S.labelEngine=null;GD.api('GET','/api/label').then(function(b){S.labelEngine=b.engine;if(S.add&&S.add.tab==='custom'&&!S.add.reading)renderAddBody()},function(){})}
  return '<div class="photo-read"><label class="btn block big" for="labelFile">'+CAM_ICON+'Read the label from a photo</label><input id="labelFile" type="file" accept="image/*" capture="environment" hidden>'
    +'<p class="small">Fill the whole photo with the nutrition table, straight on, in good light. '+(S.labelEngine==='claude'?'Claude reads it.':'Your server reads it, so it stays private.')+' You check the numbers before saving.</p></div>'
    +(S.add.msg?'<p class="note">'+esc(S.add.msg)+'</p>':'')
    +'<form class="card amount" id="fcustom">'
    +'<div class="field"><label for="cName">Name</label><input id="cName" required autocomplete="off" value="'+v('name')+'" placeholder="e.g. Protein shake"></div>'
    +'<div class="fgrid2"><div class="field"><label for="cBrand">Brand</label><input id="cBrand" autocomplete="off" value="'+v('brand')+'" placeholder="optional"></div>'
    +'<div class="field"><label for="cBar">Barcode</label><input id="cBar" inputmode="numeric" autocomplete="off" value="'+v('barcode')+'" placeholder="optional"></div></div>'
    +'<div class="field"><label for="cServe">Serving size (g)</label><input id="cServe" inputmode="decimal" autocomplete="off" value="'+v('serving_g')+'" placeholder="from the label, optional"></div>'
    +'<div class="seg" role="group" aria-label="Label values are" style="grid-template-columns:1fr 1fr"><button type="button" data-act="cper" data-v="0" aria-pressed="'+!perServe+'">Per 100 g</button><button type="button" data-act="cper" data-v="1" aria-pressed="'+perServe+'">Per serving</button></div>'
    +'<div class="fgrid2"><div class="field"><label for="cKcal">Calories (kcal)</label><input id="cKcal" inputmode="decimal" autocomplete="off" value="'+v('kcal')+'"></div>'
    +'<div class="field"><label for="cProt">Protein (g)</label><input id="cProt" inputmode="decimal" autocomplete="off" value="'+v('protein')+'"></div>'
    +'<div class="field"><label for="cCarb">Carbs (g)</label><input id="cCarb" inputmode="decimal" autocomplete="off" value="'+v('carbs')+'"></div>'
    +'<div class="field"><label for="cFat">Fat (g)</label><input id="cFat" inputmode="decimal" autocomplete="off" value="'+v('fat')+'"></div></div>'
    +'<p class="small">Australian labels list energy in kJ. Divide by 4.18 for kcal, or type the kJ number followed by “kj” (e.g. 1590kj).</p>'
    +'<button class="btn primary block big" type="submit">'+(c.id?'Save changes':'Save food')+'</button></form>';
}
// Keep whatever was typed in the form before re-rendering it.
function captureCustom(){
  var c=S.add.custom=S.add.custom||{},f=function(id){var el=$('#'+id);return el?el.value:undefined},set=function(k,id){var v=f(id);if(v!==undefined)c[k]=v};
  set('name','cName');set('brand','cBrand');set('barcode','cBar');set('serving_g','cServe');set('kcal','cKcal');set('protein','cProt');set('carbs','cCarb');set('fat','cFat');
  return c;
}
// Shrink, greyscale and stretch the contrast of a photo before uploading: faster, and easier to read.
function prepareImage(file){
  var load=window.createImageBitmap?createImageBitmap(file,{imageOrientation:'from-image'}):new Promise(function(res,rej){var i=new Image();i.onload=function(){res(i)};i.onerror=rej;i.src=URL.createObjectURL(file)});
  return load.then(function(img){
    var max=1568,w=img.width,h=img.height,k=Math.min(1,max/Math.max(w,h)),cv=document.createElement('canvas');
    cv.width=Math.round(w*k);cv.height=Math.round(h*k);var ctx=cv.getContext('2d');ctx.drawImage(img,0,0,cv.width,cv.height);
    var d=ctx.getImageData(0,0,cv.width,cv.height),px=d.data,hist=new Uint32Array(256),n=px.length/4,i,y;
    for(i=0;i<px.length;i+=4){y=(px[i]*0.299+px[i+1]*0.587+px[i+2]*0.114)|0;px[i]=y;hist[y]++}
    var lo=0,hi=255,acc=0;for(lo=0;lo<255&&(acc+=hist[lo])<n*0.02;lo++);acc=0;for(hi=255;hi>0&&(acc+=hist[hi])<n*0.02;hi--);
    var span=Math.max(1,hi-lo);
    for(i=0;i<px.length;i+=4){y=Math.max(0,Math.min(255,(px[i]-lo)*255/span));px[i]=px[i+1]=px[i+2]=y}
    ctx.putImageData(d,0,0);
    return new Promise(function(res){cv.toBlob(function(b){res(b||file)},'image/jpeg',0.88)});
  });
}
function readLabel(file){
  var a=S.add;if(!a)return;captureCustom();a.reading=true;a.msg='';renderAddBody();
  prepareImage(file).catch(function(){return file}).then(function(blob){
    return fetch('/api/label/read',{method:'POST',headers:{'content-type':blob.type||'image/jpeg'},body:blob,credentials:'same-origin'})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(b){if(!r.ok)throw new Error(b.error||'Couldn’t read the label.');return b})});
  }).then(function(r){
    if(S.add!==a)return;var c=a.custom=a.custom||{};
    ['kcal','protein','carbs','fat'].forEach(function(k){if(r[k]!=null)c[k]=r[k]});
    if(r.serving_g)c.serving_g=r.serving_g;if(r.name&&!c.name)c.name=r.name;if(r.brand&&!c.brand)c.brand=r.brand;
    c.perServe=false;a.reading=false;
    var missing=['kcal','protein','carbs','fat'].filter(function(k){return r[k]==null}).map(function(k){return {kcal:'calories',protein:'protein',carbs:'carbs',fat:'fat'}[k]});
    a.msg=(r.note?r.note+' ':'')+'Read '+(r.engine==='claude'?'with Claude':'on your server')+'. These are per 100 g. Check them against the label'+(missing.length?' and fill in '+missing.join(', '):'')+', then save.';
    renderAddBody();
  },function(e){if(S.add!==a)return;a.reading=false;a.msg=e.message||'Couldn’t read the label.';renderAddBody()});
}
function kcalFrom(raw){var s=String(raw||'').trim().toLowerCase();if(!s)return null;var n=num(s.replace(/kj|kcal|cal/g,''));if(n==null)return null;return /kj/.test(s)?r1(n/4.184):n}
function saveCustom(){
  var c=S.add.custom||{},perServe=!!c.perServe,serve=num($('#cServe').value);
  var vals={kcal:kcalFrom($('#cKcal').value),protein:num($('#cProt').value),carbs:num($('#cCarb').value),fat:num($('#cFat').value)};
  if(vals.kcal==null&&vals.protein==null){GD.toast('Enter at least calories or protein.');return}
  if(perServe){if(!serve){GD.toast('Add the serving size so I can work out per 100 g.');$('#cServe').focus();return}Object.keys(vals).forEach(function(k){if(vals[k]!=null)vals[k]=r1(vals[k]*100/serve)})}
  var food={id:c.id,source:c.source||'custom',source_id:c.source_id,name:$('#cName').value.trim(),brand:$('#cBrand').value.trim()||null,barcode:$('#cBar').value.replace(/\D/g,'')||null,
    serving_g:serve,serving_label:serve?serve+' g':null,kcal:vals.kcal,protein:vals.protein,carbs:vals.carbs,fat:vals.fat};
  if(!food.name){GD.toast('Give it a name.');return}
  var a=S.add,req=c.id?GD.api('PATCH','/api/foods/'+encodeURIComponent(c.id),food):GD.api('POST','/api/foods',food);
  req.then(function(b){if(S.add!==a)return;upsertRecent(b.food);pick(b.food)},function(e){
    if(S.add!==a)return;
    if(e.offline&&!c.id){food.id=null;pick(food);GD.toast('Offline: it’ll be saved with this entry.');return}
    GD.toast(e.message);
  });
}
function upsertRecent(f){if(!f||!f.id)return;S.recent=(S.recent||[]).filter(function(x){return x.id!==f.id});S.recent.unshift(f);LS.set('recentFoods',S.recent.slice(0,60))}

/* ---------- amount ---------- */
function pick(f){var a=S.add;stopCamera();a.picked=f;a.grams=f.last_grams||f.serving_g||100;renderAddBody()}
function amountHtml(){
  var a=S.add,f=a.picked,c=calc(f,a.grams),ok=hasNutrition(f),rec=f.source==='recipe'&&f.recipe,chips=[];
  if(f.serving_g){chips.push({g:f.serving_g,l:'1 serve · '+g(f.serving_g)+' g'});chips.push({g:r1(f.serving_g*2),l:'2 serves'})}
  if(rec){var basis=recipeBasis(f.recipe);chips.push({g:r1(basis/2),l:'Half the batch'});chips.push({g:r1(basis),l:'Whole batch · '+g(basis)+' g'})}
  if(f.last_grams&&f.last_grams!==f.serving_g)chips.push({g:f.last_grams,l:'Last time · '+g(f.last_grams)+' g'});
  if(!rec||f.recipe.cooked_g)[50,100,150,200,250].forEach(function(x){if(!chips.some(function(c){return c.g===x}))chips.push({g:x,l:x+' g'})});
  var src=f.source==='off'?'Open Food Facts':f.source==='usda'?'USDA':f.source==='afcd'?'Australian Food Composition Database':rec?'Your recipe':'Your food';
  return '<section class="card amount">'
    +'<div><span class="src">'+src+(f.barcode?' · '+esc(f.barcode):'')+'</span><h3>'+esc(f.name)+'</h3>'+(f.brand?'<p class="small">'+esc(f.brand)+'</p>':'')+'</div>'
    +'<p class="per100">Per 100 g: '+kc(f.kcal)+' kcal · '+g(f.protein)+' g protein · '+g(f.carbs)+' g carbs · '+g(f.fat)+' g fat</p>'
    +(rec&&!f.recipe.cooked_g?'<p class="small">No cooked weight saved, so log it by serves rather than weighing your bowl.</p>':rec?'<p class="small">Weigh your bowl, or tap a serve.</p>':'')
    +(ok?'':'<p class="warn">No calories or protein on file. Add them from the label first.</p>')
    +'<div class="field"><label for="fg">Grams</label><div class="step big-step"><button data-act="fg-" aria-label="10 grams less">−</button><input id="fg" type="text" inputmode="decimal" autocomplete="off" value="'+esc(g(a.grams))+'"><button data-act="fg+" aria-label="10 grams more">+</button></div></div>'
    +'<div class="chips">'+chips.slice(0,8).map(function(x){return '<button class="pick'+(x.g===a.grams?' on':'')+'" data-act="fgset" data-g="'+x.g+'">'+esc(x.l)+'</button>'}).join('')+'</div>'
    +'<div class="calc" id="fcalc">'+calcHtml(c)+'</div>'
    +(a.forRecipe?'<button class="btn primary block big" data-act="ringadd"'+(ok?'':' disabled')+'>Add to recipe</button></section>'
    :'<div class="seg four" role="group" aria-label="Meal">'+MEALS.map(function(m){return '<button data-act="fmeal" data-m="'+m+'" aria-pressed="'+(a.meal===m)+'">'+MEAL_NAME[m]+'</button>'}).join('')+'</div>'
    +'<div class="sec-row">'+(f.id?'<button class="star'+(f.favourite?' on':'')+'" data-act="ffav">'+(f.favourite?STAR+' Favourite':STAR_O+' Add to favourites')+'</button>':'<span></span>')+(rec?'<button class="link" data-act="redit">Edit recipe</button>':'<button class="link" data-act="fedfood">Edit nutrition</button>')+'</div>'
    +'<button class="btn primary block big" data-act="flog"'+(ok?'':' disabled')+'>Add to '+MEAL_NAME[a.meal].toLowerCase()+'</button></section>');
}

/* ---------- recipes ---------- */
// A recipe is built from ingredients (grams of each). Weigh the cooked pot to log portions by weight,
// or set a number of serves. Either way it's saved as a food, so leftovers are one tap from Recent.
function itemCalc(it){return calc({kcal:it.kcal100,protein:it.protein100,carbs:it.carbs100,fat:it.fat100},it.grams)}
function recipeTotals(r){var t={kcal:0,protein:0,carbs:0,fat:0};(r.items||[]).forEach(function(it){var c=itemCalc(it);Object.keys(t).forEach(function(k){t[k]+=c[k]||0})});Object.keys(t).forEach(function(k){t[k]=r1(t[k])});return t}
function rawGrams(r){return (r.items||[]).reduce(function(a,it){return a+(it.grams||0)},0)}
function recipeBasis(r){return num(r.cooked_g)||rawGrams(r)}
function draftRecipe(){var a=S.add;if(!a.recipe)a.recipe=LS.get('recipeDraft',null)||{name:'',items:[],cooked_g:null,servings:4};return a.recipe}
function saveDraft(){if(S.add&&S.add.recipe&&!S.add.recipe.id)LS.set('recipeDraft',S.add.recipe)}
function recipeHtml(){
  var r=draftRecipe(),t=recipeTotals(r),n=r.items.length;
  return '<section class="card amount" id="recipeForm">'
    +'<div class="field"><label for="rName">Name</label><input id="rName" autocomplete="off" value="'+esc(r.name||'')+'" placeholder="e.g. Spag bol"></div>'
    +'<div class="sec-row"><span class="flabel">Ingredients</span><span class="small">'+(n?n+' · weights before cooking':'')+'</span></div>'
    +(n?'<div class="rlist">'+r.items.map(function(it,i){var c=itemCalc(it);return '<div class="ring"><span class="row-name">'+esc(it.name)+'<small id="rs-'+i+'">'+kc(c.kcal)+' kcal · '+g(c.protein)+' g protein</small></span><div class="step mini"><input id="ri-'+i+'" data-ri="'+i+'" type="text" inputmode="decimal" autocomplete="off" value="'+esc(g(it.grams))+'" aria-label="Grams of '+esc(it.name)+'"></div><span class="small">g</span><button class="x" data-act="rdel" data-i="'+i+'" aria-label="Remove '+esc(it.name)+'">×</button></div>'}).join('')+'</div>'
      :'<p class="small">Add everything that went in: scan the pasta packet, search the mince, and so on. Use the weight of each before cooking.</p>')
    +'<button class="btn block" data-act="radd">+ Add ingredient</button>'
    +'<div><span class="flabel">Whole batch</span><div class="calc" id="rTotals" style="margin-top:6px">'+calcHtml(t)+'</div></div>'
    +'<div class="fgrid2"><div class="field"><label for="rCooked">Cooked weight (g)</label><input id="rCooked" type="text" inputmode="decimal" autocomplete="off" value="'+esc(r.cooked_g||'')+'" placeholder="optional"></div>'
    +'<div class="field"><label for="rServ">Serves</label><input id="rServ" type="text" inputmode="numeric" autocomplete="off" value="'+esc(r.servings||'')+'"></div></div>'
    +'<p class="small">Weigh the finished pot and take off the pot’s weight. Then you can log any portion by weighing your bowl. Skip it and log by serves instead.</p>'
    +'<button class="btn primary block big" data-act="rsave"'+(n?'':' disabled')+'>'+(r.id?'Save recipe':'Save and log a portion')+'</button>'
    +(r.id?'':(n?'<button class="link" data-act="rclear">Start over</button>':''))
    +'</section>';
}
function updateRecipeTotals(){var r=S.add&&S.add.recipe;if(!r)return;var el=$('#rTotals');if(el)el.innerHTML=calcHtml(recipeTotals(r));r.items.forEach(function(it,i){var sm=$('#rs-'+i);if(sm){var c=itemCalc(it);sm.textContent=kc(c.kcal)+' kcal · '+g(c.protein)+' g protein'}});var b=document.querySelector('[data-act="rsave"]');if(b)b.disabled=!r.items.length}
function addIngredient(){
  var a=S.add,f=a.picked,grams=num($('#fg').value);if(!grams||grams<=0){GD.toast('Enter how many grams went in.');return}
  var r=draftRecipe();r.items.push({food_id:f.id||null,name:f.name,brand:f.brand||null,grams:r1(grams),kcal100:f.kcal,protein100:f.protein,carbs100:f.carbs,fat100:f.fat});
  a.forRecipe=false;a.picked=null;a.tab='custom';a.newKind='recipe';saveDraft();renderAddBody();GD.toast('Added '+g(grams)+' g '+f.name+'.');
}
function saveRecipe(){
  var a=S.add,r=draftRecipe();r.name=($('#rName').value||'').trim();
  if(!r.name){GD.toast('Give the recipe a name.');$('#rName').focus();return}
  if(!r.items.length){GD.toast('Add at least one ingredient.');return}
  var t=recipeTotals(r),basis=recipeBasis(r),serv=num(r.servings);
  if(!basis){GD.toast('Add the ingredient weights first.');return}
  var per=function(v){return v==null?null:r1(v*100/basis)};
  var food={id:r.id,source:'recipe',name:r.name,kcal:per(t.kcal),protein:per(t.protein),carbs:per(t.carbs),fat:per(t.fat),
    serving_g:serv?r1(basis/serv):null,serving_label:serv?'1 of '+serv+' serves':null,recipe:{items:r.items,cooked_g:num(r.cooked_g),servings:serv}};
  var editing=!!r.id,req=editing?GD.api('PATCH','/api/foods/'+encodeURIComponent(r.id),food):GD.api('POST','/api/foods',food);
  var done=function(saved){LS.del('recipeDraft');a.recipe=null;a.newKind='food';if(saved.id)upsertRecent(saved);pick(saved);a.grams=saved.serving_g||r1(basis/4);renderAddBody()};
  req.then(function(b){if(S.add!==a)return;GD.toast(editing?'Recipe updated.':'Recipe saved. Now log your portion.');done(b.food)},function(e){
    if(S.add!==a)return;
    if(e.offline&&!editing){food.id=null;GD.toast('Offline: the recipe saves with this entry.');done(food);return}
    GD.toast(e.message);
  });
}
function calcHtml(c){return '<div><b>'+kc(c.kcal)+'</b><span>kcal</span></div><div><b>'+g(c.protein)+'</b><span>protein</span></div><div><b>'+g(c.carbs)+'</b><span>carbs</span></div><div><b>'+g(c.fat)+'</b><span>fat</span></div>'}
function setGrams(v,fromInput){
  var a=S.add;a.grams=v==null?null:Math.max(0,r1(v));
  if(!fromInput){var i=$('#fg');if(i)i.value=g(a.grams)}
  var el=$('#fcalc');if(el)el.innerHTML=calcHtml(calc(a.picked,a.grams));
  document.querySelectorAll('[data-act="fgset"]').forEach(function(b){b.classList.toggle('on',num(b.dataset.g)===a.grams)});
}
function logPicked(){
  var a=S.add,f=a.picked,grams=num($('#fg').value);if(grams==null||grams<=0){GD.toast('Enter how many grams you had.');return}
  var c=calc(f,grams),id=GD.rid(),date=S.foodDate,now=Date.now();
  var entry={id:id,date:date,meal:a.meal,food_id:f.id||null,name:f.name,brand:f.brand||null,grams:r1(grams),kcal100:f.kcal,protein100:f.protein,carbs100:f.carbs,fat100:f.fat,kcal:c.kcal,protein:c.protein,carbs:c.carbs,fat:c.fat,created_at:now};
  var body={id:id,date:date,meal:a.meal,grams:r1(grams),createdAt:now,_local:entry};
  if(f.id)body.foodId=f.id;else body.food=f;
  addLocal(entry);GD.queue('POST','/api/food/log',body,{entry:id});
  if(f.id)upsertRecent(Object.assign({},f,{last_grams:r1(grams),last_used:now}));
  GD.haptic();closeAdd();GD.render();GD.toast('Added '+g(grams)+' g '+f.name+'.');
}
function addLocal(e){(S.foodDays[e.date]=S.foodDays[e.date]||[]).push(e);saveCache()}

/* ---------- quick add + edit ---------- */
function quickSheet(){
  GD.openSheet('<h2 id="sheetT">Quick add</h2><p>For meals out or anything without a label. Just the numbers.</p>'
    +'<div class="field"><label for="qName">What was it</label><input id="qName" autocomplete="off" placeholder="optional, e.g. Kebab"></div>'
    +'<div class="fgrid2"><div class="field"><label for="qKcal">Calories (kcal)</label><input id="qKcal" inputmode="decimal" autocomplete="off"></div><div class="field"><label for="qProt">Protein (g)</label><input id="qProt" inputmode="decimal" autocomplete="off"></div></div>'
    +'<div class="seg four" role="group" aria-label="Meal">'+MEALS.map(function(m){return '<button data-act="qmeal" data-m="'+m+'" aria-pressed="'+(defaultMeal()===m)+'">'+MEAL_NAME[m]+'</button>'}).join('')+'</div>'
    +'<div class="sheet-btns"><button class="btn primary block big" data-act="qsave">Add</button><button class="btn ghost block" data-act="sclose">Cancel</button></div>','d-food');
}
function qMeal(){var b=document.querySelector('[data-act="qmeal"][aria-pressed="true"]');return b?b.dataset.m:defaultMeal()}
function saveQuick(){
  var kcal=kcalFrom($('#qKcal').value),prot=num($('#qProt').value);if(kcal==null&&prot==null){GD.toast('Enter calories or protein.');return}
  var id=GD.rid(),now=Date.now(),name=$('#qName').value.trim()||'Quick add',meal=qMeal();
  var entry={id:id,date:S.foodDate,meal:meal,food_id:null,name:name,brand:null,grams:null,kcal100:null,protein100:null,carbs100:null,fat100:null,kcal:kcal,protein:prot,carbs:null,fat:null,created_at:now};
  addLocal(entry);GD.queue('POST','/api/food/log',{id:id,date:S.foodDate,meal:meal,name:name,kcal:kcal,protein:prot,createdAt:now,_local:entry},{entry:id});
  GD.closeSheet();GD.render();GD.toast('Added '+name+'.');
}
function findEntry(id){return (S.foodDays[S.foodDate]||[]).find(function(e){return e.id===id})}
function editSheet(id){
  var e=findEntry(id);if(!e)return;var per=e.kcal100!=null||e.protein100!=null;
  GD.openSheet('<h2 id="sheetT">'+esc(e.name)+'</h2>'+(e.brand?'<p>'+esc(e.brand)+'</p>':'')
    +(per?'<div class="field"><label for="eg">Grams</label><div class="step big-step"><button data-act="eg-" aria-label="10 grams less">−</button><input id="eg" type="text" inputmode="decimal" autocomplete="off" value="'+esc(g(e.grams))+'"><button data-act="eg+" aria-label="10 grams more">+</button></div></div><div class="calc" id="ecalc">'+calcHtml(calc({kcal:e.kcal100,protein:e.protein100,carbs:e.carbs100,fat:e.fat100},e.grams))+'</div>'
      :'<div class="fgrid2"><div class="field"><label for="eKcal">Calories (kcal)</label><input id="eKcal" inputmode="decimal" value="'+esc(e.kcal==null?'':e.kcal)+'"></div><div class="field"><label for="eProt">Protein (g)</label><input id="eProt" inputmode="decimal" value="'+esc(e.protein==null?'':e.protein)+'"></div></div>')
    +'<div class="seg four" role="group" aria-label="Meal">'+MEALS.map(function(m){return '<button data-act="emeal" data-m="'+m+'" aria-pressed="'+(e.meal===m)+'">'+MEAL_NAME[m]+'</button>'}).join('')+'</div>'
    +'<div class="sheet-btns"><button class="btn primary block big" data-act="esave" data-id="'+esc(e.id)+'">Save</button><button class="btn ghost block danger" data-act="edel" data-id="'+esc(e.id)+'">Delete</button></div>','d-food');
}
function applyPatch(e,p){
  if(p.meal)e.meal=p.meal;
  if(p.grams!=null&&(e.kcal100!=null||e.protein100!=null)){e.grams=r1(p.grams);var c=calc({kcal:e.kcal100,protein:e.protein100,carbs:e.carbs100,fat:e.fat100},e.grams);e.kcal=c.kcal;e.protein=c.protein;e.carbs=c.carbs;e.fat=c.fat}
  if(p.kcal!==undefined&&e.kcal100==null)e.kcal=p.kcal;
  if(p.protein!==undefined&&e.protein100==null)e.protein=p.protein;
}
function saveEdit(id){
  var e=findEntry(id);if(!e)return;var p={};var mb=document.querySelector('[data-act="emeal"][aria-pressed="true"]');if(mb)p.meal=mb.dataset.m;
  if($('#eg')){var gr=num($('#eg').value);if(gr==null||gr<=0){GD.toast('Enter how many grams you had.');return}p.grams=gr}
  else{p.kcal=kcalFrom($('#eKcal').value);p.protein=num($('#eProt').value)}
  applyPatch(e,p);
  GD.queue('PATCH','/api/food/log/'+encodeURIComponent(id),p,{entry:id});saveCache();GD.closeSheet();GD.render();
}
function delEntry(id){
  S.foodDays[S.foodDate]=(S.foodDays[S.foodDate]||[]).filter(function(e){return e.id!==id});
  GD.queue('DELETE','/api/food/log/'+encodeURIComponent(id),null,{entry:id});saveCache();GD.closeSheet();GD.render();GD.toast('Deleted.');
}
function pressSeg(t){t.parentNode.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',String(b===t))})}

/* ---------- copy yesterday + saved meals ---------- */
// Log a list of entries (from yesterday or a saved meal) into a meal on the selected day.
function addEntries(items,meal){
  var now=Date.now(),date=S.foodDate;
  items.forEach(function(it,i){
    var id=GD.rid(),t=now+i;
    var e={id:id,date:date,meal:meal,food_id:it.food_id||null,name:it.name,brand:it.brand||null,grams:it.grams,kcal100:it.kcal100,protein100:it.protein100,carbs100:it.carbs100,fat100:it.fat100,kcal:it.kcal,protein:it.protein,carbs:it.carbs,fat:it.fat,created_at:t};
    var body={id:id,date:date,meal:meal,grams:it.grams,name:it.name,kcal:it.kcal,protein:it.protein,carbs:it.carbs,fat:it.fat,createdAt:t,_local:e};
    if(it.food_id)body.foodId=it.food_id;
    addLocal(e);GD.queue('POST','/api/food/log',body,{entry:id});
  });
}
function copyMeal(meal){
  var prev=GD.dkey(GD.addDays(GD.parseKey(S.foodDate),-1)),items=(S.foodDays[prev]||[]).filter(function(e){return e.meal===meal});
  if(!items.length)return;addEntries(items,meal);GD.haptic();GD.render();GD.toast('Copied '+items.length+' item'+(items.length===1?'':'s')+' into '+MEAL_NAME[meal].toLowerCase()+'.');
}
function saveMealSheet(meal){
  var items=(S.foodDays[S.foodDate]||[]).filter(function(e){return e.meal===meal});if(!items.length)return;
  S.mealDraft={meal:meal,items:items};
  GD.openSheet('<h2 id="sheetT">Save as a meal</h2><p>'+esc(items.map(function(e){return e.name+(e.grams!=null?' '+g(e.grams)+' g':'')}).join(', '))+'</p>'
    +'<div class="field"><label for="mName">Name</label><input id="mName" autocomplete="off" value="'+esc('Usual '+MEAL_NAME[meal].toLowerCase())+'"></div>'
    +'<p class="small">It shows at the top of Recent when you add food, and logs everything in one tap.</p>'
    +'<div class="sheet-btns"><button class="btn primary block big" data-act="msave">Save meal</button><button class="btn ghost block" data-act="sclose">Cancel</button></div>','d-food');
  var i=$('#mName');if(i)i.select();
}
function saveMeal(){
  var d=S.mealDraft;if(!d)return;var name=$('#mName').value.trim();if(!name){GD.toast('Give the meal a name.');return}
  var id=GD.rid(),items=d.items.map(function(e){return {food_id:e.food_id,name:e.name,brand:e.brand,grams:e.grams,kcal100:e.kcal100,protein100:e.protein100,carbs100:e.carbs100,fat100:e.fat100,kcal:e.kcal,protein:e.protein,carbs:e.carbs,fat:e.fat}});
  S.meals=(S.meals||[]).concat([{id:id,name:name,items:items,use_count:0}]);LS.set('meals',S.meals);
  GD.queue('PUT','/api/meals/'+id,{name:name,items:items});S.mealDraft=null;GD.closeSheet();GD.toast('Saved “'+name+'”.');
}
function logMeal(id){
  var m=(S.meals||[]).find(function(x){return x.id===id});if(!m||!S.add)return;var meal=S.add.meal;
  addEntries(m.items,meal);m.use_count=(m.use_count||0)+1;LS.set('meals',S.meals);GD.queue('POST','/api/meals/'+id+'/used');
  GD.haptic();closeAdd();GD.render();GD.toast('Added '+m.name+' to '+MEAL_NAME[meal].toLowerCase()+'.');
}
GD.food={
  openWith:function(f,grams){openAdd(defaultMeal(),'recent');pick(f);S.add.grams=grams;renderAddBody()},
  openSearch:function(q){openAdd(defaultMeal(),'search');doSearch(q)}
};

/* ---------- actions ---------- */
Object.assign(GD.ACT,{
  fday:function(t){var d=GD.addDays(GD.parseKey(S.foodDate),+t.dataset.d),k=GD.dkey(d);if(k>today())return;S.foodDate=k;GD.render()},
  fgo:function(t){S.foodDate=t.dataset.date;GD.render()},
  fadd:function(t){openAdd(t.dataset.meal,t.dataset.t)},
  fquick:quickSheet,
  fcopy:function(t){copyMeal(t.dataset.meal)},
  fsavemeal:function(t){saveMealSheet(t.dataset.meal)},
  msave:saveMeal,
  mlog:function(t){logMeal(t.dataset.id)},
  mdel:function(t){S.add.confirmMeal=t.dataset.id;renderAddBody()},
  mdelno:function(){S.add.confirmMeal=null;renderAddBody()},
  mdelyes:function(t){var id=t.dataset.id;S.meals=(S.meals||[]).filter(function(m){return m.id!==id});LS.set('meals',S.meals);GD.queue('DELETE','/api/meals/'+id);S.add.confirmMeal=null;renderAddBody()},
  fclose:closeAdd,
  fback:function(){var a=S.add;if(!a)return;if(a.picked){a.picked=null;renderAddBody()}else if(a.forRecipe){stopCamera();a.forRecipe=false;a.tab='custom';a.newKind='recipe';renderAddBody()}else closeAdd()},
  nkind:function(t){var a=S.add;if(a.newKind!=='recipe')captureCustom();a.newKind=t.dataset.v;a.msg='';renderAddBody()},
  radd:function(){var a=S.add,r=draftRecipe(),el=$('#rName');if(el)r.name=el.value;saveDraft();a.forRecipe=true;setTab('recent')},
  rdel:function(t){var r=draftRecipe();r.items.splice(+t.dataset.i,1);saveDraft();renderAddBody()},
  rclear:function(){S.add.recipe={name:'',items:[],cooked_g:null,servings:4};LS.del('recipeDraft');renderAddBody()},
  rsave:saveRecipe,
  ringadd:addIngredient,
  redit:function(){var a=S.add,f=a.picked;if(!f||!f.recipe)return;a.recipe={id:f.id,name:f.name,items:GD.clone(f.recipe.items||[]),cooked_g:f.recipe.cooked_g,servings:f.recipe.servings};a.newKind='recipe';a.tab='custom';a.picked=null;renderAddBody()},
  ftab:function(t){setTab(t.dataset.t)},
  fworld:function(){S.add.worldwide=true;doSearch(S.add.q)},
  fpick:function(t){var list=(S.add.lists||{})[t.dataset.g]||[];var f=list[+t.dataset.i];if(f)pick(f)},
  'fg-':function(){setGrams(Math.max(0,(num($('#fg').value)||0)-10))},
  'fg+':function(){setGrams((num($('#fg').value)||0)+10)},
  fgset:function(t){setGrams(num(t.dataset.g))},
  fmeal:function(t){S.add.meal=t.dataset.m;pressSeg(t);var b=document.querySelector('[data-act="flog"]');if(b)b.textContent='Add to '+MEAL_NAME[S.add.meal].toLowerCase();$('#fsT').textContent='How much?'},
  ffav:function(t){var f=S.add.picked;if(!f||!f.id)return;f.favourite=!f.favourite;t.className='star'+(f.favourite?' on':'');t.innerHTML=f.favourite?STAR+' Favourite':STAR_O+' Add to favourites';
    GD.api('PATCH','/api/foods/'+encodeURIComponent(f.id),{favourite:f.favourite}).then(function(b){upsertRecent(Object.assign({},b.food,{last_grams:f.last_grams}))},function(e){GD.toast(e.offline?'Favourites need a connection.':e.message)})},
  fedfood:function(){var a=S.add,f=a.picked;a.custom={id:f.id,source:f.source,source_id:f.source_id,name:f.name,brand:f.brand,barcode:f.barcode,serving_g:f.serving_g,kcal:f.kcal,protein:f.protein,carbs:f.carbs,fat:f.fat};a.picked=null;a.tab='custom';a.msg='';renderAddBody()},
  cper:function(t){var c=S.add.custom=S.add.custom||{};c.perServe=t.dataset.v==='1';pressSeg(t)},
  ftorch:toggleTorch,
  flog:logPicked,
  qmeal:pressSeg,emeal:pressSeg,
  qsave:saveQuick,
  fedit:function(t){editSheet(t.dataset.id)},
  'eg-':function(){editGrams(-10)},'eg+':function(){editGrams(10)},
  esave:function(t){saveEdit(t.dataset.id)},
  edel:function(t){delEntry(t.dataset.id)}
});
function editGrams(d){var i=$('#eg');if(!i)return;var v=Math.max(0,(num(i.value)||0)+d);i.value=g(v);updateEditCalc()}
function updateEditCalc(){var i=$('#eg'),el=$('#ecalc');if(!i||!el)return;var b=document.querySelector('[data-act="esave"]'),e=b&&findEntry(b.dataset.id);if(!e)return;el.innerHTML=calcHtml(calc({kcal:e.kcal100,protein:e.protein100,carbs:e.carbs100,fat:e.fat100},num(i.value)))}

document.addEventListener('submit',function(e){
  if(e.target.id==='fsearch'){e.preventDefault();var q=$('#fq').value.trim();S.add.worldwide=false;doSearch(q)}
  else if(e.target.id==='fbar'){e.preventDefault();var c=$('#fcode').value.replace(/\D/g,'');if(c.length<6){GD.toast('Type the full number under the barcode.');return}lookupBarcode(c)}
  else if(e.target.id==='fcustom'){e.preventDefault();saveCustom()}
});
document.addEventListener('change',function(e){if(e.target.id==='labelFile'&&e.target.files&&e.target.files[0])readLabel(e.target.files[0])});
document.addEventListener('input',function(e){
  var el=e.target;
  if(S.add&&S.add.recipe&&(el.id==='rName'||el.id==='rCooked'||el.id==='rServ'||el.dataset.ri!==undefined)){
    var r=S.add.recipe;
    if(el.id==='rName')r.name=el.value;else if(el.id==='rCooked')r.cooked_g=num(el.value);else if(el.id==='rServ')r.servings=num(el.value);
    else{var it=r.items[+el.dataset.ri];if(it)it.grams=num(el.value)}
    saveDraft();updateRecipeTotals();return;
  }
  if(e.target.id==='fg'&&S.add)setGrams(num(e.target.value),true);
  if(e.target.id==='eg')updateEditCalc();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&e.target.id==='mName'){e.preventDefault();saveMeal();return}
  if(e.key==='Escape'&&S.add){e.preventDefault();GD.ACT.fback()}
  if(e.key==='Enter'&&e.target.id==='fg'){e.preventDefault();logPicked()}
});

/* ---------- lifecycle ---------- */
GD.onFlushed=function(){if(S.tab==='food'){S.foodLoaded[S.foodDate]=false;loadDay(S.foodDate,true)}};
GD.onResume=function(){if(S.tab==='food'){GD.coach.refresh();if(S.foodDate<today()&&S.foodDate===GD.dkey(GD.addDays(new Date(),-1)))S.foodDate=today();loadDay(S.foodDate,true);loadWeek(S.foodDate)}};
GD.onTab=function(t){if(t==='food'){S.foodLoaded[S.foodDate]=false;S.weekTotals.__loaded=0;S.coachTotals=null}};
GD.onImported=function(){S.foodLoaded={};S.foodDays={};S.weekTotals={};S.recent=null};
})();
