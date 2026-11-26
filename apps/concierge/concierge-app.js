/* Приложение автоконсьержа — подключено к серверу экосистемы «Мой автомеханик».
   Интерфейс из прототипа, данные и действия — общие с клиенткой, СТО и диспетчером. */
if (new URLSearchParams(location.search).get('embed')) document.body.classList.add('embed');

const ICONS={
 feed:'<path d="M4 6h16M4 12h16M4 18h10"/>',
 trips:'<path d="M5 17h14l-1.5-6.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5Z"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>',
 money:'<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
 me:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'
};
const TYPES={
 partner:{name:'Партнёр (самозанятый)',desc:'Сам выбирает заказы из общей ленты. Выплата за каждый выезд.'},
 staff:{name:'Штатный сотрудник платформы',desc:'Работает по сменам. Видит общую ленту, диспетчер может назначить заказ напрямую. Зарплата по договору, выезды учитываются в смене.'},
 sto:{name:'Сотрудник СТО',desc:'Видит только заказы своей станции. Оплату получает от станции, платформа выплату не начисляет.'}
};
const STEPS=[
 {t:'Заказ принят',s:'Клиентке ушёл push с вашей карточкой'},
 {t:'Выехал к клиентке',s:'Трансляция геопозиции включена'},
 {t:'На месте',s:'Клиентка получила push «Консьерж прибыл»'},
 {t:'Акт осмотра №1',s:'Приёмка машины у клиентки'},
 {t:'В пути в СТО',s:'Клиентка видит вас на карте'},
 {t:'Акт осмотра №2',s:'Передача машины в СТО'},
 {t:'Машина в СТО',s:'Трансляция выключена. Возврат придёт отдельным заказом'}
];
const RSTEPS=[
 {t:'Заказ принят',s:'Клиентке ушёл push: вы вернёте машину'},
 {t:'Еду в СТО',s:'Мастер получит уведомление, когда вы приедете'},
 {t:'В СТО · акт №3',s:'Мастер снимает машину и подписывает акт выдачи'},
 {t:'Везу машину клиентке',s:'Клиентка видит вас на карте'},
 {t:'Акт осмотра №4',s:'Возврат машины клиентке'},
 {t:'Машина у клиентки',s:'Трансляция выключена. Выплата начислена'}
];
const PHOTOS=['Перед','Зад','Левый бок','Правый бок','Колесо ПЛ','Колесо ПП','Колесо ЗЛ','Колесо ЗП','Салон спереди','Салон сзади','Багажник','Приборы: пробег, топливо'];
const KIT=['Ключи (2 шт.)','Техпаспорт','Запасное колесо','Домкрат','Аптечка','Огнетушитель','Знак аварийной остановки'];
const DRIVE_SEC = 40; // демо: поездка ускорена до 40 секунд

const S={tab:'feed',view:'feed',filter:'all',type:'partner',open:null,act:null,sheet:null,toast:null,chatDraft:''};
let V=null, JOBS=[], dismissed=new Set(JSON.parse(localStorage.getItem('ma.k.dismissed')||'[]'));

