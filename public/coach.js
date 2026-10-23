/* Gym Desk: targets calculator, weekly check-in and "what to eat next". */
(function(){
'use strict';
var GD=window.GD,S=GD.S,$=GD.$,esc=GD.esc,num=GD.num,r1=GD.r1;

var ACTIVITY=[
  {v:1.2,t:'Mostly sitting',d:'Desk job, little or no exercise'},
  {v:1.375,t:'Lightly active',d:'Desk job, train 1–3 days a week'},
  {v:1.55,t:'Active',d:'Train 3–5 days a week and walk most days, or on your feet at work'},
  {v:1.725,t:'Very active',d:'Physical job, or train hard 6–7 days a week'}
];
var GOALS={
  gain:{t:'Build muscle',d:'Small surplus. Aim to gain about 0.25% of your weight a week.',kcal:1.10,rate:0.0025,prot:1.6},
  maintain:{t:'Maintain',d:'Eat at maintenance and get stronger. Good for recomposition.',kcal:1.0,rate:0,prot:1.6},
  lose:{t:'Lose fat',d:'Moderate deficit, extra protein to keep muscle. About 0.5% a week.',kcal:0.80,rate:-0.005,prot:2.0}
};
S.coachTotals=null;

function round(n,step){return Math.round(n/step)*step}
function profile(){return Object.assign({sex:'',age:null,height:null,activity:1.375,goal:'gain'},GD.st().profile||{})}
function ageOf(p){if(p.birthYear)return new Date().getFullYear()-p.birthYear;return p.age||null}
function weightNow(){
  var list=(S.body||[]).filter(function(x){return x.weight!=null});if(!list.length)return null;
  var base=GD.parseKey(list[0].date),recent=list.filter(function(x){return (base-GD.parseKey(x.date))/86400000<7});
  return r1(recent.reduce(function(a,x){return a+x.weight},0)/recent.length);
}

// Mifflin-St Jeor for resting burn, times activity, then the goal adjustment.
function compute(p,w){
  var age=ageOf(p);
  if(!p.sex||!age||!p.height||!w)return null;
  var bmr=10*w+6.25*p.height-5*age+(p.sex==='m'?5:-161);
  var tdee=bmr*(p.activity||1.375),G=GOALS[p.goal]||GOALS.gain;
  var kcal=round(tdee*G.kcal,50);
  var protein=round(w*G.prot,5);
  var fat=Math.max(round(kcal*0.25/9,5),round(w*0.6,5));
  var carbs=Math.max(0,round((kcal-protein*4-fat*9)/4,5));
  return {bmr:Math.round(bmr),tdee:round(tdee,50),kcal:kcal,protein:protein,fat:fat,carbs:carbs};
}

/* ---------- targets sheet ---------- */
function open(){
  var p=profile(),w=weightNow(),age=ageOf(p);
  GD.openSheet('<h2 id="sheetT">Your targets</h2><p>A starting point from the standard formula. After two weeks of logging, the weekly check-in fine-tunes calories from your real weight trend.</p>'
    +'<div class="field"><span class="flabel">Sex (the formula differs)</span><div class="seg" role="group" style="grid-template-columns:1fr 1fr"><button data-act="cset" data-k="sex" data-v="m" aria-pressed="'+(p.sex==='m')+'">Male</button><button data-act="cset" data-k="sex" data-v="f" aria-pressed="'+(p.sex==='f')+'">Female</button></div></div>'
    +'<div class="fgrid"><div class="field"><label for="cAge">Age</label><input id="cAge" inputmode="numeric" autocomplete="off" value="'+esc(age||'')+'"></div>'
    +'<div class="field"><label for="cHt">Height (cm)</label><input id="cHt" inputmode="decimal" autocomplete="off" value="'+esc(p.height||'')+'"></div>'
    +'<div class="field"><label for="cWt">Weight (kg)</label><input id="cWt" inputmode="decimal" autocomplete="off" value="'+esc(w||'')+'" placeholder="–"></div></div>'
    +(w?'<p class="small">Weight is your 7-day average from Log.</p>':'<p class="small">No weigh-ins yet. Whatever you type here is saved as today’s weight.</p>')
    +'<div class="field"><span class="flabel">Activity</span><div class="results">'+ACTIVITY.map(function(a){return '<button class="res'+(p.activity===a.v?' on':'')+'" data-act="cset" data-k="activity" data-v="'+a.v+'" aria-pressed="'+(p.activity===a.v)+'"><span class="row-name">'+a.t+'<small>'+a.d+'</small></span><span class="res-nums">'+(p.activity===a.v?'✓':'')+'</span></button>'}).join('')+'</div></div>'
    +'<div class="field"><span class="flabel">Goal</span><div class="seg" role="group">'+Object.keys(GOALS).map(function(k){return '<button data-act="cset" data-k="goal" data-v="'+k+'" aria-pressed="'+(p.goal===k)+'">'+GOALS[k].t+'</button>'}).join('')+'</div><p class="small" id="cGoalD">'+GOALS[p.goal].d+'</p></div>'
    +'<div id="cOut"></div>'
    +'<div class="sheet-btns"><button class="btn primary block big" data-act="capply" id="cApply">Use these targets</button><button class="btn ghost block" data-act="sclose">Cancel</button></div>','d-food coach');
  S.coachDraft=p;update();
}
function draft(){
  var p=S.coachDraft;if(!p)return null;
  p.age=num($('#cAge').value);p.height=num($('#cHt').value);
  return {p:p,w:num($('#cWt').value)};
}
function update(){
  var d=draft();if(!d)return;var r=compute(d.p,d.w),out=$('#cOut'),btn=$('#cApply');
  if(!r){out.innerHTML='<p class="note">Fill in sex, age, height and weight to see your numbers.</p>';btn.disabled=true;return}
  btn.disabled=false;
  out.innerHTML='<div class="calc"><div><b>'+r.kcal+'</b><span>kcal</span></div><div><b>'+r.protein+'</b><span>protein</span></div><div><b>'+r.carbs+'</b><span>carbs</span></div><div><b>'+r.fat+'</b><span>fat</span></div></div>'
    +'<p class="small">Maintenance is about '+r.tdee+' kcal a day (resting '+r.bmr+' × activity). Protein is '+GOALS[d.p.goal].prot+' g per kg; fat is about a quarter of calories; carbs fill the rest.</p>';
}
function apply(){
  var d=draft();var r=compute(d.p,d.w);if(!r)return;
  var p={sex:d.p.sex,birthYear:new Date().getFullYear()-Math.round(d.p.age),height:d.p.height,activity:d.p.activity,goal:d.p.goal};
  if(!weightNow()&&d.w){var today=GD.dkey(new Date());S.body=[{date:today,weight:r1(d.w)}].concat(S.body||[]);GD.queue('PUT','/api/body/'+today,{weight:r1(d.w)});GD.LS.set('body',S.body)}
  GD.setSettings({profile:p,kcalTarget:r.kcal,proteinTarget:r.protein,fatTarget:r.fat,carbTarget:r.carbs,targetsSetAt:GD.dkey(new Date())});
  S.coachDraft=null;GD.closeSheet();GD.toast('Targets set: '+r.kcal+' kcal, '+r.protein+' g protein.');
}

/* ---------- weekly check-in ---------- */
function refresh(){
  var to=GD.dkey(GD.addDays(new Date(),-1)),from=GD.dkey(GD.addDays(new Date(),-21));
  return GD.api('GET','/api/food/totals?from='+from+'&to='+to).then(function(b){S.coachTotals={};(b.days||[]).forEach(function(d){S.coachTotals[d.date]=d});if(S.tab==='food')GD.render(true)},function(){if(S.coachTotals==null)S.coachTotals={}});
}
function dayKcal(k){
  var local=S.foodDays&&S.foodDays[k];
  if(local)return local.reduce(function(a,e){return a+(e.kcal||0)},0);
  var t=S.coachTotals&&S.coachTotals[k];return t?t.kcal:0;
}
function checkin(){
  var s=GD.st(),p=s.profile;if(!p||!s.kcalTarget)return null;
  var days=[],i;for(i=1;i<=14;i++)days.push(GD.dkey(GD.addDays(new Date(),-i)));
  var floor=Math.max(1000,0.6*s.kcalTarget),logged=days.filter(function(k){return dayKcal(k)>=floor});
  var since=GD.dkey(GD.addDays(new Date(),-15)),wts=(S.body||[]).filter(function(x){return x.weight!=null&&x.date>=since});
  var span=wts.length>1?(GD.parseKey(wts[0].date)-GD.parseKey(wts[wts.length-1].date))/86400000:0;
  var need={days:Math.max(0,10-logged.length),weighs:Math.max(0,4-wts.length),span:span<7};
  var ready=!need.days&&!need.weighs&&!need.span;
  var due=!s.lastCheckin||(GD.parseKey(GD.dkey(new Date()))-GD.parseKey(s.lastCheckin))/86400000>=7;
  var startedAt=s.targetsSetAt||s.lastCheckin;
  var res={ready:ready,due:due,need:need,logged:logged.length,weighs:wts.length,young:startedAt&&(GD.parseKey(GD.dkey(new Date()))-GD.parseKey(startedAt))/86400000<14};
  if(!ready)return res;
  // Least-squares slope of weight over time, in kg per day.
  var xs=wts.map(function(x){return -(GD.parseKey(GD.dkey(new Date()))-GD.parseKey(x.date))/86400000}),ys=wts.map(function(x){return x.weight});
  var mx=xs.reduce(function(a,b){return a+b},0)/xs.length,my=ys.reduce(function(a,b){return a+b},0)/ys.length,nu=0,de=0;
  for(i=0;i<xs.length;i++){nu+=(xs[i]-mx)*(ys[i]-my);de+=(xs[i]-mx)*(xs[i]-mx)}
  var slope=de?nu/de:0,avg=logged.reduce(function(a,k){return a+dayKcal(k)},0)/logged.length;
  var est=avg-slope*7700,G=GOALS[p.goal]||GOALS.gain,w=weightNow()||my;
  var want=est+G.rate*w/7*7700,target=round(Math.max(s.kcalTarget-250,Math.min(s.kcalTarget+250,want)),50);
  return Object.assign(res,{avg:Math.round(avg),weekly:r1(slope*7),est:round(est,50),target:target,goal:G,goalRate:r1(G.rate*w)});
}
function checkinCard(c){
  var s=GD.st(),same=c.target===s.kcalTarget,dir=c.weekly>0?'+':'';
  return '<section class="card targets"><h3 class="sec">Weekly check-in</h3>'
    +'<p>Over the last 2 weeks you averaged <b>'+c.avg+' kcal</b> on '+c.logged+' logged days, and your weight trend is <b>'+dir+c.weekly+' kg a week</b>. That puts your maintenance near '+c.est+' kcal.</p>'
    +'<p class="small">Goal: '+c.goal.t.toLowerCase()+(c.goalRate?' at about '+(c.goalRate>0?'+':'')+c.goalRate+' kg a week':'')+'. '
    +(same?'Your current target of '+s.kcalTarget+' kcal is right on track.':'Suggested target: '+c.target+' kcal (now '+s.kcalTarget+'). Changes are capped at 250 kcal a week.')+'</p>'
    +'<div class="fgrid2">'+(same?'<button class="btn primary" data-act="ckeep">Got it</button>':'<button class="btn primary" data-act="cupd" data-k="'+c.target+'">Update to '+c.target+'</button><button class="btn" data-act="ckeep">Keep '+s.kcalTarget+'</button>')+'</div></section>';
}
function recordCheckin(c,applied){
  var s=GD.st(),hist=(s.checkins||[]).slice(-25),today=GD.dkey(new Date()),patch={lastCheckin:today};
  hist.push({date:today,avg:c.avg,weekly:c.weekly,est:c.est,target:c.target,applied:!!applied});patch.checkins=hist;
  if(applied){patch.kcalTarget=c.target;if(s.proteinTarget&&s.fatTarget)patch.carbTarget=Math.max(0,round((c.target-s.proteinTarget*4-s.fatTarget*9)/4,5))}
  GD.setSettings(patch);
}

/* ---------- what to eat next ---------- */
function suggestions(remaining){
  var foods=(S.recent||[]).filter(function(f){return f.protein>=8&&f.kcal>0&&f.protein*4/f.kcal>=0.25});
  foods.sort(function(a,b){return b.protein/b.kcal-a.protein/a.kcal});
  return foods.slice(0,3).map(function(f){
    var need=Math.min(remaining,45),grams=need/f.protein*100;
    if(f.serving_g){var n=Math.max(1,Math.round(grams/f.serving_g));grams=n*f.serving_g}else grams=Math.min(400,Math.max(30,Math.round(grams/10)*10));
    return {f:f,grams:r1(grams),protein:r1(f.protein*grams/100),kcal:Math.round(f.kcal*grams/100)};
  });
}
function suggestCard(remaining){
  var list=suggestions(remaining);S.coachSug=list;
  var h='<section class="card targets"><h3 class="sec">'+Math.round(remaining)+' g protein to go</h3>';
  if(list.length)h+='<p class="small">From foods you eat. Tap one to log it.</p><div class="results">'+list.map(function(x,i){return '<button class="res" data-act="csug" data-i="'+i+'"><span class="row-name">'+esc(x.f.name)+'<small>'+GD.kg(x.grams)+' g'+(x.f.serving_g?' · '+Math.round(x.grams/x.f.serving_g)+' serve'+(Math.round(x.grams/x.f.serving_g)===1?'':'s'):'')+'</small></span><span class="res-nums">+'+Math.round(x.protein)+' g protein<small>'+x.kcal+' kcal</small></span></button>'}).join('')+'</div>';
  else h+='<p class="small">High-protein options: tap one to search.</p>';
  h+='<div class="chips">'+['Chicken breast','Greek yoghurt','Tuna','Eggs','Protein powder'].map(function(q){return '<button class="pick" data-act="csearch" data-q="'+q+'">'+q+'</button>'}).join('')+'</div></section>';
  return h;
}

/* ---------- cards on the Food tab ---------- */
function cards(date,entries,tot,t){
  var h='',isToday=date===GD.dkey(new Date());
  if(!t.kcal||!t.protein){
    return '<section class="card targets"><h3 class="sec">Set your daily targets</h3><p class="small">Enter your height, weight, age, activity and goal, and Gym Desk works out calories, protein, carbs and fat.</p><button class="btn primary" data-act="copen">Work out my targets</button></section>';
  }
  if(!isToday)return '';
  if(S.coachTotals==null)refresh();
  var c=checkin();
  if(c&&c.ready&&c.due)h+=checkinCard(c);
  var remaining=t.protein-tot.protein;
  if(remaining>=20&&new Date().getHours()>=12)h+=suggestCard(remaining);
  return h;
}
function progressNote(){
  var s=GD.st();if(!s.profile||!s.kcalTarget)return '';
  var c=checkin();if(!c)return '';
  if(c.ready&&!c.due){var next=GD.addDays(GD.parseKey(s.lastCheckin),7);return '<p class="small">Next check-in '+GD.fmtDay(GD.dkey(next))+'.</p>'}
  if(c.ready)return '';
  var bits=[];if(c.need.days)bits.push('log food on '+c.need.days+' more day'+(c.need.days===1?'':'s'));if(c.need.weighs)bits.push('weigh in '+c.need.weighs+' more time'+(c.need.weighs===1?'':'s'));
  if(!bits.length&&c.need.span)bits.push('keep weighing in over a full week');
  return '<p class="small">First check-in: '+bits.join(' and ')+' in the last 2 weeks. A day counts once it has most of your food logged.</p>';
}

/* ---------- actions ---------- */
Object.assign(GD.ACT,{
  copen:open,
  cset:function(t){
    var p=S.coachDraft;if(!p)return;var k=t.dataset.k,v=t.dataset.v;p[k]=k==='activity'?Number(v):v;
    t.parentNode.querySelectorAll('button').forEach(function(b){var on=b===t;b.setAttribute('aria-pressed',String(on));if(k==='activity'){b.classList.toggle('on',on);b.querySelector('.res-nums').textContent=on?'✓':''}});
    if(k==='goal')$('#cGoalD').textContent=GOALS[v].d;update();
  },
  capply:apply,
  cupd:function(){var c=checkin();if(c&&c.ready)recordCheckin(c,true);GD.toast('Calorie target updated.')},
  ckeep:function(){var c=checkin();if(c&&c.ready)recordCheckin(c,false)},
  csug:function(t){var x=(S.coachSug||[])[+t.dataset.i];if(x)GD.food.openWith(x.f,x.grams)},
  csearch:function(t){GD.food.openSearch(t.dataset.q)}
});
document.addEventListener('input',function(e){if(S.coachDraft&&/^c(Age|Ht|Wt)$/.test(e.target.id))update()});

GD.coach={open:open,cards:cards,progressNote:progressNote,refresh:refresh,compute:compute};
})();
