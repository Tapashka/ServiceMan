/* =====================================================================
   «Мой автомеханик» v2.0 — клиентское приложение в экосистеме
   Прототип v1.9 подключён к серверу: заявка уходит в панель СТО, предложения СТО приходят живыми,
   консьерж двигается по карте по данным из его приложения, смету присылает мастер,
   акты подтверждаются здесь и видны СТО и диспетчеру, SOS и споры уходят в диспетчерскую.
   ===================================================================== */
(function(){
  const ME = new URLSearchParams(location.search).get('as') || 'c1';
  let V = null, O = null, first = true;
  const esc = (s)=>MA.esc(s);
  const MAIN = CONVS[0].msgs;                  // массив чата с СТО (на него ссылается и чат на главной)
  const ACT_TITLES = {1:'Забор у клиентки', 2:'Передача в СТО', 3:'Выдача из СТО', 4:'Возврат клиентке'};
  const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const DOW = ['ВОСКРЕСЕНЬЕ','ПОНЕДЕЛЬНИК','ВТОРНИК','СРЕДА','ЧЕТВЕРГ','ПЯТНИЦА','СУББОТА'];

  document.getElementById('homeChatDemo').style.display = 'none';
  const css = document.createElement('style');
  css.textContent = `.trk-steps{display:flex;flex-direction:column;gap:5px;margin-top:10px;font-size:12.5px;color:var(--ink-faint)}
    .trk-steps>div{display:flex;align-items:center;gap:8px}.trk-steps i{width:9px;height:9px;border-radius:50%;border:2px solid var(--line);flex:none}
    .trk-steps .done{color:var(--ink-soft)}.trk-steps .done i{background:var(--teal);border-color:var(--teal)}
    .trk-steps .cur{color:var(--ink);font-weight:600}.trk-steps .cur i{background:var(--amber);border-color:var(--amber)}
    .stage-dot-wrap.viewing .lbl{text-decoration:underline}
    body.embed{background:var(--paper)!important}`;
  document.head.appendChild(css);
  if(new URLSearchParams(location.search).get('embed') || MA.isNative()) document.body.classList.add('embed','full');
  CONVS[1].active = false; chatDemo = null;
  acts = [];
  notifications.length = 0;

  // ---------------- выбор активного заказа ----------------
  function pickActive(){
    const list = (V.orders||[]).filter(o=>o.status!=='cancelled').sort((a,b)=>b.createdAt-a.createdAt);
    return list.find(o=>o.status!=='closed') || list.find(o=>o.status==='closed' && !o.rating && Date.now()-(o.paidTs||0) < 6*3600e3) || null;
  }
  const K = (id)=> id && V.concierges[id] ? V.concierges[id] : null;
  function legConcierge(){ if(!O) return null; if(O.ret && O.ret.conciergeId) return K(O.ret.conciergeId); if(O.pickup && O.pickup.conciergeId) return K(O.pickup.conciergeId); return null; }
  function stoOf(o){ return o && o.stoId ? V.stos[o.stoId] : null; }
  function realStage(){
    if(!O) return 0;
    if(O.status==='at_sto') return O.stage;
    if(['ready','returned','closed'].includes(O.status)) return 4;
    return 0;
  }
  const kmTo = (s)=> s && V.client ? +(haversine(V.client, s)/1000).toFixed(1) : 0;

  // ---------------- данные сервера → структуры прототипа ----------------
  function syncOffers(){
    offers.length = 0;
    if(!O) return;
    const sorted = O.offers.slice().sort((a,b)=>a.ts-b.ts);
    sorted.forEach((f,i)=>{
      const s = V.stos[f.stoId];
      offers.push({ id:f.id, stoId:f.stoId, initials:s.initials, name:s.name, rating:s.rating, distance:kmTo(s), price:f.price, note:f.note||'',
        badges: i===0 && sorted.length>1 ? ['Ответили первыми'] : [], address:s.address, lng:s.lng, lat:s.lat,
        estimate: f.items.map(x=>({item:x.name, price:x.price})) });
      STO_HINTS[f.id] = s.hint;
    });
    if(offers.length) computePriceTiers();
    offersRevealed = offers.length;
    if(O.stoId){ const f = offers.find(x=>x.stoId===O.stoId) || null; if(f) chosenOffer = f; }
  }

  function dmgPos(t, i){
    const s = t.toLowerCase();
    const y = /задн|багаж/.test(s) ? 84 : /перед|капот|лобов/.test(s) ? 4 : 44;
    const x = /лев/.test(s) ? 30 : /прав/.test(s) ? 70 : 50;
    return { x, y: y + (i%2)*3, text:t };
  }
  function syncActs(){
    acts = [];
    if(!O) return;
    const k = K((O.pickup&&O.pickup.conciergeId)) || K(O.ret&&O.ret.conciergeId);
    const kr = K(O.ret&&O.ret.conciergeId) || k;
    const s = stoOf(O);
    [1,2,3,4].forEach(n=>{
      const a = O.acts[n]; if(!a) return;
      const kk = n>=3 ? kr : k;
      acts[n-1] = { n, title: O.delivery==='self' && n===3 ? 'Выдача клиентке' : ACT_TITLES[n],
        who: n===1||n===4 ? `${kk?kk.name:'Консьерж'} · автоконсьерж` : n===2 ? (O.delivery==='self' ? `Вы → ${s.name}` : `${kk?kk.name:'Консьерж'} → ${s.name}`) : `${s.name} → ${O.delivery==='self'?'вам':(kk?kk.name:'консьерж')}`,
        when: MA.when(a.ts), place:a.place, mileage:a.mileage, fuel:a.fuel, dmgPhotos: a.damages.length?[1]:[],
        damages: a.damages.map(dmgPos), kitMissing:a.kitMissing||[], items:a.items||'—',
        status: a.status, deadline: 'до ' + MA.when(a.ts + 24*3600e3).toLowerCase(), mine: n===1||n===4, kName: kk?kk.name:'' };
    });
  }

  function syncChat(){
    const before = MAIN.length;
    MAIN.length = 0;
    if(O) O.chat.forEach(m=>MAIN.push({ from: m.from==='client'?'out':'in', text: (m.from==='concierge'||m.from==='dispatcher') ? `${m.name}: ${m.text}` : m.text, time: MA.hhmm(m.ts) }));
    const s = stoOf(O);
    CONVS[0].id = O ? O.id : '—';
    CONVS[0].name = s ? s.name : 'Чат';
    CONVS[0].ini = s ? s.initials : '…';
    CONVS[0].sub = O ? `${O.car.split(',')[0]} · заявка №${O.id}` : '';
    CONVS[0].active = !!(O && O.stoId && O.status!=='closed');
    if(first) CONVS[0].seen = MAIN.length;
    else if(currentScreen==='chat' && currentConv===CONVS[0]) CONVS[0].seen = MAIN.length;
    return MAIN.length !== before;
  }

  function linkTarget(l){
    l = l || {};
    return ()=>{
      if(l.view==='status') return go(O ? 'status' : 'home');
      if(l.view==='offers') return previewOffers();
      if(l.view==='inspect' && l.n && acts[l.n-1]) return openInspect(l.n-1, 'notifs');
      if(l.view==='compare' && acts[0] && acts[3]) return go('compare');
      if(l.view==='chat') return go('chat');
      if(l.view==='service') return openService(l.key, 'notifs');
      if(l.view==='profile') return go('profile');
      go(O ? 'status' : 'home');
    };
  }
  function syncNotifs(){
    notifications.length = 0;
    V.notifications.forEach(n=>notifications.push({ id:n.id, cat:n.cat||'order', ico: ICONS[n.ico] ? n.ico : 'order', title:n.title, text:n.text,
      time: MA.when(n.ts).replace('Сегодня, ',''), group: MA.group(n.ts), unread: !n.read, target: linkTarget(n.link) }));
  }

  function applyState(v){
    V = v;
    const prevO = O;
    O = pickActive();
    const c = V.client;
    cars = c.cars.map(x=>Object.assign({}, x));
    userPlan = c.plan || userPlan;
    PLACES.pickup.lng = c.lng; PLACES.pickup.lat = c.lat; PLACES.pickup.label = c.address;
    if(O && O.lng){ PLACES.pickup.lng = O.lng; PLACES.pickup.lat = O.lat; PLACES.pickup.label = O.address; }
    deliveryMode = O && O.stoId ? O.delivery : deliveryMode;
    syncOffers(); syncActs(); syncChat(); syncNotifs();
    const mySos = (V.sos||[]).filter(s=>s.step<4 && s.kind!=='tow')[0];
    sosState = mySos ? 'calling' : null;
    if(mySos) sosScenario = mySos.scenario;
    first = false;
    return prevO;
  }

  // ---------------- главная ----------------
  function stageLabel(o){
    if(!o) return '';
    if(o.status==='published') return o.offers.length ? `Предложений от СТО: ${o.offers.length}` : 'Ждём предложений от СТО';
    if(o.status==='confirmed'){
      if(o.delivery==='self') return `Привезите машину · ${o.slot}`;
      const k = K(o.pickup&&o.pickup.conciergeId);
      return k ? `${k.name}: ${V.consts.PICKUP_STEPS[o.pickup.step].toLowerCase()}` : 'Ищем автоконсьержа';
    }
    if(o.status==='at_sto') return o.stage===2 && o.estimate.status==='sent' ? 'Смета ждёт вашего согласования' : ['Машина в сервисе','Диагностика','Мастер готовит смету','Ремонт в процессе','Готово'][o.stage];
    if(o.status==='ready') return o.delivery==='self' ? 'Машина готова — заберите' : (o.ret&&o.ret.conciergeId ? `Возврат: ${V.consts.RETURN_STEPS[o.ret.step].toLowerCase()}` : 'Готово · ищем консьержа на возврат');
    if(o.status==='returned') return o.frozen ? 'Спор у диспетчера · оплата заморожена' : 'Машина у вас · оплатите заказ';
    if(o.status==='closed') return 'Оплачено · оцените сервис';
    return '';
  }
  function progressPct(o){
    if(!o) return 0;
    return {published:5, confirmed:15, at_sto: 30 + o.stage*12, ready: 85, returned: 95, closed:100}[o.status] || 0;
  }
  function renderHome(){
    const d = new Date();
    const g = document.querySelector('#screen-home .greet'); if(g) g.textContent = `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()].toUpperCase()}`;
    const n = document.querySelector('#screen-home .greet-name'); if(n) n.textContent = `Здравствуйте, ${V.client.name.split(' ')[0]}`;
    const car = cars[0];
    const cc = document.querySelector('#screen-home .car-card');
    if(cc && car){ cc.querySelector('.make').textContent = car.make; cc.querySelector('.plate').textContent = car.plate; const mv = cc.querySelector('.meta .v'); if(mv) mv.textContent = car.mileage; }
    const ar = document.querySelector('#screen-home .active-repair');
    if(ar){
      ar.style.display = O ? 'flex' : 'none';
      if(O){
        ar.setAttribute('onclick', O.status==='published' ? 'previewOffers()' : "go('status')");
        ar.querySelector('.ring').textContent = progressPct(O) + '%';
        ar.querySelector('.t1').textContent = stageLabel(O);
        ar.querySelector('.t2').textContent = `${O.symptom.length>48?O.symptom.slice(0,46)+'…':O.symptom} · заявка №${O.id}`;
      }
    }
    const cta = document.querySelector('#screen-home .cta-card'); if(cta) cta.style.display = O && O.status!=='closed' ? 'none' : '';
  }

  // ---------------- заявка ----------------
  window.publishRequest = async function(){
    if(O && O.status!=='closed'){ showToast(`У вас уже есть активная заявка №${O.id}`); return previewOffers(); }
    const ta = document.querySelector('#screen-diagnose textarea.field');
    const tags = [...document.querySelectorAll('#symptomChips .chip.selected')].map(c=>c.textContent.trim());
    const text = ta.value.trim();
    try{
      await MA.act('order.create', { text, tags, carId: cars[0] && cars[0].id });
      ta.value=''; document.querySelectorAll('#symptomChips .chip.selected').forEach(c=>c.classList.remove('selected'));
      go('offers');
      showToast('Заявка опубликована — станции рядом уже видят её');
    }catch(e){ showToast(e.message); }
  };
  window.previewOffers = function(){
    if(!O){ showToast('Сначала расскажите, что случилось с машиной'); return go('diagnose'); }
    if(O.status!=='published') return go('status');
    go('offers');
  };
  function renderOffersScreen(){
    if(!O) return;
    const card = document.querySelector('#screen-offers .info-card .val');
    if(card) card.textContent = `${O.car} · ${O.symptom}`;
    document.getElementById('offersStatusText').textContent = O.status!=='published' ? 'Вы выбрали станцию' :
      offers.length ? `Получено предложений: ${offers.length} · новые приходят в реальном времени` : 'Заявка опубликована · ждём предложений от СТО';
    renderOffers();
    let x = document.getElementById('cancelReqBtn');
    if(!x){ document.getElementById('offersMapWrap').insertAdjacentHTML('afterend', '<button class="btn btn-outline" id="cancelReqBtn" style="margin-top:12px;" onclick="cancelOrder()">Отменить заявку</button>'); x = document.getElementById('cancelReqBtn'); }
    x.style.display = O.status==='published' ? '' : 'none';
  }
  const _renderOffers = renderOffers;
  window.renderOffers = function(){
    if(!offers.length){
      document.getElementById('offersList').innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--ink-faint); font-size:12px; padding:22px 10px;">Станции изучают заявку. Обычно первое предложение приходит за 2–5 минут — мы пришлём push.</td></tr>`;
      document.getElementById('offersCount').textContent = '';
      return;
    }
    _renderOffers();
  };
  window.cancelOrder = async function(){
    if(!O) return;
    if(!confirm('Отменить заявку №'+O.id+'?')) return;
    try{ await MA.act('order.cancel', {orderId:O.id}); showToast('Заявка отменена'); go('home'); }catch(e){ showToast(e.message); }
  };

  window.confirmOrder = async function(){
    if(!O || !chosenOffer){ showToast('Выберите предложение СТО'); return go('offers'); }
    const self = deliveryMode==='self';
    const di = self ? selfDateIdx : pickupDateIdx, tm = self ? selfTime : pickupTime;
    const d = scheduleDates[di];
    const day = d.idx===0 ? 'Сегодня' : d.idx===1 ? 'Завтра' : `${d.dow} ${d.dnum}`;
    const addr = document.getElementById('pickupAddress').value.trim() || V.client.address;
    const pt = fieldCoords.pickupAddress || PLACES.pickup;
    const btn = document.getElementById('confirmBtn'); btn.disabled = true;
    try{
      await MA.act('order.confirm', { orderId:O.id, offerId:chosenOffer.id, delivery: self?'self':'concierge', slot:`${day}, ${tm}`,
        address:addr, lng:pt.lng, lat:pt.lat, comment:(document.getElementById('orderComment').value||'').trim() });
      showToast(self ? 'Заявка подтверждена — ждём вас на СТО' : 'Заявка подтверждена — ищем автоконсьержа');
      trackKey = ''; currentStage = 0;
      go('status');
    }catch(e){ showToast(e.message); }
    btn.disabled = false;
  };

  // ---------------- статус ремонта ----------------
  window.setStage = function(i){
    if(i > realStage()){ showToast('Этот этап ещё впереди'); return; }
    currentStage = i; renderTrack(); _renderStageContent(i);
  };
  window.renderTrack = function(){
    const track = document.getElementById('stageTrack');
    track.style.display = O ? '' : 'none';
    const rs = realStage(), done = O && ['returned','closed'].includes(O.status);
    track.innerHTML = stages.map((s,i)=>{
      let cls = ''; if(i < rs || (done && i===4)) cls='done'; else if(i===rs) cls='current';
      if(i===currentStage && i!==rs) cls += ' viewing';
      return `<div class="stage-dot-wrap ${cls}" onclick="setStage(${i})"><div class="stage-dot"></div><span class="lbl">${s.label}</span></div>`;
    }).join('');
  };
  const card = (h, body)=>`<div class="content-card"><h4>${h}</h4>${body}</div>`;
  const costRows = (items, total)=> items.map(e=>`<div class="cost-row"><span class="item">${esc(e.name)}</span><span class="price">${e.price} Br</span></div>`).join('') + `<div class="cost-total"><span>Итого</span><span>${total} Br</span></div>`;
  function stepsList(steps, cur){
    return `<div class="trk-steps">${steps.map((s,i)=>`<div class="${i<cur?'done':i===cur?'cur':''}"><i></i>${s}</div>`).join('')}</div>`;
  }
  function actButton(n){
    const a = acts[n-1]; if(!a) return '';
    const lbl = a.status==='pending' && a.mine ? `Проверить акт №${n}` : `Акт №${n}`;
    const tag = a.status==='pending' ? (a.mine ? '<span class="st-tag pending">проверить</span>' : '<span class="st-tag pending">у СТО</span>') : a.status==='accepted' ? '<span class="st-tag accepted">ок</span>' : '<span class="st-tag disputed">спор</span>';
    return `<div class="act-list-item" onclick="openInspect(${n-1},'status')"><div class="n">${n}</div><div class="body"><div class="t1">${lbl} · ${esc(a.title.toLowerCase())}</div><div class="t2">${a.when} · ${Number(a.mileage).toLocaleString('ru')} км</div></div>${tag}</div>`;
  }
  function _renderStageContent(i){
    const el = document.getElementById('statusContent');
    if(!O){ el.innerHTML = card('Нет активного ремонта', '<p>Опишите, что беспокоит, — станции рядом пришлют предложения, а автоконсьерж заберёт машину.</p><button class="btn btn-primary" style="margin-top:12px;" onclick="go(\'diagnose\')">Рассказать, что случилось</button>'); return; }
    const s = stoOf(O) || {name:'—', address:''};
    const k = legConcierge();
    let html = '';
    const actsBlock = [1,2,3,4].some(n=>acts[n-1]) ? `<div class="content-card" style="padding:4px 14px;">${[1,2,3,4].map(actButton).join('')}</div>` : '';
    if(i===0){
      if(O.delivery==='self'){
        html = card('Отвезите машину в сервис', `<p>${esc(s.name)} · ${esc(s.address)} · ${esc(O.slot)}. Мастер примет машину и составит акт приёмки.</p>`);
      } else if(!O.pickup || !O.pickup.conciergeId){
        html = card('Ищем автоконсьержа', `<p>Заказ виден консьержам рядом. Как только кто-то возьмёт его, вы получите push с карточкой водителя. Слот: <b>${esc(O.slot)}</b>.</p>`);
      } else {
        const kk = K(O.pickup.conciergeId);
        html = card(`${esc(kk.name)} · автоконсьерж`, `<p>${esc(kk.car)} · ${kk.rating} ★ · ${kk.trips} поездок</p>${stepsList(V.consts.PICKUP_STEPS, O.pickup.step)}`);
      }
      if(O.status==='at_sto') html = card('Машина в сервисе', `<p>${O.acts[2]&&O.acts[2].status==='accepted'?'Мастер принял машину по акту №2 и скоро начнёт диагностику.':'Мастер сверяет машину с актом консьержа.'}</p>`) ;
      html += actsBlock;
      if(O.status==='confirmed' && (!O.pickup || O.pickup.step===0)) html += `<button class="btn btn-outline" onclick="cancelOrder()">Отменить заказ</button>`;
    } else if(i===1){
      html = `<div class="content-card"><h4>Мастер осматривает автомобиль</h4>
        <div class="bubble"><div class="who">МАСТЕР · ${MA.hhmm(O.stageTs||Date.now())}</div>${esc(O.diagnosis || `Начал осмотр: ${O.symptom}`)}</div>
        <div class="photo-row"><div class="photo-ph">фото 1</div><div class="photo-ph">фото 2</div></div></div>
        <button class="btn btn-outline" onclick="go('chat')">Написать мастеру</button>`;
    } else if(i===2){
      const e = O.estimate;
      if(e.status==='sent' || (realStage()>2)){
        html = `<div class="content-card"><h4>${e.status==='sent'?'Смета на согласование':'Смета одобрена'}</h4>
          ${O.diagnosis?`<p style="margin-bottom:8px;">${esc(O.diagnosis)}</p>`:''}${costRows(e.items, e.total)}
          ${O.price && e.total>O.price ? `<p style="font-size:11.5px;color:var(--ink-faint);margin-top:6px;">В предложении было ${O.price} Br — разница объяснена мастером в чате.</p>`:''}</div>
          ${e.status==='sent' ? `<button class="btn btn-primary" style="margin-bottom:10px;" onclick="approveEstimate()">Одобрить смету · ${e.total} Br</button>
            <div class="btn-row"><button class="btn btn-outline" onclick="go('chat')">Задать вопрос</button><button class="btn btn-danger-outline" onclick="declineEstimate()">Не согласна</button></div>`:''}`;
      } else {
        html = card('Мастер готовит смету', `<p>${e.status==='declined'?'Вы отклонили смету — мастер пришлёт новую. ':''}Смета придёт push-уведомлением — без вашего согласия работы не начнутся.</p>${O.diagnosis?`<div class="bubble" style="margin-top:10px;"><div class="who">ДИАГНОСТИКА</div>${esc(O.diagnosis)}</div>`:''}`);
      }
    } else if(i===3){
      html = `<div class="content-card"><h4>Ремонт идёт</h4><p>${esc(O.estimate.items.map(x=>x.name).join(', '))}.</p><div class="progress-bar"><i style="width:${realStage()>3?100:55}%"></i></div></div>
        <button class="btn btn-outline" onclick="go('chat')">Написать мастеру</button>`;
    } else if(i===4){
      const total = O.estimate.total || O.price;
      if(O.status==='closed'){
        if(!O.rating){ if(!document.getElementById('starRow')) renderRatingForm(); return; }
        html = card('Спасибо за отзыв!', `<div class="star-row">${'★'.repeat(O.rating)}${'☆'.repeat(5-O.rating)}</div><p style="margin-top:8px;">Оплачено ${O.paidAmount} Br.</p>`) + `<button class="btn btn-primary" onclick="go('diagnose')">Новая заявка</button>`;
      } else {
        let what;
        if(O.delivery==='self') what = O.status==='ready' ? 'Можно забирать в сервисе — маршрут на карте выше.' : 'Машина у вас.';
        else if(O.status==='returned') what = 'Машина у вас. Проверьте акт возврата №4 и сравните его с актом при заборе.';
        else if(!O.ret || !O.ret.conciergeId) what = 'Ищем консьержа, который вернёт машину вам. Push придёт, как только он возьмёт заказ.';
        else what = `${esc(K(O.ret.conciergeId).name)}: ${V.consts.RETURN_STEPS[O.ret.step].toLowerCase()} — следите на карте выше.`;
        html = card('Машина готова', `<p>${what}</p>${O.delivery==='concierge'&&O.ret&&O.ret.conciergeId?stepsList(V.consts.RETURN_STEPS, O.ret.step):''}`)
          + card('К оплате', `<div class="cost-total" style="border-top:none; padding-top:0;"><span id="finalPayAmount">${total} Br</span></div>${O.refund?`<p style="font-size:11.5px;">С учётом возврата ${O.refund} Br по спору</p>`:''}${O.frozen?`<p style="color:var(--alert); font-size:12px; margin-top:6px;">Открыт спор ${esc(O.disputeId||'')} — оплата заморожена до решения диспетчера.</p>`:''}`)
          + (O.delivery==='concierge' && acts[0] && acts[3] ? card('Приёмка машины', `<p>Сравните акт возврата с актом при заборе — фото, пробег и топливо рядом.</p><button class="btn btn-outline" style="margin-top:12px;" onclick="go('compare')">Сравнить было / стало</button>`) : '')
          + actsBlock
          + `<button class="btn btn-teal" ${O.status==='returned'&&!O.frozen?'':'disabled'} onclick="payAndRate()">${O.status==='returned'?'Оплатить '+total+' Br':'Оплата — после возврата машины'}</button>`;
      }
    }
    el.innerHTML = html;
  }
  window.renderStage = function(i){
    if(O){ const h = document.querySelector('#screen-status .greet'); if(h) h.textContent = `ЗАЯВКА №${O.id} · ${(stoOf(O)||{name:''}).name.toUpperCase()}`; }
    renderTrack(); _renderStageContent(i); renderTracking();
  };
  window.approveEstimate = async function(){ try{ await MA.act('estimate.approve', {orderId:O.id}); showToast('Смета одобрена, мастер приступает к ремонту'); }catch(e){ showToast(e.message); } };
  window.declineEstimate = async function(){
    const r = prompt('Что не устраивает в смете? Мастер увидит это в чате.', 'Дороговато — есть вариант дешевле?'); if(r===null) return;
    try{ await MA.act('estimate.decline', {orderId:O.id, reason:r}); showToast('Мастер получил ваш ответ'); }catch(e){ showToast(e.message); }
  };
  window.payAndRate = async function(){
    try{ const r = await MA.act('order.pay', {orderId:O.id}); showToast(`Оплата прошла — ${r.amount} Br списано`); }catch(e){ showToast(e.message); }
  };
  const _renderRatingForm = renderRatingForm;
  window.renderRatingForm = function(){ _renderRatingForm(); const h=document.querySelector('#statusContent h4'); if(h && O) h.textContent = 'Оцените ' + (stoOf(O)||{name:'сервис'}).name; };
  window.submitRating = async function(){
    if(selectedRating===0){ showToast('Поставьте оценку от 1 до 5 звёзд'); return; }
    const comment = (document.getElementById('ratingComment')||{}).value||'';
    try{ await MA.act('order.rate', {orderId:O.id, stars:selectedRating, comment}); showToast('Оценка отправлена мастеру'); }catch(e){ showToast(e.message); }
  };

  // ---------------- карта: где консьерж / где машина ----------------
  const TRK = { key:'', coords:null, cum:null, total:0, car:null, route:null, leg:null };
  function phase(){
    if(!O || !O.stoId) return null;
    const s = stoOf(O), home = { lng:O.lng||PLACES.pickup.lng, lat:O.lat||PLACES.pickup.lat, label:O.address };
    if(O.delivery==='self'){
      if(O.status==='confirmed') return { kind:'self', title:'Отвезите машину в сервис', s, home };
      if(['ready','returned'].includes(O.status)) return { kind:'self', title: O.status==='ready'?'Машина готова — заберите в сервисе':'Машина у вас', s, home };
      return { kind:'at', where:'sto', title:'Машина в сервисе', sub:`${s.name} · ${s.address}`, note:'Машина стоит в боксе станции.', s, home };
    }
    const P = O.pickup, R = O.ret;
    if(O.status==='confirmed'){
      if(!P || !P.conciergeId) return { kind:'at', where:'home', title:'Ищем автоконсьержа', sub:`Заберёт машину · ${home.label}`, note:`Слот ${O.slot}. Карточка водителя придёт push-уведомлением.`, s, home };
      const k = K(P.conciergeId);
      if(P.step===0) return { kind:'at', where:'kstart', title:`${k.name} скоро выедет к вам`, sub:`${k.car} · ${k.rating} ★`, note:'Геопозиция появится, когда консьерж выедет.', s, home, k };
      if(P.step===1) return { kind:'leg', leg:'pickup', step:1, from:{lng:k.lng,lat:k.lat}, to:home, dest:'home', title:`${k.name} едет к вам`, sub:`Заберёт машину · ${home.label}`, etaLbl:'будет у вас', s, home, k };
      if(P.step<=3) return { kind:'at', where:'home', car:true, title:`${k.name} на месте`, sub:P.step===3?'Снимает акт осмотра №1 — проверьте его в приложении':'Передайте ключи и документы', note:'', s, home, k };
      if(P.step===4) return { kind:'leg', leg:'pickup', step:4, from:home, to:s, dest:'sto', title:`${k.name} везёт машину в сервис`, sub:`${s.name} · ${s.address}`, etaLbl:'прибытие в сервис', s, home, k };
      return { kind:'at', where:'sto', car:true, title:'Машина в сервисе', sub:`${s.name} · ${s.address}`, note:`${k.name} передаёт машину мастеру по акту №2.`, s, home, k };
    }
    if(O.status==='at_sto') return { kind:'at', where:'sto', title:'Машина в сервисе', sub:`${s.name} · ${s.address}`, note:'Машина стоит в боксе станции. Когда ремонт закончится, консьерж привезёт её вам — следить можно будет здесь.', s, home };
    if(O.status==='ready'){
      if(!R || !R.conciergeId) return { kind:'at', where:'sto', title:'Машина готова', sub:`${s.name} · ${s.address}`, note:'Ищем консьержа, который вернёт машину.', s, home };
      const k = K(R.conciergeId);
      if(R.step<=2) return { kind:'at', where:'sto', title: R.step===2 ? `${k.name} забирает машину` : `${k.name} едет в сервис за машиной`, sub:`${s.name} · ${s.address}`, note: R.step===2 ? 'Мастер подписывает акт выдачи №3.' : `${k.car} · ${k.rating} ★`, s, home, k };
      if(R.step===3) return { kind:'leg', leg:'ret', step:3, from:s, to:home, dest:'home', title:`${k.name} везёт машину к вам`, sub:`Вернёт по адресу ${home.label}`, etaLbl:'будет у вас', s, home, k };
      return { kind:'at', where:'home', car:true, title:`${k.name} у вас`, sub:'Заполняет акт возврата №4', note:'', s, home, k };
    }
    return { kind:'at', where:'home', title:'Машина у вас', sub:home.label, note:'Трансляция геопозиции консьержа завершена. Сравните акт возврата с актом при заборе ниже.', s, home };
  }
  function driverRow(k){
    if(!k) return '';
    const ini = k.name.slice(0,2).toUpperCase();
    return DRIVER_ROW.replace('>ИГ<', `>${ini}<`).replace('Игорь · автоконсьерж', `${esc(k.name)} · автоконсьерж`).replace('Chevrolet Cobalt · 4.9 ★', `${esc(k.car)} · ${k.rating} ★`).replace('Звоним Игорю', 'Звоним консьержу');
  }
  function pointAtDist(d){
    const c = TRK.coords, cum = TRK.cum;
    let k = 1; while(k < cum.length-1 && cum[k] < d) k++;
    const seg = (cum[k]-cum[k-1]) || 1, t = Math.min(1, Math.max(0, (d-cum[k-1])/seg));
    return [c[k-1][0] + (c[k][0]-c[k-1][0])*t, c[k-1][1] + (c[k][1]-c[k-1][1])*t];
  }
  function legProgress(){ const L = O && O[TRK.leg]; return L ? (L.progress||0) : 0; }
  function updateCar(){
    if(!TRK.coords) return;
    const p = legProgress(), pos = p*TRK.total, pt = pointAtDist(pos);
    if(TRK.car) TRK.car.setLngLat(pt);
    const m = maps.statusMap;
    if(m){ let k=1; while(k < TRK.cum.length-1 && TRK.cum[k] < pos) k++; drawRoute(m, [pt].concat(TRK.coords.slice(k))); }
    const left = TRK.route.time*(1-p);
    const eta = document.getElementById('trkEta');
    if(eta){ eta.textContent = p>=1 ? 'на месте' : fmtMin(left); document.getElementById('trkClock').textContent = clockIn(left); document.getElementById('trkKm').textContent = fmtKm(TRK.total*(1-p)); }
    const fr = document.getElementById('trkFresh'); if(fr) fr.textContent = 'Геопозиция обновлена только что';
  }
  async function renderTracking(){
    const info = document.getElementById('trackInfo'); if(!info) return;
    const ph = phase();
    const card = document.getElementById('trackCard');
    if(!ph){ card.style.display='none'; TRK.key=''; return; }
    card.style.display='';
    const key = JSON.stringify([ph.kind, ph.where||ph.leg, ph.step, ph.title, ph.sub, ph.k&&ph.k.id, ph.s.id]);
    if(key === TRK.key){ if(ph.kind==='leg') updateCar(); if(maps.statusMap) maps.statusMap.resize(); return; }
    TRK.key = key; TRK.coords = null; TRK.car = null;
    stopSim();
    const m = makeMap('statusMap', { center:[ph.s.lng, ph.s.lat], zoom:13 });
    if(ph.kind==='self'){
      info.innerHTML = `<div class="trk-head"><span class="trk-dot"></span>${ph.title}</div><div class="trk-sub">${esc(ph.s.name)} · ${esc(ph.s.address)}</div><div class="route-meta" id="statusRouteMeta" style="margin-top:8px;"></div><button class="btn btn-outline btn-sm" onclick="openNavSheet()">Построить маршрут</button>`;
      renderSelfMap('statusMap','statusRouteMeta'); return;
    }
    if(ph.kind==='at'){
      info.innerHTML = `<div class="trk-head"><span class="trk-dot ${ph.car?'live':''}"></span>${esc(ph.title)}</div><div class="trk-sub">${esc(ph.sub||'')}</div>${ph.k&&ph.where!=='sto'?driverRow(ph.k):''}${ph.note?`<div class="trk-note">${esc(ph.note)}</div>`:''}`;
      if(m){
        clearRoute(m);
        const pts = [];
        if(ph.where==='sto') pts.push({ kind:'sto', text: ph.car ? 'Машина здесь' : 'Машина здесь', lng:ph.s.lng, lat:ph.s.lat });
        else if(ph.where==='kstart'){ pts.push({ kind:'home', lng:ph.home.lng, lat:ph.home.lat }); pts.push({ kind:'car', lng:ph.k.lng, lat:ph.k.lat }); }
        else { pts.push({ kind:'home', lng:ph.home.lng, lat:ph.home.lat }); if(ph.car) pts.push({ kind:'car', lng:ph.home.lng+0.0004, lat:ph.home.lat+0.0002 }); }
        setMarkers('statusMap', pts); m.resize(); fitTo(m, pts.map(p=>[p.lng,p.lat]), 15);
      }
      return;
    }
    // поездка: маршрут строится один раз, позиция машинки приходит из приложения консьержа
    info.innerHTML = `<div class="trk-head"><span class="trk-dot live"></span>${esc(ph.title)}</div><div class="trk-sub">Строим маршрут…</div>`;
    const myKey = key;
    const r = await getRoute(ph.from, ph.to);
    if(TRK.key !== myKey) return;
    const coords = r.coords, cum = [0];
    for(let k=1;k<coords.length;k++) cum.push(cum[k-1] + haversine({lng:coords[k-1][0],lat:coords[k-1][1]},{lng:coords[k][0],lat:coords[k][1]}));
    Object.assign(TRK, { coords, cum, total: cum[cum.length-1]||1, route:r, leg:ph.leg });
    info.innerHTML = `<div class="trk-head"><span class="trk-dot live"></span>${esc(ph.title)}</div><div class="trk-sub">${esc(ph.sub)}</div>
      <div class="trk-eta"><div class="num" id="trkEta">${fmtMin(r.time)}</div><div class="lbl">${ph.etaLbl} ≈ <b id="trkClock">${clockIn(r.time)}</b><br><span id="trkKm">${fmtKm(TRK.total)}</span> по маршруту</div></div>
      ${driverRow(ph.k)}
      <div class="trk-note"><span id="trkFresh">Геопозиция обновлена только что</span> · видна только вам и только во время поездки${r.approx?' · маршрут приблизительный':''}<br>Позиция приходит из приложения консьержа в реальном времени.</div>`;
    if(m){
      const dest = ph.dest==='sto' ? { kind:'sto', text:'Сервис', lng:ph.s.lng, lat:ph.s.lat } : { kind:'home', lng:ph.home.lng, lat:ph.home.lat };
      const mk = setMarkers('statusMap', [dest, { kind:'car', lng:coords[0][0], lat:coords[0][1] }]);
      TRK.car = mk[1]; m.resize(); drawRoute(m, coords, '#E8A33D'); fitTo(m, coords, 15);
    }
    updateCar();
  }
  window.renderStatusMap = function(){ renderTracking(); };

  // ---------------- акты ----------------
  const _renderInspect = renderInspect;
  window.renderInspect = function(i){
    if(!acts[i]){ document.getElementById('inspectContent').innerHTML = '<div class="content-card"><p>Акт ещё не составлен.</p></div>'; return; }
    _renderInspect(i);
    const el = document.getElementById('inspectContent');
    const g = el.querySelector('.greet'); if(g && O) g.textContent = `АКТ №${acts[i].n} · ЗАЯВКА №${O.id}`;
    const s = stoOf(O);
    el.innerHTML = el.innerHTML.replace('Автоконсьерж Игорь', acts[i].kName ? 'Автоконсьерж ' + esc(acts[i].kName) : (s?esc(s.name):'')).replace(/Автосервис на Независимости/g, s?esc(s.name):'СТО');
  };
  window.renderCarActs = function(){
    const el = document.getElementById('carActs'); if(!el) return;
    const list = [0,1,2,3].filter(i=>acts[i]);
    el.innerHTML = list.length ? list.map(i=>{ const a=acts[i]; return `<div class="act-list-item" onclick="openInspect(${i},'car')"><div class="n">${a.n}</div><div class="body"><div class="t1">${a.title}</div><div class="t2">${a.when} · ${Number(a.mileage).toLocaleString('ru')} км</div></div><span class="st-tag ${a.status}">${a.status==='pending'?(a.mine?'проверить':'у СТО'):a.status==='accepted'?'ок':'спор'}</span></div>`; }).join('')
      : '<div style="padding:12px 0; font-size:12.5px; color:var(--ink-faint);">Актов пока нет — они появятся, когда консьерж заберёт машину.</div>';
  };
  const _renderCompare = renderCompare;
  window.renderCompare = function(){
    if(!acts[0] || !acts[3]){ document.getElementById('compareContent').innerHTML = '<div class="content-card"><p>Сравнение появится, когда консьерж вернёт машину и составит акт №4.</p></div>'; return; }
    _renderCompare();
    const fresh = acts[3].damages.filter(d=>!acts[0].damages.some(x=>x.text===d.text));
    const el = document.getElementById('compareContent');
    el.innerHTML = el.innerHTML.replace('<b class="ok">нет</b>', fresh.length ? `<b class="warn">${fresh.length}: ${esc(fresh.map(d=>d.text).join('; '))}</b>` : '<b class="ok">нет</b>')
      .replace(/Было · \d\d:\d\d/, 'Было · ' + MA.hhmm(O.acts[1].ts)).replace(/Стало · \d\d:\d\d/, 'Стало · ' + MA.hhmm(O.acts[4].ts));
  };
  window.acceptAct = async function(i){
    try{ await MA.act('act.accept', {orderId:O.id, n:acts[i].n}); showToast(acts[i].n===4 ? 'Машина принята — можно оплатить заказ' : 'Акт подтверждён'); }catch(e){ showToast(e.message); }
  };
  window.submitClaim = async function(i){
    const item = document.getElementById('claimItem').value, text = document.getElementById('claimText').value.trim();
    try{ await MA.act('dispute.open', {orderId:O.id, n:acts[i].n, item, text: text || item}); showToast('Спор открыт — диспетчер напишет в чат в течение 15 минут'); }catch(e){ showToast(e.message); }
  };

  // ---------------- чат ----------------
  window.sendChatMessage = async function(){
    const input = document.getElementById('chatInput'); const text = input.value.trim(); if(!text) return;
    if(currentConv !== CONVS[0]){ currentConv.msgs.push({from:'out', text, time:nowTime()}); input.value=''; renderChatMessages(); return; }
    if(!O || !O.stoId){ showToast('Чат с мастером откроется, когда вы выберете станцию'); return; }
    input.value = '';
    try{ await MA.act('chat.send', {orderId:O.id, text}); }catch(e){ input.value = text; showToast(e.message); }
  };
  window.openChat = function(){
    const s = currentConv===CONVS[0] ? stoOf(O) : null;
    document.getElementById('chatName').textContent = s ? s.name : currentConv.name;
    document.getElementById('chatAvatar').textContent = s ? s.initials : currentConv.ini;
    renderChatMessages();
  };

  // ---------------- SOS и эвакуатор ----------------
  window.callSOS = async function(){
    try{ await MA.act('sos.create', {scenario: sosScenario || 'Не указана', place: V.client.address}); showToast('SOS отправлен — диспетчер на связи'); }catch(e){ showToast(e.message); }
  };
  window.cancelSOS = async function(){
    const s = (V.sos||[]).find(x=>x.step<4 && x.kind!=='tow'); if(!s) return;
    try{ await MA.act('sos.cancel', {id:s.id}); showToast('Вызов отменён'); }catch(e){ showToast(e.message); }
  };
  const _renderService = renderService;
  window.renderService = function(key){
    _renderService(key);
    const el = document.getElementById('serviceContent');
    if(key==='sos' && sosState==='calling'){
      const s = (V&&V.sos||[]).find(x=>x.step<4 && x.kind!=='tow');
      if(s){
        const T = ['Вызов отправлен · ждём диспетчера','Вызов принят диспетчером','Помощь выехала','Помощь на месте'][s.step];
        const sub = s.step===0 ? 'Диспетчер видит вашу геопозицию и данные машины. Цель — принять вызов за 2 минуты' : (s.log[s.log.length-1]||{}).x || '';
        const b = el.querySelector('.act-banner'); if(b) b.innerHTML = `${ICONS.sos}<div><div class="t1">${T} · ${fmtElapsed(s.ts)}</div><div class="t2">${esc(sub)}</div></div>`;
        el.innerHTML = el.innerHTML.replace('Партнёр выезжает · ~25 мин', s.step>=2 ? 'Партнёр выезжает · ~25 мин' : 'Диспетчер подбирает партнёра')
          .replace('ул. Немига, 14 · точность 15 м', esc(s.place));
      }
      const btn = [...el.querySelectorAll('button')].find(b=>b.textContent.includes('Отменить вызов'));
      if(btn) btn.setAttribute('onclick', 'cancelSOS()');
    }
    if(key==='tow'){
      const tows = (V&&V.sos||[]).filter(x=>x.kind==='tow' && x.step<4);
      if(tows.length) el.insertAdjacentHTML('afterbegin', `<div class="act-banner ok">${ICONS.tow}<div><div class="t1">${['Заявка у диспетчера','Диспетчер принял заявку','Эвакуатор выехал','Эвакуатор на месте'][tows[0].step]}</div><div class="t2">${esc(tows[0].place)}</div></div></div>`);
    }
    el.innerHTML = el.innerHTML.replace(/KIA RIO, 2019/g, cars[0] ? esc(cars[0].make.toUpperCase()) : '');
  };
  function fmtElapsed(ts){ const s=Math.max(0,Math.round((Date.now()-ts)/1000)); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
  window.orderTow = async function(){
    const free = userPlan==='max' && towFreeLeft>0;
    const from = (document.getElementById('towFrom')||{}).value || V.client.address;
    const to = (document.getElementById('towTo')||{}).value || '';
    try{
      await MA.act('sos.create', {kind:'tow', scenario:'Эвакуатор', place:from, to});
      if(free){ towFreeLeft--; towUsedBy = `${V.client.name.split(' ')[0]} (вы), ${new Date().toLocaleDateString('ru',{day:'numeric',month:'long'})}`; }
      showToast(free ? 'Эвакуатор вызван — бесплатный выезд использован' : 'Эвакуатор вызван — диспетчер подтвердит подачу');
    }catch(e){ showToast(e.message); }
  };

  // ---------------- уведомления ----------------
  window.openNotif = function(id){
    const n = notifications.find(x=>x.id===id); if(!n) return;
    n.unread = false; updateBell(); MA.act('notif.read', {id}).catch(()=>{});
    n.target();
  };
  window.markAllRead = function(){
    notifications.forEach(n=>n.unread=false); updateBell(); renderNotifs();
    MA.act('notif.read', {all:true}).catch(()=>{});
    showToast('Все уведомления прочитаны');
  };

  // ---------------- гараж и профиль ----------------
  window.submitCarForm = async function(){
    const g = (id)=>document.getElementById(id).value.trim();
    const make = g('fMake'), year = g('fYear'), plate = g('fPlate'), vin = g('fVin'), mileage = g('fMileage');
    try{
      await MA.act('car.add', { make: year ? `${make}, ${year}` : make, plate, vin, mileage: mileage ? `${mileage} км` : '' });
      ['fMake','fYear','fPlate','fVin','fMileage'].forEach(id=>document.getElementById(id).value='');
      showToast('Машина добавлена в гараж'); go('garage');
    }catch(e){ showToast(e.message); }
  };
  window.saveProfile = async function(){
    const first = document.getElementById('profFirstName').value.trim(), last = document.getElementById('profLastName').value.trim();
    if(!first || !last){ showToast('Укажите имя и фамилию'); return; }
    try{ await MA.act('client.update', {name:`${first} ${last}`}); showToast('Профиль сохранён'); }catch(e){ showToast(e.message); }
  };
  const _setPlan = setPlan;
  window.setPlan = function(k){ _setPlan(k); MA.act('client.update', {plan:k}).catch(()=>{}); };

  // ---------------- перерисовка по событиям сервера ----------------
  function typing(){ const a=document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && !['chatInput','homeChatInput'].includes(a.id); }
  function refresh(prevO, chatChanged){
    updateBell();
    renderHomeChat(); renderHome();
    const scr = currentScreen;
    if(typing() && ['status','inspect','compare','confirm','diagnose','addcar','profile','addcard','service'].includes(scr)) return;
    if(scr==='offers'){ if(O && O.status!=='published' && prevO && prevO.status==='published'){} renderOffersScreen(); }
    if(scr==='status'){
      const rs = realStage();
      if(!prevO || !O || prevO.id!==O.id || currentStage===realStageOf(prevO)) currentStage = rs;
      const sig = statusSig();
      if(sig !== lastSig){ lastSig = sig; renderStage(currentStage); } else renderTracking();
    }
    if(scr==='chat' && chatChanged){ renderChatMessages(); }
    if(scr==='inspect'){ const box=document.getElementById('claimBox'); if(!(box && box.classList.contains('open'))){ const t=document.querySelector('#inspectContent .greet'); const n=t?+(/№(\d)/.exec(t.textContent)||[])[1]:0; if(n && acts[n-1]) renderInspect(n-1); } }
    if(scr==='compare') renderCompare();
    if(scr==='notifs') renderNotifs();
    if(scr==='garage') renderGarage();
    if(scr==='car') renderCarActs();
    if(scr==='service' && (currentService==='sos'||currentService==='tow')) renderService(currentService);
  }
  let lastSig = '';
  function statusSig(){
    if(!O) return 'none';
    return JSON.stringify([O.id, O.updatedAt, O.status, O.stage, currentStage, O.pickup&&[O.pickup.conciergeId,O.pickup.step], O.ret&&[O.ret.conciergeId,O.ret.step],
      Object.values(O.acts).map(a=>a.status), O.estimate.status, O.estimate.total, O.paid, O.rating, O.frozen]);
  }
  function realStageOf(o){ if(!o) return 0; if(o.status==='at_sto') return o.stage; if(['ready','returned','closed'].includes(o.status)) return 4; return 0; }

  // экран статуса и заявки всегда открываются с актуальными данными
  const _go = go;
  window.go = function(id){
    if(id==='status' && V){ currentStage = realStage(); }
    _go(id);
    if(!V) return;
    if(id==='offers') renderOffersScreen();
    if(id==='home') renderHome();
    if(id==='car') renderCarActs();
    if(id==='profile'){ const t=document.querySelector('#screen-profile h1.page-title'); if(t) t.textContent = V.client.name; const [f,l]=V.client.name.split(' '); const a=document.getElementById('profFirstName'), b=document.getElementById('profLastName'); if(a) a.value=f||''; if(b) b.value=l||''; }
    if(id==='confirm'){
      const r = document.querySelector('#screen-confirm .mini-driver-row');
      if(r) r.innerHTML = `<div class="avatar" style="width:30px; height:30px; font-size:11px;">АК</div><div><div class="mini-driver-name">Автоконсьерж</div><div class="mini-driver-sub">Назначим после подтверждения · push с карточкой водителя</div></div>`;
      const pa = document.getElementById('pickupAddress'); if(pa && !pa.dataset.touched){ pa.value = V.client.address; }
    }
  };
  document.addEventListener('input', (e)=>{ if(e.target.id==='pickupAddress') e.target.dataset.touched='1'; });

  window.MA_OPEN_LINK = (l)=>linkTarget(l)();   // нажатие на системное уведомление на телефоне

  // показать «пришло новое» на экране статуса: тост + вибрация на телефоне
  function onNotify(n){
    showToast(n.title);
    if(navigator.vibrate && n.sound) try{ navigator.vibrate(120); }catch(e){}
  }

  MA.connect({ role:'client', id:ME, badge:{pos:'top-center', compact:true},
    onState(v, prev, isFirst){
      const prevO = O;
      const chatBefore = MAIN.length;
      applyState(v);
      if(isFirst){ currentStage = realStage(); go(currentScreen || 'home'); }
      refresh(prevO, MAIN.length!==chatBefore || isFirst);
    },
    onNotify,
    onLoc(l){
      if(!O || l.orderId!==O.id) return;
      if(O[l.leg]){ O[l.leg].progress = l.progress; if(l.lng){ O[l.leg].lng=l.lng; O[l.leg].lat=l.lat; } }
      if(currentScreen==='status' && TRK.leg===l.leg) updateCar();
    }
  });
})();