const $=s=>document.querySelector(s);
const esc=s=>MA.esc(s);
const money=v=>(v<0?'−':'')+Math.abs(v).toFixed(2).replace('.',',')+' Br';
const kmTxt=v=>v==null?'':String(v.toFixed(1)).replace('.',',')+' км';
function hav(a,b){if(!a||!b||!a.lat||!b.lat)return null;const R=6371,t=x=>x*Math.PI/180,dLa=t(b.lat-a.lat),dLo=t(b.lng-a.lng);const h=Math.sin(dLa/2)**2+Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
const fuelTxt=f=>({2:'1/4',3:'3/8',4:'1/2',5:'5/8',6:'3/4',8:'Полный'}[f]||f+'/8');

/* ---------- данные с сервера → заказы консьержа ---------- */
function buildJobs(){
 const me=V.concierge, out=[];
 for(const o of V.orders){
  for(const leg of ['pickup','ret']){
   const L=o[leg]; if(!L) continue;
   const mine=L.conciergeId===MA.who.id;
   if(!mine && L.conciergeId) continue;
   if(!mine && leg==='pickup' && o.status!=='confirmed') continue;
   if(!mine && leg==='ret' && o.status!=='ready') continue;
   const sto=o.sto||{}, client={lng:o.lng,lat:o.lat};
   const isRet=leg==='ret';
   const start=isRet?sto:client, end=isRet?client:sto;
   const toStart=hav(me,start), trip=hav(start,end);
   out.push({id:o.id+(isRet?'·В':'·З'),orderId:o.id,leg,kind:isRet?'Возврат':'Забор',mine,o,L,
    sto:sto.name,stoAddr:sto.address,own:o.stoId==='sto1',
    district:(o.district||'')+' р-н',address:o.address,client:mine?o.client:o.clientShort,
    car:o.car,plate:o.plate||'',gear:o.gear||'АКПП',slot:o.slot,
    km:toStart==null?'':kmTxt(toStart)+(isRet?' до СТО':' до забора'),kmN:toStart||0,
    trip:trip==null?'':kmTxt(trip)+' перегон',pay:V.consts.PAY[leg],urgent:o.urgent,why:o.symptom});
  }
 }
 return out;
}
function activeJob(){
 return JOBS.find(j=>j.mine && (j.leg==='pickup'?j.L.step<6:j.L.step<5))
     || JOBS.find(j=>j.mine && !dismissed.has(j.id) && j.L.ts>=V.resetAt);
}
function stepsOf(j){return j.leg==='ret'?RSTEPS:STEPS}
function visible(){
 let l=JOBS.filter(j=>!j.mine);
 if(S.type==='sto')l=l.filter(o=>o.own);
 if(S.filter==='near')l=l.filter(o=>o.kmN<5);
 if(S.filter==='today')l=l.filter(o=>(o.slot||'').startsWith('Сегодня'));
 if(S.filter==='akpp')l=l.filter(o=>o.gear==='АКПП');
 return l.sort((a,b)=>(b.urgent-a.urgent)||(a.kmN-b.kmN));
}
function go(view,extra){Object.assign(S,{view},extra||{});render();$('#screen').scrollTop=0}
function toast(t){S.toast=t;render();clearTimeout(toast.h);toast.h=setTimeout(()=>{S.toast=null;render()},2800)}
async function act(type,p,ok){try{const r=await MA.act(type,p);if(ok)toast(ok);return r||true}catch(e){toast(e.message);return null}}

function topBar(title,back){return (back?`<button class="back" aria-label="Назад" data-go="${back}">‹</button>`:'')+`<h2>${title}</h2>`}

function orderCard(j,tap){
 const hidden=!j.mine;
 const a=j.leg==='ret'?`${esc(j.sto)}, ${esc(j.stoAddr)}`:(hidden?esc(j.district)+' <span class="hid">· адрес после взятия</span>':esc(j.address));
 const b=j.leg==='ret'?(hidden?esc(j.district)+' <span class="hid">· адрес после взятия</span>':esc(j.address)):`${esc(j.sto)}, ${esc(j.stoAddr)}`;
 return `<${tap?'button':'div'} class="card ${tap?'tap':''}" ${tap?`data-open="${j.id}"`:''}>
  <div class="row"><span class="pill ${j.urgent?'urg':''}">${j.urgent?'Срочно · ':''}${j.kind}</span><span class="pill">${j.gear}</span><span class="pill mono">№${j.orderId}</span><span class="sp"></span>${S.type==='partner'?`<span class="money">${money(j.pay)}</span>`:''}</div>
  <div class="car">${esc(j.car)}</div>
  <div class="route"><i></i><div>${a}</div><span class="ln"></span><span></span><i class="end"></i><div>${b}</div></div>
  <div class="row muted"><span class="mono">${esc(j.slot)}</span><span class="sp"></span><span>${j.km}</span></div>
 </${tap?'button':'div'}>`}

function vFeed(){
 const l=visible(), A=activeJob(), on=V.concierge.onShift;
 let h=`<div class="shift"><div class="t"><b>${on?'На смене':'Не на смене'}</b><small>${on?'Новые заказы приходят push-уведомлением':'Включите, чтобы видеть ленту и брать заказы'}</small></div><button class="sw ${on?'on':''}" id="shiftSw" aria-label="Смена"></button></div>`;
 if(A)h+=`<button class="card tap" data-go="trip" style="border-color:var(--amber)"><div class="row"><span class="pill am">Активный заказ</span><span class="sp"></span><span class="mono">№${A.orderId} · ${A.kind}</span></div><div class="car">${esc(A.car)}</div><div class="muted">${stepsOf(A)[A.L.step].t} · ${stepsOf(A)[A.L.step].s}</div></button>`;
 if(!on)return h+`<div class="empty">Лента появится после начала смены.<br>Геопозиция передаётся только во время заказа.</div>`;
 h+=`<div class="chips">${[['all','Все'],['near','Рядом'],['today','Сегодня'],['akpp','Только АКПП']].map(([k,t])=>`<button class="chip ${S.filter===k?'on':''}" data-f="${k}">${t}</button>`).join('')}</div>`;
 if(S.type==='sto')h+=`<div class="muted">Показаны заказы вашей станции</div>`;
 h+=l.length?l.map(o=>orderCard(o,true)).join(''):`<div class="empty">Подходящих заказов нет. Мы пришлём push, когда появится новый.</div>`;
 return h}

function vOrder(){const j=JOBS.find(x=>x.id===S.open); const A=activeJob();
 if(!j) return `<div class="empty">Заказ уже взял другой консьерж или клиентка его отменила.</div><button class="btn sec" data-go="feed">К ленте</button>`;
 const busy=A&&A.L&&(A.leg==='pickup'?A.L.step<6:A.L.step<5);
 return `${orderCard(j,false)}
 <div class="card"><div class="lbl">Что с машиной</div><div>${esc(j.why)}</div>
 <div class="lbl">Маршрут</div><div class="muted">${j.km} · ${j.trip}</div>
 <div class="lbl">Клиентка</div><div class="hid">Имя, телефон и точный адрес откроются после взятия заказа</div></div>
 ${S.type==='partner'?`<div class="card"><div class="row"><span class="lbl">Выплата за выезд</span><span class="sp"></span><span class="money">${money(j.pay)}</span></div><div class="muted">Опоздание к слоту больше 20 минут — штраф 50% от стоимости выезда.</div></div>`:`<div class="card"><div class="muted">Опоздание к слоту больше 20 минут фиксируется в карточке консьержа.</div></div>`}
 ${busy?`<div class="muted">Сначала завершите текущий заказ №${A.orderId}.</div>`:''}
 ${!V.concierge.onShift?`<div class="muted">Включите смену, чтобы брать заказы.</div>`:''}
 <button class="btn pri" id="take" ${busy||!V.concierge.onShift?'disabled':''}>Взять заказ</button>
 <button class="btn sec" data-go="feed">Пропустить</button>`}

/* ---------- карта-схема: машинка едет по маршруту синхронно с клиенткой ---------- */
const PTS=[[40,120],[110,95],[160,100],[230,60],[300,40]];
function along(pts,t){const seg=[];let tot=0;for(let i=1;i<pts.length;i++){const d=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);seg.push(d);tot+=d}
 let d=t*tot;for(let i=0;i<seg.length;i++){if(d<=seg[i]){const k=seg[i]?d/seg[i]:0;return [pts[i][0]+(pts[i+1][0]-pts[i][0])*k,pts[i][1]+(pts[i+1][1]-pts[i][1])*k]}d-=seg[i]}return pts[pts.length-1]}
