/* Gym Desk: Food tab. Barcode scan, search, custom foods, grams, daily calories and protein. */
(function(){
'use strict';
var GD=window.GD,S=GD.S,$=GD.$,esc=GD.esc,LS=GD.LS,num=GD.num,r1=GD.r1;
var MEALS=['breakfast','lunch','dinner','snacks'];
var MEAL_NAME={breakfast:'Breakfast',lunch:'Lunch',dinner:'Dinner',snacks:'Snacks'};
var STAR='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" fill="currentColor"/></svg>';
var STAR_O='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
var SCAN_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8"/></svg>';

S.foodDate=GD.dkey(new Date());
S.foodDays=LS.get('foodDays',{});
S.foodLoaded={};
S.weekTotals={};
S.recent=LS.get('recentFoods',null);
S.add=null;

/* ---------- helpers ---------- */
function today(){return GD.dkey(new Date())}
function g(v){return v==null?'–':v<10?String(r1(v)):String(Math.round(v))}
function kc(v){return v==null?'–':String(Math.round(v))}
function defaultMeal(){var h=new Date().getHours();return h>=4&&h<11?'breakfast':h<15?'lunch':h>=17&&h<21?'dinner':'snacks'}
function targets(){var s=GD.st();return {kcal:s.kcalTarget||null,protein:s.proteinTarget||null}}
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
function loadRecent(){return GD.api('GET','/api/foods/recent').then(function(b){S.recent=b.foods||[];LS.set('recentFoods',S.recent);if(S.add&&S.add.tab==='recent'&&!S.add.picked)renderAddBody()},function(){})}
function rerender(){if(S.tab==='food')GD.render(true)}

/* ---------- day view ---------- */
GD.views.food=function(){
  var date=S.foodDate;loadDay(date);if(!S.weekTotals.__loaded||S.weekTotals.__week!==weekKey(date)){S.weekTotals.__loaded=1;S.weekTotals.__week=weekKey(date);loadWeek(date)}
  if(S.body==null)GD.loadBody();
  var entries=S.foodDays[date],t=targets(),isToday=date===today();
  var d=GD.parseKey(date),label=isToday?'Today':date===GD.dkey(GD.addDays(new Date(),-1))?'Yesterday':GD.WD[d.getDay()];
  var h='<div class="daynav"><button class="arrow" data-act="fday" data-d="-1" aria-label="Previous day">‹</button><div><h1>'+label+'</h1><p>'+GD.fmtDay(date)+'</p></div><button class="arrow" data-act="fday" data-d="1" aria-label="Next day"'+(isToday?' disabled':'')+'>›</button></div>';
  if(!entries)return h+'<div class="skel">Loading food…</div>';
  var tot={kcal:sum(entries,'kcal'),protein:sum(entries,'protein'),carbs:sum(entries,'carbs'),fat:sum(entries,'fat')};
  h+='<section class="card macros">'+macro('Protein',tot.protein,t.protein,'g','prot')+macro('Calories',tot.kcal,t.kcal,'kcal','kcal')
    +'<div class="macro-minor"><span>Carbs <b>'+g(tot.carbs)+' g</b></span><span>Fat <b>'+g(tot.fat)+' g</b></span><span>'+entries.length+' item'+(entries.length===1?'':'s')+'</span></div></section>';
  h+='<div class="food-actions"><button class="btn primary" data-act="fadd" data-t="scan">'+SCAN_ICON+'Scan</button><button class="btn" data-act="fadd" data-t="search">Search</button><button class="btn" data-act="fquick">Quick add</button></div>';
  if(!t.kcal||!t.protein)h+=targetCard(t);
  MEALS.forEach(function(m){
    var list=entries.filter(function(e){return e.meal===m});
    h+='<section class="meal"><div class="meal-head"><h3>'+MEAL_NAME[m]+'</h3><span class="meal-sum">'+(list.length?kc(sum(list,'kcal'))+' kcal · '+g(sum(list,'protein'))+' g protein':'')+'</span></div>'
      +list.map(entryHtml).join('')
      +'<button class="link meal-add" data-act="fadd" data-meal="'+m+'" data-t="recent">+ Add to '+MEAL_NAME[m].toLowerCase()+'</button></section>';
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
function targetCard(t){
  var w=latestWeight(),sug=w?Math.round(w*1.6/5)*5:null;
  return '<section class="card targets"><h3 class="sec">Set your daily targets</h3>'
    +'<p class="small">'+(sug?'Protein: about 1.6 g per kg of bodyweight, so roughly '+sug+' g at '+GD.kg(w)+' kg. ':'Protein: about 1.6 g per kg of bodyweight. Log your weight in Log and I’ll work it out. ')
    +'Calories: not sure? Log a normal week first. Your average is roughly maintenance; for building muscle, aim 200–300 above it.</p>'
    +'<div class="fgrid2"><div class="field"><label for="tProt">Protein (g)</label><input id="tProt" type="text" inputmode="numeric" value="'+esc(t.protein||sug||'')+'"></div>'
    +'<div class="field"><label for="tKcal">Calories (kcal)</label><input id="tKcal" type="text" inputmode="numeric" value="'+esc(t.kcal||'')+'" placeholder="e.g. 2600"></div></div>'
    +'<button class="btn primary" data-act="tsave">Save targets</button></section>';
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
  return h+'</div>'+(t.protein?'<p class="small">Hit your protein on '+hits+' of 7 days.</p>':'')+'</section>';
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
  renderAddBody();
}
function closeAdd(fromPop){stopCamera();S.add=null;var sh=$('#sheet');sh.hidden=true;sh.innerHTML='';document.body.style.overflow='';
  if(!fromPop&&history.state&&history.state.gdAdd){try{history.back()}catch(e){}}}
window.addEventListener('popstate',function(){
  if(!S.add)return;
  if(S.add.picked){S.add.picked=null;renderAddBody();try{history.pushState({gdAdd:true},'')}catch(e){}}
  else closeAdd(true);
});
GD.onSheetClose=function(){if(S.add)closeAdd();document.body.style.overflow=''};
function setTab(t){stopCamera();S.add.tab=t;S.add.picked=null;S.add.msg='';renderAddBody()}
function renderAddBody(){
  var a=S.add;if(!a)return;var body=$('#fsBody');if(!body)return;
  document.querySelectorAll('.fs-tabs button').forEach(function(b){b.setAttribute('aria-pressed',String(!a.picked&&b.dataset.t===a.tab))});
  $('.fs-tabs').hidden=!!a.picked;
  $('#fsT').textContent=a.picked?'How much?':'Add to '+MEAL_NAME[a.meal].toLowerCase();
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
function recentHtml(){
  var list=S.recent;
  if(list==null)return '<div class="skel">Loading your foods…</div>';
  if(!list.length)return '<div class="empty"><h2>Nothing yet</h2><p>Foods you log show up here with the amount you had last time, so repeats take two taps. Scan a barcode or search to add your first.</p><div class="chips"><button class="btn primary" data-act="ftab" data-t="scan">Scan a barcode</button><button class="btn" data-act="ftab" data-t="search">Search</button></div></div>';
  S.add.lists={recent:list};
  return '<div class="results">'+list.map(function(f,i){return resRow(f,i,'recent')}).join('')+'</div>';
}
function searchHtml(){
  var a=S.add,h='<form class="search-row" id="fsearch"><input id="fq" type="search" enterkeyhint="search" autocomplete="off" placeholder="e.g. chicken breast, Chobani" value="'+esc(a.q)+'"><button class="btn primary" type="submit">Search</button></form>';
  if(a.searching)return h+'<div class="skel">Searching…</div>';
  if(!a.results)return h+'<p class="small">Searches your saved foods, Open Food Facts (packaged food, Australian products first) and USDA (whole foods like chicken, rice, eggs).</p>';
  var r=a.results,groups=[['local','Your foods'],['off','Packaged · Open Food Facts'],['usda','Whole foods · USDA']],any=false;
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
    a.results={local:(S.recent||[]).filter(function(f){return (f.name+' '+(f.brand||'')).toLowerCase().indexOf(ql)>=0}),off:[],usda:[],offline:!!e.offline,errors:{}};
    if(!e.offline)GD.toast(e.message);renderAddBody();
  });
}

/* ---------- scanning ---------- */
var cam={stream:null,timer:null,det:null};
function scanHtml(){
  var supported='BarcodeDetector' in window;
  return (supported?'<div class="scanbox"><video id="scanVid" playsinline muted></video><div class="aim"></div><div class="scanmsg" id="scanMsg">Starting camera…</div></div>'
    :'<p class="note">This browser can’t read barcodes from the camera. Chrome on Android can. Type the number under the barcode instead.</p>')
    +(S.add.msg?'<p class="note">'+esc(S.add.msg)+'</p>':'')
    +'<form class="search-row" id="fbar"><input id="fcode" type="text" inputmode="numeric" autocomplete="off" placeholder="Barcode number"><button class="btn" type="submit">Look up</button></form>';
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
    cam.stream=stream;vid.srcObject=stream;return vid.play().then(function(){msg.textContent='Point at the barcode';loop()});
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
function stopCamera(){clearTimeout(cam.timer);if(cam.stream){cam.stream.getTracks().forEach(function(t){t.stop()});cam.stream=null}}
function lookupBarcode(code){
  var a=S.add;if(!a)return;var body=$('#fsBody');if(body)body.innerHTML='<div class="skel">Looking up '+esc(code)+'…</div>';
  GD.api('GET','/api/foods/barcode/'+encodeURIComponent(code)).then(function(b){if(S.add!==a)return;pick(b.food);if(b.from==='off'&&!hasNutrition(b.food))GD.toast('Found it, but it has no nutrition info. Add it from the label.')},function(e){
    if(S.add!==a)return;
    if(e.status===404){a.tab='custom';a.custom={barcode:code};a.msg='Barcode '+code+' isn’t in Open Food Facts yet. Add it from the label and the next scan will find it.';renderAddBody();return}
    var local=(S.recent||[]).find(function(f){return f.barcode===code});
    if(local){pick(local);return}
    a.msg=e.offline?'You’re offline and this product isn’t saved on this phone yet.':e.message;renderAddBody();
  });
}

/* ---------- custom food ---------- */
function customHtml(){
  var c=S.add.custom||{},perServe=!!c.perServe,v=function(k){return esc(c[k]==null?'':c[k])};
  return (S.add.msg?'<p class="note">'+esc(S.add.msg)+'</p>':'')
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
  var a=S.add,f=a.picked,c=calc(f,a.grams),ok=hasNutrition(f);
  var chips=[];if(f.serving_g)chips.push({g:f.serving_g,l:'1 serve · '+g(f.serving_g)+' g'});if(f.serving_g)chips.push({g:r1(f.serving_g*2),l:'2 serves'});
  if(f.last_grams&&f.last_grams!==f.serving_g)chips.push({g:f.last_grams,l:'Last time · '+g(f.last_grams)+' g'});
  [50,100,150,200,250].forEach(function(x){if(!chips.some(function(c){return c.g===x}))chips.push({g:x,l:x+' g'})});
  return '<section class="card amount">'
    +'<div><span class="src">'+(f.source==='off'?'Open Food Facts':f.source==='usda'?'USDA':'Your food')+(f.barcode?' · '+esc(f.barcode):'')+'</span><h3>'+esc(f.name)+'</h3>'+(f.brand?'<p class="small">'+esc(f.brand)+'</p>':'')+'</div>'
    +'<p class="per100">Per 100 g: '+kc(f.kcal)+' kcal · '+g(f.protein)+' g protein · '+g(f.carbs)+' g carbs · '+g(f.fat)+' g fat</p>'
    +(ok?'':'<p class="warn">No calories or protein on file. Add them from the label first.</p>')
    +'<div class="field"><label for="fg">Grams</label><div class="step big-step"><button data-act="fg-" aria-label="10 grams less">−</button><input id="fg" type="text" inputmode="decimal" autocomplete="off" value="'+esc(g(a.grams))+'"><button data-act="fg+" aria-label="10 grams more">+</button></div></div>'
    +'<div class="chips">'+chips.slice(0,7).map(function(x){return '<button class="pick'+(x.g===a.grams?' on':'')+'" data-act="fgset" data-g="'+x.g+'">'+esc(x.l)+'</button>'}).join('')+'</div>'
    +'<div class="calc" id="fcalc">'+calcHtml(c)+'</div>'
    +'<div class="seg four" role="group" aria-label="Meal">'+MEALS.map(function(m){return '<button data-act="fmeal" data-m="'+m+'" aria-pressed="'+(a.meal===m)+'">'+MEAL_NAME[m]+'</button>'}).join('')+'</div>'
    +'<div class="sec-row">'+(f.id?'<button class="star'+(f.favourite?' on':'')+'" data-act="ffav">'+(f.favourite?STAR+' Favourite':STAR_O+' Add to favourites')+'</button>':'<span></span>')+'<button class="link" data-act="fedfood">Edit nutrition</button></div>'
    +'<button class="btn primary block big" data-act="flog"'+(ok?'':' disabled')+'>Add to '+MEAL_NAME[a.meal].toLowerCase()+'</button></section>';
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

/* ---------- actions ---------- */
Object.assign(GD.ACT,{
  fday:function(t){var d=GD.addDays(GD.parseKey(S.foodDate),+t.dataset.d),k=GD.dkey(d);if(k>today())return;S.foodDate=k;GD.render()},
  fgo:function(t){S.foodDate=t.dataset.date;GD.render()},
  fadd:function(t){openAdd(t.dataset.meal,t.dataset.t)},
  fquick:quickSheet,
  fclose:closeAdd,
  fback:function(){var a=S.add;if(!a)return;if(a.picked){a.picked=null;renderAddBody()}else closeAdd()},
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
  flog:logPicked,
  qmeal:pressSeg,emeal:pressSeg,
  qsave:saveQuick,
  fedit:function(t){editSheet(t.dataset.id)},
  'eg-':function(){editGrams(-10)},'eg+':function(){editGrams(10)},
  esave:function(t){saveEdit(t.dataset.id)},
  edel:function(t){delEntry(t.dataset.id)},
  tsave:function(){var p=num($('#tProt').value),k=num($('#tKcal').value);if(!p&&!k){GD.toast('Enter at least one target.');return}
    if(p)GD.setSetting('proteinTarget',Math.round(p),true);if(k)GD.setSetting('kcalTarget',Math.round(k),true);GD.render();GD.toast('Targets saved. Change them any time in Plan → Settings.')}
});
function editGrams(d){var i=$('#eg');if(!i)return;var v=Math.max(0,(num(i.value)||0)+d);i.value=g(v);updateEditCalc()}
function updateEditCalc(){var i=$('#eg'),el=$('#ecalc');if(!i||!el)return;var b=document.querySelector('[data-act="esave"]'),e=b&&findEntry(b.dataset.id);if(!e)return;el.innerHTML=calcHtml(calc({kcal:e.kcal100,protein:e.protein100,carbs:e.carbs100,fat:e.fat100},num(i.value)))}

document.addEventListener('submit',function(e){
  if(e.target.id==='fsearch'){e.preventDefault();var q=$('#fq').value.trim();S.add.worldwide=false;doSearch(q)}
  else if(e.target.id==='fbar'){e.preventDefault();var c=$('#fcode').value.replace(/\D/g,'');if(c.length<6){GD.toast('Type the full number under the barcode.');return}lookupBarcode(c)}
  else if(e.target.id==='fcustom'){e.preventDefault();saveCustom()}
});
document.addEventListener('input',function(e){
  if(e.target.id==='fg'&&S.add)setGrams(num(e.target.value),true);
  if(e.target.id==='eg')updateEditCalc();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&S.add){e.preventDefault();GD.ACT.fback()}
  if(e.key==='Enter'&&e.target.id==='fg'){e.preventDefault();logPicked()}
});

/* ---------- lifecycle ---------- */
GD.onFlushed=function(){if(S.tab==='food'){S.foodLoaded[S.foodDate]=false;loadDay(S.foodDate,true)}};
GD.onResume=function(){if(S.tab==='food'){if(S.foodDate<today()&&S.foodDate===GD.dkey(GD.addDays(new Date(),-1)))S.foodDate=today();loadDay(S.foodDate,true);loadWeek(S.foodDate)}};
GD.onTab=function(t){if(t==='food'){S.foodLoaded[S.foodDate]=false;S.weekTotals.__loaded=0}};
GD.onImported=function(){S.foodLoaded={};S.foodDays={};S.weekTotals={};S.recent=null};
})();