function carPos(j){const st=j.L.step,p=j.L.progress||0;
 if(j.leg==='pickup'){ if(st===0)return [0,150]; if(st===1)return along([[0,150],PTS[0]],p); if(st<4)return PTS[0]; if(st===4)return along(PTS,p); return PTS[4]; }
 if(st===0)return [340,0]; if(st===1)return along([[340,0],PTS[4]],p); if(st===2)return PTS[4]; if(st===3)return along(PTS.slice().reverse(),p); return PTS[0];}
function driving(j){return j&&(j.leg==='pickup'?(j.L.step===1||j.L.step===4):(j.L.step===1||j.L.step===3))}
function mapSvg(j){const pos=carPos(j);const live=driving(j);
 return `<div class="map"><svg viewBox="0 0 340 150" preserveAspectRatio="none"><polyline points="${PTS.map(a=>a.join(',')).join(' ')}" fill="none" stroke="var(--amber-dark)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${live?'0':'8 6'}"/><circle cx="40" cy="120" r="7" fill="var(--card)" stroke="var(--ink)" stroke-width="3"/><circle cx="300" cy="40" r="8" fill="var(--amber)" stroke="var(--ink)" stroke-width="2"/><circle id="carDot" cx="${pos[0]}" cy="${pos[1]}" r="9" fill="var(--teal)" stroke="var(--card)" stroke-width="3"/></svg><span class="att">${live?`<b id="tripPct">${Math.round((j.L.progress||0)*100)}%</b> пути · `:''}© OpenMapTiles © OSM</span></div>`}

function slotMinutes(slot){const m=/Сегодня,\s*(\d\d):(\d\d)/.exec(slot||'');if(!m)return null;const d=new Date();d.setHours(+m[1],+m[2],0,0);return Math.round((d-Date.now())/60000)}

function vTrip(){const j=activeJob();if(!j)return `<div class="empty">Нет активного заказа.<br>Возьмите заказ в ленте.</div>`;
 const st=j.L.step, ret=j.leg==='ret', o=j.o;
 let action='';
 const navBtn=`<button class="btn sec" id="nav">Навигатор</button>`;
 const arrived=(j.L.progress||0)>=1;
 if(!ret){
  if(st===0)action=`<button class="btn pri" data-adv>Выехал к клиентке</button>`;
  else if(st===1)action=`<div class="btns">${navBtn}<button class="btn pri" data-adv>${arrived?'Я на месте':'Я на месте'}</button></div>`;
  else if(st===2)action=`<button class="btn pri" data-adv data-then-act="1">Начать акт осмотра №1</button>`;
  else if(st===3)action=`<button class="btn pri" data-act="1">Продолжить акт №1</button>`;
  else if(st===4)action=`<div class="btns">${navBtn}<button class="btn pri" data-adv>Приехал в СТО</button></div>`;
  else if(st===5)action=`<button class="btn pri" data-act="2">Акт №2: передать в СТО</button>`;
  else action=`<div class="muted">${o.acts[2]&&o.acts[2].status==='accepted'?'СТО подтвердила приёмку.':'Ждём, пока СТО подтвердит акт №2.'} Возврат придёт отдельным заказом в ленту.</div><button class="btn pri" id="finish">Закрыть заказ</button>`;
 } else {
  if(st===0)action=`<button class="btn pri" data-adv>Еду в СТО</button>`;
  else if(st===1)action=`<div class="btns">${navBtn}<button class="btn pri" data-adv>Я в СТО</button></div>`;
  else if(st===2)action=`<div class="timer"><span>Мастер «${esc(j.sto)}» снимает машину и подписывает акт выдачи №3. Шаг откроется автоматически.</span></div>`;
  else if(st===3)action=`<div class="btns">${navBtn}<button class="btn pri" data-adv>Приехал к клиентке</button></div>`;
  else if(st===4)action=`<button class="btn pri" data-act="4">Акт №4: вернуть машину</button>`;
  else action=`<div class="muted">${o.paid?'Клиентка оплатила заказ.':'Клиентка проверяет акт №4 и оплачивает заказ.'}</div><button class="btn pri" id="finish">Закрыть заказ</button>`;
 }
 const mins=slotMinutes(o.slot);
 const late=!ret&&st<2&&mins!=null;
 return `${late?`<div class="timer ${mins<-20?'late':''}"><span class="mono">${mins>=0?mins+' мин':'−'+(-mins)+' мин'}</span><span>${mins>=0?`до начала слота ${esc(o.slot.split(', ')[1]||'')}.<br>Выезжайте не позже чем за 30 минут.`:'после начала слота. Больше 20 минут — штраф 50% выезда.'}</span></div>`:''}
 ${mapSvg(j)}
 <div class="card"><div class="row"><span class="car">${esc(o.car)}</span><span class="sp"></span><span class="pill mono">${esc(o.plate||'')}</span></div>
  <div class="route"><i></i><div>${ret?esc(j.sto)+', '+esc(j.stoAddr):esc(o.address)}</div><span class="ln"></span><span></span><i class="end"></i><div>${ret?esc(o.address):esc(j.sto)+', '+esc(j.stoAddr)}</div></div>
  <div class="row"><span>${esc(o.client)}</span><span class="sp"></span><button class="chip" id="chat">Чат${o.chat.length?' · '+o.chat.length:''}</button><button class="chip" id="call">Позвонить</button></div></div>
 <div class="card"><div class="steps">${stepsOf(j).map((s,i)=>`<div class="st ${i<st?'done':i===st?'cur':''}"><span class="d"></span><div><b>${s.t}</b><br><span>${s.s}</span></div></div>`).join('')}</div></div>
 ${action}
 <button class="btn dan" id="sos">Происшествие</button>`}

function vAct(){const a=S.act,n=a.n,done=a.photos.filter(Boolean).length,j=activeJob();
 const ready=done===12&&a.km;
 const title={1:'Приёмка у клиентки',2:'Передача в СТО «'+esc(j?j.sto:'')+'»',4:'Возврат машины клиентке'}[n];
 return `<div class="muted">${title}. Съёмка только камерой, время и геопозиция ставятся автоматически. Без сети акт сохранится и уйдёт позже.</div>
 <div class="row"><span class="lbl">Фото</span><span class="sp"></span><span class="mono">${done} / 12</span><button class="chip" id="allph">Снять все (демо)</button></div>
 <div class="photos">${PHOTOS.map((p,i)=>`<button class="ph ${a.photos[i]?'done':''}" data-ph="${i}">${p}</button>`).join('')}</div>
 <div class="field"><label class="lbl" for="km">Пробег, км</label><input id="km" inputmode="numeric" placeholder="например 128 430" value="${esc(a.km)}"></div>
 <div class="field"><span class="lbl">Топливо</span><div class="fuel">${[1,2,3,4,5,6,7,8].map(i=>`<button aria-label="${i}/8" class="${i<=a.fuel?'on':''}" data-fuel="${i}"></button>`).join('')}</div><span class="muted mono">${fuelTxt(a.fuel)} бака</span></div>
 <div class="field"><span class="lbl">Комплектность</span><div class="grid2">${KIT.map((k,i)=>`<label class="chk"><input type="checkbox" id="kit${i}" data-kit="${i}" ${a.kit[i]?'checked':''}>${k}</label>`).join('')}</div></div>
 <div class="field"><span class="lbl">Повреждения</span>${a.dmg.map(d=>`<div class="row"><span class="pill urg">${esc(d)}</span></div>`).join('')}<button class="btn sec" id="dmg">+ Отметить на схеме кузова</button></div>
 <div class="field"><label class="lbl" for="things">Личные вещи в салоне и багажнике</label><textarea id="things" placeholder="Детское кресло, пакет в багажнике">${esc(a.things)}</textarea></div>
 <button class="btn pri" id="sendAct" ${ready?'':'disabled'}>${n===1?'Отправить клиентке на подтверждение':n===2?'Подписать с мастером СТО':'Передать клиентке на подтверждение'}</button>
 ${ready?'':'<div class="muted">Нужны все 12 фото и пробег.</div>'}`}

function myActs(){const out=[];
 for(const o of V.orders)for(const n of [1,2,4]){const a=o.acts&&o.acts[n];if(a&&a.by===MA.who.id)out.push({o,a})}
 return out.sort((x,y)=>y.a.ts-x.a.ts)}
function actPill(n,st){if(st==='disputed')return '<span class="pill urg">Спор</span>';if(st==='accepted')return '<span class="pill ok">Подтверждён</span>';return `<span class="pill am">${n===2?'Ждёт СТО':'Ждёт клиентку · 24 ч'}</span>`}
function vTrips(){let h='';const A=activeJob();
 if(A)h+=`<div class="lbl">Сейчас</div>`+`<button class="card tap" data-go="trip"><div class="row"><span class="pill am">${stepsOf(A)[A.L.step].t}</span><span class="sp"></span><span class="mono">№${A.orderId} · ${A.kind}</span></div><div class="car">${esc(A.car)}</div></button>`;
 const acts=myActs();
 h+=`<div class="lbl">Акты осмотра</div>`+(acts.length?acts.map(({o,a})=>`<div class="card"><div class="row"><b>Акт №${a.n} · №${o.id}</b><span class="sp"></span>${actPill(a.n,a.status)}</div><div class="muted mono">${esc(o.car)} · пробег ${Number(a.mileage).toLocaleString('ru')} км · топливо ${esc(a.fuel)} · фото ${a.photos}</div></div>`).join(''):`<div class="muted">Пока нет актов</div>`);
 const done=V.ledger.filter(l=>l.sum>0).slice(0,6);
 h+=`<div class="lbl">Завершённые выезды</div>`+(done.length?done.map(l=>`<div class="card"><div class="row"><b>${esc(l.text)}</b><span class="sp"></span><span class="pill ok">${S.type==='partner'?'+'+money(l.sum):'в смене'}</span></div><div class="muted mono">${MA.when(l.ts)}</div></div>`).join(''):'<div class="muted">Пока нет</div>');
 return h}

function vMoney(){
 const L=V.ledger, k=V.concierge, week=L.filter(l=>Date.now()-l.ts<7*864e5);
 const trips=week.filter(l=>l.sum>0).length, fines=k.fines.filter(f=>!f.removed).length;
 if(S.type==='sto')return `<div class="card"><b>Оплату выездов начисляет ваша станция</b><div class="muted">Платформа учитывает ваши поездки и рейтинг, но не делает выплат сотрудникам СТО.</div></div><div class="stat"><div><b>${trips}</b><small>выездов за неделю</small></div><div><b>${rat(k)}</b><small>рейтинг</small></div><div><b>${fines}</b><small>опозданий</small></div></div>`;
 if(S.type==='staff')return `<div class="card"><b>Смена 08:00–20:00</b><div class="muted">Зарплата по трудовому договору. Здесь видно, что засчитано в смену.</div></div><div class="stat"><div><b>${trips}</b><small>выездов за неделю</small></div><div><b>${rat(k)}</b><small>рейтинг</small></div><div><b>${fines}</b><small>опоздание</small></div></div><div class="card">${L.slice(0,8).map(l=>`<div class="tx"><span>${MA.when(l.ts).replace('Сегодня, ','сегодня ')} · ${esc(l.text)}</span><span class="mono ${l.sum<0?'neg':''}">${l.sum<0?'в карточке':'в смене'}</span></div>`).join('')}</div>`;
 const sum=week.reduce((s,l)=>s+l.sum,0);
 return `<div class="stat"><div><b>${money(week.filter(l=>l.sum>0).reduce((s,l)=>s+l.sum,0))}</b><small>за неделю</small></div><div><b>${rat(k)}</b><small>рейтинг</small></div><div><b>${fines}</b><small>штраф</small></div></div>
 <div class="card"><div class="row"><span class="lbl">К выплате в пятницу</span><span class="sp"></span><span class="money">${money(sum)}</span></div><div class="muted">На карту, указанную в профиле. Для самозанятого чек формируется автоматически.</div></div>
 <div class="card">${L.slice(0,10).map(l=>`<div class="tx"><span>${MA.when(l.ts).replace('Сегодня, ','сегодня ')} · ${esc(l.text)}</span><span class="mono ${l.sum<0?'neg':''}">${l.sum>0?'+':l.sum===0?'±':''}${money(l.sum)}</span></div>`).join('')}</div>
 <button class="btn sec" id="dispute">Оспорить штраф</button>`}

function rat(k){return k.rating?String(k.rating).replace('.',','):'—'}
function vMe(){const k=V.concierge;return `<div class="card"><div class="row"><span class="car">${esc(k.full)}</span><span class="sp"></span><span class="pill">${k.trips?'Работает':'Новый'}</span></div><div class="muted">${esc(k.car||'Машина не указана')}${k.phone?' · '+esc(k.phone):''} · ${k.rating?'рейтинг '+rat(k)+' · ':''}${k.trips||0} поездок</div>
 <button class="btn sec" id="editMe" style="margin-top:10px">Изменить данные</button></div>
 <div class="lbl">Тип работы</div>
 <div class="seg">${Object.entries(TYPES).map(([key,v])=>`<label><input type="radio" name="type" id="type-${key}" value="${key}" ${S.type===key?'checked':''}><span><b>${v.name}</b><br><span class="muted">${v.desc}</span></span></label>`).join('')}</div>
 <div class="lbl">Умею водить</div><div class="chips"><span class="chip on">АКПП</span><span class="chip on">МКПП</span><span class="chip">Электромобиль</span></div>
 <div class="lbl">Документы</div>
 <div class="card"><div class="muted">Паспорт, водительское удостоверение и страховку проверяет диспетчер перед первым выездом.</div></div>
 <div class="lbl">Сервер экосистемы</div><div class="card"><div class="tx"><span class="mono" style="font-size:12px">${esc(MA.serverUrl())}</span><span class="mono" style="color:${MA.status==='online'?'var(--teal)':'var(--alert)'}">${MA.status==='online'?'онлайн':'нет связи'}</span></div></div>
 <button class="btn sec" id="support">Написать диспетчеру</button>`}

function sheets(){if(!S.sheet)return '';let h='';const j=activeJob();
 if(S.sheet==='sos')h=`<h3>Что случилось?</h3><div class="muted">Диспетчер получит вызов с вашей геопозицией и заказом. Ответ в течение 2 минут.</div>
  ${['ДТП с машиной клиентки','Машина не заводится или сломалась в пути','Клиентки нет на месте','Отказываюсь принимать машину (не совпадает с заказом)','Другое'].map(t=>`<button class="btn sec" data-sos="${t}">${t}</button>`).join('')}<button class="btn" data-close style="background:none">Отмена</button>`;
 if(S.sheet==='chat'&&j){const msgs=j.o.chat||[];h=`<h3>Чат по заказу №${j.orderId}</h3><div class="muted">Клиентка ${esc(j.o.client)} и мастер видят переписку. Номер телефона скрыт, звонок идёт через приложение.</div><div style="display:flex;flex-direction:column;gap:6px" id="chatBox">${msgs.length?msgs.map(m=>`<div class="msg ${m.from==='concierge'?'out':'in'}">${m.from!=='concierge'?`<small>${esc(m.name)}</small>`:''}${esc(m.text)}</div>`).join(''):'<div class="muted">Сообщений пока нет</div>'}</div>
  <div class="chips">${['Выехал, буду через 15 минут','Я на месте','Не могу найти машину'].map(t=>`<button class="chip" data-say="${t}">${t}</button>`).join('')}</div>
  <div class="chat-in"><input id="chatInp" placeholder="Сообщение" value="${esc(S.chatDraft)}"><button class="btn pri" style="width:auto" id="chatSend">→</button></div><button class="btn sec" data-close>Закрыть</button>`;}
 if(S.sheet==='nav')h=`<h3>Открыть в навигаторе</h3><div class="muted">Выбор запомнится. Навигация идёт во внешнем приложении.</div>${['Яндекс Карты','Google Maps','Organic Maps'].map(t=>`<button class="btn sec" data-navapp="${t}">${t}</button>`).join('')}`;
 if(S.sheet==='dmg')h=`<h3>Повреждение</h3><div class="muted">Отметьте место на схеме кузова и снимите крупно.</div>${['Царапина, передний бампер','Скол, лобовое стекло','Вмятина, левая задняя дверь','Царапина на заднем бампере слева, ~5 см'].map(t=>`<button class="btn sec" data-dmg="${t}">${t}</button>`).join('')}<button class="btn" data-close style="background:none">Отмена</button>`;
 return `<div class="sheet-bg" data-bg><div class="sheet" role="dialog">${h}</div></div>`}

function render(){
 if(!V){$('#screen').innerHTML='<div class="empty">Подключаемся к серверу экосистемы…</div>';return}
 JOBS=buildJobs();
 const A=activeJob();
 if(S.view==='act'&&!S.act)S.view='trip';
 const titles={feed:'Лента заказов',order:'Заказ '+(S.open||''),trip:'Заказ '+(A?'№'+A.orderId:''),act:'Акт осмотра №'+(S.act?S.act.n:''),trips:'Мои заказы',money:S.type==='partner'?'Заработок':'Выезды',me:'Профиль'};
 const back={order:'feed',act:'trip',trip:S.tab==='trips'?'trips':'feed'}[S.view];
 $('#top').innerHTML=topBar(titles[S.view],back);
 const focused=document.activeElement&&document.activeElement.id;
 if(!(S.view==='act'&&(focused==='km'||focused==='things')))
  $('#screen').innerHTML={feed:vFeed,order:vOrder,trip:vTrip,act:vAct,trips:vTrips,money:vMoney,me:vMe}[S.view]();
 $('#tabs').innerHTML=[['feed','Лента'],['trips','Мои заказы'],['money',S.type==='partner'?'Заработок':'Выезды'],['me','Профиль']].map(([k,t])=>`<button class="${S.tab===k?'on':''}" data-tab="${k}"><span class="badge-dot" ${k==='trips'&&A?'data-n="1"':''}><svg viewBox="0 0 24 24">${ICONS[k]}</svg></span>${t}</button>`).join('');
 const chatFocus=document.activeElement&&document.activeElement.id==='chatInp';
 document.querySelectorAll('.sheet-bg,.toast').forEach(e=>e.remove());
 $('#phone').insertAdjacentHTML('beforeend',sheets()+(S.toast?`<div class="toast" role="status">${esc(S.toast)}</div>`:''));
 if(chatFocus){const i=$('#chatInp');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}}
 const cb=$('#chatBox');if(cb)cb.scrollTop=cb.scrollHeight;
 syncDrive();
}

/* ---------- поездка: передаём прогресс на сервер, клиентка видит машинку ---------- */
let driveTimer=null, driveKey='', gpsWatch=null, lastGps=null;
function syncDrive(){
 const j=activeJob(); const key=j&&driving(j)?j.orderId+j.leg+j.L.step:'';
 if(key===driveKey)return; driveKey=key; clearInterval(driveTimer); driveTimer=null;
 if(!key)return;
 let p=j.L.progress||0;
 driveTimer=setInterval(()=>{
  if(p>=1){clearInterval(driveTimer);return}
  p=Math.min(1,p+0.5/DRIVE_SEC);
  MA.loc(j.orderId,j.leg,p,lastGps&&lastGps.lng,lastGps&&lastGps.lat);
 },500);
 if(MA.isNative()&&navigator.geolocation&&gpsWatch==null){
  gpsWatch=navigator.geolocation.watchPosition(pos=>{lastGps={lng:pos.coords.longitude,lat:pos.coords.latitude};MA.act('concierge.loc',lastGps).catch(()=>{})},()=>{},{enableHighAccuracy:true,maximumAge:5000});
 }
}
function onLoc(l){
 if(!V)return; const o=V.orders.find(x=>x.id===l.orderId); if(!o||!o[l.leg])return;
 o[l.leg].progress=l.progress;
 const j=activeJob(); if(!j||j.orderId!==l.orderId||S.view!=='trip')return;
 j.L.progress=l.progress;
 const pos=carPos(j),dot=$('#carDot'),pct=$('#tripPct');
 if(dot){dot.setAttribute('cx',pos[0]);dot.setAttribute('cy',pos[1])}
 if(pct)pct.textContent=Math.round(l.progress*100)+'%';
}

function beep(){try{const c=new (window.AudioContext||window.webkitAudioContext)();[0,.18].forEach((t,i)=>{const o=c.createOscillator(),g=c.createGain();o.frequency.value=i?1046:784;g.gain.setValueAtTime(.0001,c.currentTime+t);g.gain.exponentialRampToValueAtTime(.2,c.currentTime+t+.02);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+t+.16);o.connect(g);g.connect(c.destination);o.start(c.currentTime+t);o.stop(c.currentTime+t+.17)})}catch(e){}}

document.addEventListener('click',async e=>{const t=e.target.closest('button,[data-bg],input');if(!t||!V)return;const d=t.dataset;const j=activeJob();
 if(d.bg!==undefined&&e.target===t){S.sheet=null;return render()}
 if(d.tab){S.tab=d.tab;return go(d.tab)}
 if(d.go)return go(d.go);
 if(d.open)return go('order',{open:d.open});
 if(d.f){S.filter=d.f;return render()}
 if(t.id==='editMe'){const k=V.concierge;const full=prompt('Имя и фамилия',k.full||'');if(full===null)return;const phone=prompt('Телефон',k.phone||'');if(phone===null)return;const car=prompt('Ваша машина',k.car||'');if(car===null)return;return act('concierge.update',{full,phone,car},'Данные сохранены')}
 if(t.id==='shiftSw'){const on=!V.concierge.onShift;return act('concierge.shift',{on},on?'Смена началась. Вы в ленте.':'Смена закончена')}
 if(t.id==='take'){const job=JOBS.find(x=>x.id===S.open);if(!job)return;const r=await act('job.take',{orderId:job.orderId,leg:job.leg});if(r){S.tab='trips';go('trip');toast('Заказ ваш. Клиентка видит вашу карточку.')}return}
 if(d.adv!==undefined&&j){const r=await act('trip.step',{orderId:j.orderId,leg:j.leg});if(r&&d.thenAct)openAct(+d.thenAct);return}
 if(d.act)return openAct(+d.act);
 if(d.ph){S.act.photos[+d.ph]=!S.act.photos[+d.ph];return render()}
 if(t.id==='allph'){S.act.photos.fill(true);return render()}
 if(d.fuel){S.act.fuel=+d.fuel;return render()}
 if(d.kit){S.act.kit[+d.kit]=t.checked;return}
 if(t.id==='dmg'){S.sheet='dmg';return render()}
 if(d.dmg){S.act.dmg.push(d.dmg);S.sheet=null;return render()}
 if(t.id==='sendAct'&&j){const a=S.act;t.disabled=true;
  const r=await act('act.create',{orderId:j.orderId,n:a.n,photos:a.photos.filter(Boolean).length,mileage:a.km,fuel:fuelTxt(a.fuel),damages:a.dmg,kitMissing:KIT.filter((_,i)=>!a.kit[i]),items:a.things});
  if(r){const n=a.n;S.act=null;go('trip');toast(n===1?'Акт отправлен клиентке. Можно ехать.':n===2?'Машина передана в СТО. Трансляция выключена.':'Машина возвращена. Клиентка проверяет акт №4.')}else t.disabled=false;return}
 if(t.id==='finish'&&j){dismissed.add(j.id);localStorage.setItem('ma.k.dismissed',JSON.stringify([...dismissed]));S.tab='money';go('money');return toast(S.type==='partner'?'Заказ закрыт. Выплата начислена.':'Заказ закрыт.')}
 if(t.id==='sos'){S.sheet='sos';return render()}
 if(d.sos){S.sheet=null;return act('sos.create',{scenario:d.sos,orderId:j&&j.orderId},'Вызов передан диспетчеру: «'+d.sos+'»')}
 if(t.id==='chat'){S.sheet='chat';return render()}
 if(d.say&&j){return act('chat.send',{orderId:j.orderId,text:d.say})}
 if(t.id==='chatSend'&&j){const v=($('#chatInp').value||'').trim();if(!v)return;S.chatDraft='';const r=await act('chat.send',{orderId:j.orderId,text:v});if(!r)S.chatDraft=v;return}
 if(t.id==='call')return toast('Звонок через приложение, номер скрыт');
 if(t.id==='nav'){S.sheet='nav';return render()}
 if(d.navapp&&j){S.sheet=null;const o=j.o,dest=(j.leg==='pickup'?(j.L.step<2?o:o.sto):(j.L.step<2?o.sto:o));const ll=dest.lat+','+dest.lng;
  const url=d.navapp==='Яндекс Карты'?`https://yandex.ru/maps/?rtext=~${ll}&rtt=auto`:d.navapp==='Google Maps'?`https://www.google.com/maps/dir/?api=1&destination=${ll}`:`https://organicmaps.app/route?sll=&dll=${ll}`;
  window.open(url,'_blank');return toast('Открываем '+d.navapp)}
 if(d.close!==undefined){S.sheet=null;return render()}
 if(t.id==='dispute')return act('fine.dispute',{reason:'Прошу пересмотреть штраф за опоздание'},'Диспетчер получил запрос. Ответ в течение 15 минут.');
 if(t.id==='support')return toast('Открыт чат с диспетчером');
 if(t.name==='type'){S.type=t.value;S.filter='all';localStorage.setItem('ma.k.type',S.type);act('concierge.type',{type:S.type});return render()}
});
document.addEventListener('input',e=>{
 if(e.target.id==='chatInp'){S.chatDraft=e.target.value;return}
 if(!S.act)return;if(e.target.id==='km'){S.act.km=e.target.value;const b=$('#sendAct');const ok=S.act.photos.every(Boolean)&&S.act.km;if(b)b.disabled=!ok}if(e.target.id==='things')S.act.things=e.target.value});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='chatInp'){e.preventDefault();$('#chatSend').click()}});

function openAct(n){const j=activeJob();if(!j)return;
 const prev=j.o.acts[n-1]||j.o.acts[1];
 S.act={n,photos:Array(12).fill(false),km:prev&&n!==1?String(prev.mileage+(n===2?12:16)):'',fuel:4,kit:KIT.map(()=>true),dmg:prev?prev.damages.slice():[],things:prev?prev.items:''};
 go('act')}

window.MA_OPEN_LINK=(l)=>{const v=(l&&l.view)||'feed';if(v==='trip'){S.tab='trips';go('trip')}else if(v==='money'){S.tab='money';go('money')}else{S.tab='feed';go('feed')}};
S.type=localStorage.getItem('ma.k.type')||'partner';
render();
MA.connect({role:'concierge',badge:{pos:'top-right',compact:true},
 onState(v){const was=V&&activeJob();V=v;if(v.concierge&&v.concierge.type&&!localStorage.getItem('ma.k.type'))S.type=v.concierge.type;render();
  const now=activeJob();if(!was&&now&&now.L.assignedBy==='dispatcher'&&now.L.step===0){S.tab='trips';go('trip')}},
 onNotify(n){toast(n.title+(n.text?' · '+n.text:''));if(n.sound)beep()},
 onLoc});
