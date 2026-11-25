/* Панель СТО ↔ сервер экосистемы «Мой автомеханик».
   Лента «Новые заявки» — реальные заявки клиенток, СТО отправляет своё предложение (цену).
   Выбранные клиенткой заказы попадают в «Мои заявки»: приёмка по акту №2, диагностика, смета клиентке,
   ремонт, выдача консьержу по акту №3. Всё синхронно с клиенткой, консьержем и диспетчером. */
(function(){
  const ME = new URLSearchParams(location.search).get('as') || 'sto1';
  let V = null, pending = false, lastIds = null;
  const offerDraft = {};   // открытые формы предложений: {open, price, note}
  const hoDraft = {};      // черновики акта выдачи №3
  const liDraft = {};      // черновики сметы
  const esc = (s)=>MA.esc(s);
  const STATUS_TXT = (o)=>{
    if(o.status==='confirmed') return o.delivery==='self' ? 'Ждём машину · клиентка привезёт сама' : (o.pickup&&o.pickup.conciergeId ? `Консьерж ${kName(o.pickup.conciergeId)}: ${V.consts.PICKUP_STEPS[o.pickup.step].toLowerCase()}` : 'Ждём машину · ищем консьержа');
    if(o.status==='ready') return o.delivery==='self' ? 'Готово · клиентка заберёт сама' : (o.ret&&o.ret.conciergeId ? `Возврат: ${kName(o.ret.conciergeId)} · ${V.consts.RETURN_STEPS[o.ret.step].toLowerCase()}` : 'Готово · ждём консьержа на возврат');
    if(o.status==='returned') return o.frozen ? 'У клиентки · открыт спор, оплата заморожена' : 'У клиентки · ждём оплату';
    if(o.stage===0 && o.acts[2] && o.acts[2].status==='pending') return 'Проверьте акт приёмки №2';
    if(o.stage===2) return o.estimate.status==='sent' ? 'Смета у клиентки на согласовании' : o.estimate.status==='declined' ? 'Клиентка не согласовала смету' : 'Подготовьте смету';
    return stages[o.stage].label;
  };
  const kName = (id)=> id && V.concierges[id] ? V.concierges[id].name : '—';

  function toRequest(o, prev){
    const mine = o.stoId===ME && o.status!=='published';
    let status = o.status==='published' ? (o.myOffer ? 'offered' : 'new') : mine ? (['closed','cancelled'].includes(o.status) ? 'done' : 'taken') : 'gone';
    const a2 = o.acts[2], a3 = o.acts[3];
    const kid = (o.ret && o.ret.conciergeId) || (o.pickup && o.pickup.conciergeId);
    if(!hoDraft[o.id]) hoDraft[o.id] = { status:'none', photos:0, mileage:'', fuel:'1/2', kit:false, items:false };
    return {
      id:o.id, car:o.car, symptom:o.symptom, tags:o.tags, district:o.district||'', distance:o.distance, slot:o.slot,
      priceMin:o.priceMin, priceMax:o.priceMax, urgent:o.urgent, postedAgo:MA.ago(o.createdAt),
      client:o.client||'', phone:o.phone||'', address:o.address||'', concierge: o.delivery==='self' ? 'не нужен (клиентка сама)' : kName(kid),
      status, stage:o.stage, expanded: prev ? prev.expanded : false, fresh: lastIds && !lastIds.has(o.id),
      acts:{
        intake: a2 ? { status:a2.status==='accepted'?'accepted':a2.status, mileage:a2.mileage, fuel:a2.fuel, damages:a2.damages, items:a2.items, time:MA.hhmm(a2.ts) } : null,
        handover: a3 ? { status:'done', photos:12, mileage:a3.mileage, fuel:a3.fuel, kit:true, items:true } : hoDraft[o.id]
      },
      o
    };
  }

  function applyState(v){
    V = v;
    const prev = {}; requests.forEach(r=>prev[r.id]=r);
    requests = V.orders.map(o=>toRequest(o, prev[o.id])).filter(r=>r.status!=='gone')
      .sort((a,b)=>(b.urgent-a.urgent)||(b.o.createdAt-a.o.createdAt));
    lastIds = new Set(V.orders.map(o=>o.id));
    history = V.orders.filter(o=>o.stoId===ME && o.status==='closed').sort((a,b)=>(b.paidTs||0)-(a.paidTs||0))
      .map(o=>({car:o.car, date:new Date(o.paidTs||o.updatedAt).toLocaleDateString('ru',{day:'numeric',month:'short'}), rating:o.rating||5, payout:Math.round((o.paidAmount||o.estimate.total||o.price||0)*(1-V.consts.COMMISSION)*100)/100}));
    stoNotifs = V.notifications.map(n=>({ id:n.id, ico: SICON[n.ico] ? n.ico : (n.cat==='req'?'req':'order'), title:n.title, text:n.text, time:MA.when(n.ts).replace('Сегодня, ',''), unread:!n.read, link:n.link }));
    const s = V.sto;
    document.querySelectorAll('.sto-mini .name, #view-profile .profile-card .n').forEach(e=>e.textContent=s.name);
    const r = document.querySelector('.sto-mini .rating'); if(r) r.textContent = `★ ${s.rating} · ${s.orders + history.length - 3} заказов`;
  }

  function busyTyping(){ const a=document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('.content'); }
  function rerender(){
    updateCounts(); updateStoBell();
    if(document.getElementById('notifPop').classList.contains('open')) renderNotifPop();
    if(busyTyping()){ pending = true; return; }
    pending = false;
    const vis = (id)=>document.getElementById('view-'+id).style.display!=='none';
    if(vis('marketplace')) renderMarket();
    if(vis('myjobs')) renderMyJobs();
    if(vis('history')) renderHistory();
    if(vis('jobdetail') && openJobId){ const r=curJob(); if(r && r.status!=='done') { fillJobHead(r); renderStageTrack(r); renderJobMain(r); } else showView('history'); }
  }
  document.addEventListener('focusout', ()=>setTimeout(()=>{ if(pending && !busyTyping()) rerender(); }, 60));

  async function act(type, p, ok){
    try{ const r = await MA.act(type, p); if(ok) showToast(typeof ok==='function'?ok(r):ok); return r||true; }
    catch(e){ showToast(e.message); return null; }
  }

  // ---------------- лента заявок: предложение цены ----------------
  window.filteredNew = function(){
    return requests.filter(r=>{
      if(r.status!=='new' && r.status!=='offered') return false;
      if(currentFilter==='near') return r.distance<=3;
      if(currentFilter==='today') return (r.slot||'').startsWith('Сегодня');
      if(currentFilter==='urgent') return r.urgent;
      return true;
    });
  };
  const _renderMarket = renderMarket;
  window.renderMarket = function(){
    _renderMarket();
    filteredNew().forEach(r=>{
      const card = document.getElementById('card-'+r.id); if(!card) return;
      const bottom = card.querySelector('.req-bottom');
      const d = offerDraft[r.id] || {};
      const mid = Math.round((r.priceMin + r.priceMax) / 2 / 5) * 5;
      const others = r.o.offersCount - (r.o.myOffer?1:0);
      if(r.status==='offered'){
        bottom.innerHTML = `<div class="req-price"><span>Ваше предложение</span>${r.o.myOffer.price.toLocaleString('ru')} Br</div>
          <div style="display:flex;gap:8px;align-items:center;"><span class="offer-wait">ждём выбора клиентки${others>0?` · ещё ${others} ${others===1?'предложение':'предложения'}`:''}</span>
          <button class="btn btn-outline" onclick="event.stopPropagation(); openOffer('${r.id}')">Изменить</button></div>`;
      } else {
        bottom.querySelector('button').textContent = 'Предложить цену';
        bottom.querySelector('button').setAttribute('onclick', `event.stopPropagation(); openOffer('${r.id}')`);
        if(others>0) bottom.querySelector('.req-price').insertAdjacentHTML('beforeend', `<small class="offer-others">уже ${others} ${others===1?'предложение':'предложения'} от других СТО</small>`);
      }
      if(d.open){
        const items = (r.o.myOffer && r.o.myOffer.items) || null;
        card.insertAdjacentHTML('beforeend', `<div class="offer-form" onclick="event.stopPropagation()">
          <div class="of-row"><label>Цена для клиентки, Br<input type="number" inputmode="numeric" id="ofPrice-${r.id}" value="${d.price!=null?d.price:(r.o.myOffer?r.o.myOffer.price:mid)}"></label>
          <label>Когда примете<input type="text" id="ofNote-${r.id}" placeholder="Например: сегодня в 18:00" value="${esc(d.note!=null?d.note:(r.o.myOffer?r.o.myOffer.note:'Готовы принять сегодня'))}"></label></div>
          <p class="of-hint">Клиентка увидит цену, рейтинг и расстояние. Состав работ в смете подставится из типовых работ по симптому — точную смету пришлёте после диагностики.</p>
          <div style="display:flex;gap:8px;"><button class="btn btn-primary" onclick="sendOffer('${r.id}')">Отправить предложение</button>
          ${r.o.myOffer?`<button class="btn btn-outline" onclick="withdrawOffer('${r.id}')">Отозвать</button>`:''}
          <button class="btn btn-outline" onclick="closeOffer('${r.id}')">Отмена</button></div></div>`);
      }
    });
    if(!filteredNew().length) return;
  };
  window.openOffer = (id)=>{ offerDraft[id] = {open:true}; renderMarket(); const el=document.getElementById('ofPrice-'+id); if(el){ el.focus(); el.select(); } };
  window.closeOffer = (id)=>{ delete offerDraft[id]; document.activeElement && document.activeElement.blur(); renderMarket(); };
  window.sendOffer = async (id)=>{
    const price = +document.getElementById('ofPrice-'+id).value, note = document.getElementById('ofNote-'+id).value.trim();
    document.activeElement && document.activeElement.blur();
    const r = await act('offer.send', {orderId:id, price, note}, `Предложение ${price} Br отправлено клиентке`);
    if(r){ delete offerDraft[id]; renderMarket(); }
  };
  window.withdrawOffer = async (id)=>{ delete offerDraft[id]; await act('offer.withdraw', {orderId:id}, 'Предложение отозвано'); };
  document.addEventListener('input', (e)=>{
    const m = /^of(Price|Note)-(.+)$/.exec(e.target.id||''); if(!m) return;
    offerDraft[m[2]] = offerDraft[m[2]] || {open:true}; offerDraft[m[2]][m[1]==='Price'?'price':'note'] = e.target.value;
  });
  window.takeJob = (id)=>openOffer(id);

  // ---------------- мои заявки ----------------
  window.renderMyJobs = function(){
    const list = myActiveJobs();
    const el = document.getElementById('myjobsList');
    updateCounts();
    if(list.length===0){
      el.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 13l2-6h14l2 6"/><rect x="3" y="13" width="18" height="6" rx="2"/></svg>
        <p>Пока нет активных заказов — отправьте предложение во вкладке «Новые заявки». Когда клиентка выберет вас, заказ появится здесь.</p></div>`;
      return;
    }
    el.innerHTML = list.map(r=>{
      const pill = r.o.status==='confirmed' ? '<div class="status-pill s0">Ждём машину</div>' : r.o.status==='returned' ? '<div class="status-pill s4">У клиентки</div>' : `<div class="status-pill s${r.stage}">${stages[r.stage].label}</div>`;
      return `<div class="job-row" onclick="openJob('${r.id}')"><div class="car">${esc(r.car)}</div><div class="desc">${esc(STATUS_TXT(r.o))} · заявка №${r.id}</div>${pill}</div>`;
    }).join('');
  };
  function fillJobHead(r){
    document.getElementById('jdCarTitle').textContent = r.car;
    document.getElementById('jdOrderId').textContent = `Заявка №${r.id} · ${r.o.price||r.o.estimate.total} Br · ${STATUS_TXT(r.o)}`;
    document.getElementById('jdClientAv').textContent = r.client.split(' ').map(w=>w[0]).join('').toUpperCase();
    document.getElementById('jdClientName').textContent = r.client;
    document.getElementById('jdClientPhone').textContent = r.phone;
    document.getElementById('jdAddress').textContent = r.o.delivery==='self' ? 'Привезёт сама' : r.address;
    document.getElementById('jdSlot').textContent = r.slot;
    document.getElementById('jdConcierge').textContent = r.concierge;
  }
  window.openJob = function(id){
    openJobId = id;
    const r = requests.find(x=>x.id===id); if(!r) return;
    fillJobHead(r); renderStageTrack(r); renderJobMain(r);
    document.querySelectorAll('.view').forEach(v=>v.style.display='none');
    document.getElementById('view-jobdetail').style.display='block';
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.view==='myjobs'));
    window.scrollTo(0,0);
  };
  window.ensureActs = ()=>{};

  const _renderJobMain = renderJobMain;
  window.renderJobMain = function(r){
    const o = r.o, el = document.getElementById('jdMainCol');
    let html = '';
    if(o.status==='confirmed'){
      html = `<div class="panel"><h4>Машина ещё не на СТО</h4>
        <p style="font-size:13.5px; color:var(--ink-soft); line-height:1.6;">${esc(r.symptom)}</p>
        <div class="tag-row" style="margin-top:12px;">${r.tags.map(t=>`<span class="tag-mini">${esc(t)}</span>`).join('')}</div>
        <div class="waiting-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>${esc(STATUS_TXT(o))}${o.pickup&&o.pickup.conciergeId&&(o.pickup.step===1||o.pickup.step===4)?` · ${Math.round((o.pickup.progress||0)*100)}% пути`:''}</div>
        ${o.delivery==='self'?`<button class="btn btn-teal btn-block" style="margin-top:14px;" onclick="intakeSelf()">Клиентка привезла машину — принять</button>`:''}
        ${o.comment?`<div class="kv" style="margin-top:10px;"><span>Комментарий клиентки</span><b>${esc(o.comment)}</b></div>`:''}
      </div>`;
    } else if(o.status==='at_sto' && o.stage===0 && !r.acts.intake){
      html = `<div class="panel"><h4>Приёмка</h4><p class="of-hint">Акт приёмки ещё не пришёл.</p></div>`;
    } else if(o.status==='at_sto' && o.stage===2){
      if(!liDraft[o.id]) liDraft[o.id] = (o.estimate.items.length ? o.estimate.items : [{name:'Запчасти',price:0},{name:'Работа',price:0}]).map(x=>({name:x.name, price:x.price}));
      lineItems = liDraft[o.id];
      const st = o.estimate.status;
      html = `<div class="panel"><h4>Смета</h4>
        ${o.diagnosis?`<p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px;"><b>Диагностика:</b> ${esc(o.diagnosis)}</p>`:''}
        <div id="lineItemsBox"></div>
        ${st==='sent'?'':`<div class="add-line" onclick="addLineItem()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>Добавить позицию</div>`}
        <div class="cost-total"><span>Итого</span><span id="lineItemsTotal">0 Br</span></div>
        ${st==='sent' ? `<div class="waiting-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>Смета ${o.estimate.total} Br у клиентки. Когда она одобрит, заказ перейдёт в «Ремонт» автоматически.</div>`
          : `${st==='declined'?'<div class="waiting-note" style="background:var(--alert-soft);border-color:#EBC5BD;color:var(--alert);">Клиентка не согласовала смету — уточните в чате и отправьте новую.</div>':''}
             <button class="btn btn-primary btn-block" style="margin-top:16px;" onclick="sendEstimate()">Отправить клиенту</button>`}
        <p class="of-hint" style="margin-top:8px;">Предложение в ленте было ${o.price} Br. Если смета выше — объясните клиентке в чате.</p>
      </div>`;
      el.innerHTML = html + chatPanel(o);
      document.getElementById('jdActsSide').innerHTML = actsSidePanel(r);
      renderLineItems();
      if(st==='sent') document.querySelectorAll('#lineItemsBox input').forEach(i=>i.disabled=true);
      return;
    } else if(o.status==='at_sto' && o.stage===1){
      html = `<div class="panel"><h4>Диагностика</h4>
        <textarea class="note" id="diagText" placeholder="Опишите, что обнаружили при осмотре — клиентка увидит это в приложении">${esc(o.diagnosis || '')}</textarea>
        <button class="btn btn-primary btn-block" onclick="advanceStage()">Перейти к смете</button></div>`;
    } else if(['ready','returned'].includes(o.status)){
      const total = o.estimate.total || o.price;
      if(o.delivery==='self'){
        html = `<div class="panel"><h4>Готово к выдаче</h4><p style="font-size:13.5px; color:var(--ink-soft);">Клиентка заберёт машину сама.</p>
          <div class="cost-total"><span>К оплате</span><span>${total} Br</span></div>
          ${o.status==='ready'?`<button class="btn btn-teal btn-block" style="margin-top:16px;" onclick="selfHandover()">Клиентка забрала машину</button>`:`<div class="waiting-note">Ждём оплату в приложении клиентки</div>`}</div>`;
      } else {
        const L = o.ret;
        const arrived = L && L.conciergeId && L.step>=2;
        const note = o.status==='returned' ? (o.frozen?'Открыт спор — оплата заморожена до решения диспетчера.':'Машина у клиентки. Оплата спишется после того, как она примет машину.')
          : r.acts.handover.status==='done' ? `Автоконсьерж ${kName(L.conciergeId)} везёт машину клиентке.`
          : !L || !L.conciergeId ? 'Ремонт завершён. Ждём, пока консьерж возьмёт заказ на возврат — заполните акт выдачи, когда он приедет.'
          : arrived ? `Консьерж ${kName(L.conciergeId)} на месте. Снимите машину и подпишите акт выдачи №3.`
          : `Консьерж ${kName(L.conciergeId)} едет к вам${L.step===1?` · ${Math.round((L.progress||0)*100)}% пути`:''}. Подготовьте машину.`;
        html = `<div class="panel"><h4>Готово к выдаче</h4><p style="font-size:13.5px; color:var(--ink-soft);">${note}</p>
          <div class="cost-total"><span>К оплате</span><span>${total} Br</span></div></div>` + handoverPanel(r);
        if(!arrived && r.acts.handover.status!=='done') html = html.replace('onclick="signHandover()"', 'onclick="signHandover()" data-wait="1"');
      }
    } else {
      _renderJobMain(r);
      // реальная сумма вместо заглушки
      el.querySelectorAll('.cost-total span:last-child').forEach(s=>{ if(s.textContent==='135 Br') s.textContent = (o.estimate.total||o.price)+' Br'; });
      el.insertAdjacentHTML('beforeend', chatPanel(o));
      document.getElementById('jdActsSide').innerHTML = actsSidePanel(r);
      return;
    }
    el.innerHTML = html + chatPanel(o);
    document.getElementById('jdActsSide').innerHTML = actsSidePanel(r);
  };

  window.renderStageTrack = function(r){
    const track = document.getElementById('jdStageTrack');
    const cur = r.o.status==='confirmed' ? -1 : ['ready','returned'].includes(r.o.status) ? 4 : r.stage;
    track.innerHTML = stages.map((s,i)=>{
      const cls = i<cur || (i===4 && r.o.status==='returned') ? 'done' : (i===cur ? 'current' : '');
      return `<div class="stage-dot-wrap ${cls}"><div class="stage-dot"></div><span class="lbl">${s.label}</span></div>`;
    }).join('');
  };

  function chatPanel(o){
    return `<div class="panel"><h4>Чат по заказу · клиентка, консьерж, диспетчер</h4>
      <div class="sto-chat" id="stoChat">${o.chat.length ? o.chat.map(m=>`<div class="sc-msg ${m.from==='sto'?'out':'in'}"><div class="sc-who">${esc(m.from==='sto'?'Вы':m.name)} · ${MA.hhmm(m.ts)}</div>${esc(m.text)}</div>`).join('') : '<p class="of-hint">Сообщений пока нет. Напишите клиентке, если нужно что-то уточнить.</p>'}</div>
      <div class="sc-in"><input id="stoChatInp" placeholder="Сообщение клиентке" onkeydown="if(event.key==='Enter') stoSendChat()"><button class="btn btn-primary" onclick="stoSendChat()">Отправить</button></div></div>`;
  }
  window.stoSendChat = async ()=>{
    const i = document.getElementById('stoChatInp'); const v = i.value.trim(); if(!v) return;
    i.value=''; i.blur();
    await act('chat.send', {orderId:openJobId, text:v});
  };

  window.advanceStage = async function(){
    const r = curJob(); if(!r) return;
    const p = {orderId:r.id, to:r.stage+1};
    if(r.stage===1){ const t=document.getElementById('diagText'); p.diagnosis = t ? t.value.trim() : ''; document.activeElement && document.activeElement.blur(); }
    const ok = await act('sto.stage', p, {1:'Диагностика начата — клиентка получила push', 2:'Диагностика сохранена — подготовьте смету', 4:'Ремонт завершён — клиентке ушёл push, ищем консьержа на возврат'}[p.to]);
  };
  window.sendEstimate = async function(){
    const r = curJob(); const items = lineItems.filter(li=>li.name && li.name.trim());
    document.activeElement && document.activeElement.blur();
    const ok = await act('estimate.send', {orderId:r.id, items}, 'Смета отправлена клиентке — ждём согласования');
    if(ok) delete liDraft[r.id];
  };
  window.addLineItem = function(){ lineItems.push({name:'', price:0}); renderLineItems(); };
  window.acceptIntake = ()=> act('act.accept', {orderId:openJobId, n:2}, 'Приёмка подтверждена — можно начинать диагностику');
  window.intakeSelf = ()=> act('sto.intakeSelf', {orderId:openJobId}, 'Машина принята — акт приёмки №2 сохранён');
  window.selfHandover = ()=> act('sto.selfHandover', {orderId:openJobId}, 'Машина выдана клиентке — ждём оплату');
  window.signHandover = async function(){
    const r = curJob(); const h = r.acts.handover;
    const L = r.o.ret;
    if(!L || !L.conciergeId || L.step<2){ showToast('Консьерж ещё не приехал — акт подписывается вместе с ним'); return; }
    const ok = await act('act.create', {orderId:r.id, n:3, photos:h.photos, mileage:h.mileage, fuel:h.fuel}, 'Акт №3 подписан — машина выдана консьержу');
    if(ok) h.status='done';
  };
  window.finishJob = ()=> showView('history');
  const _intakePanel = intakePanel;
  window.intakePanel = (r)=> _intakePanel(r).replace('<span>Повреждения</span><b></b>', '<span>Повреждения</span><b>не отмечено</b>');
  window.actsSidePanel = function(r){
    const A = r.o.acts, st = (a)=> !a ? 'none' : a.status==='accepted' ? 'ok' : a.status==='disputed' ? 'bad' : 'pending';
    const sub = (n, a, def)=> !a ? def : a.status==='disputed' ? 'спор у диспетчера' : `${a.status==='accepted'?'подтверждено':'ждёт проверки'} · ${MA.hhmm(a.ts)} · ${Number(a.mileage).toLocaleString('ru')} км`;
    const self = r.o.delivery==='self';
    const rows = self ? [['2','Приёмка в СТО', sub(2,A[2],'когда клиентка привезёт'), st(A[2])], ['3','Выдача клиентке', sub(3,A[3],'после ремонта'), st(A[3])]] : [
      ['1','Забор у клиентки', sub(1,A[1],'консьерж + клиентка'), st(A[1])],
      ['2','Приёмка в СТО', A[2]&&A[2].status==='pending' ? 'ждёт вашей проверки' : sub(2,A[2],'когда консьерж привезёт'), st(A[2])],
      ['3','Выдача консьержу', sub(3,A[3],'после ремонта'), st(A[3])],
      ['4','Возврат клиентке', sub(4,A[4],'консьерж + клиентка'), st(A[4])]
    ];
    return `<div class="panel"><h4>Акты осмотра</h4>${rows.map(x=>`
      <div class="act-row"><div class="n">${x[0]}</div><div class="body"><div>${x[1]}</div><div class="t2">${x[2]}</div></div><span class="act-pill ${x[3]==='bad'?'pending':x[3]}">${x[3]==='ok'?'ок':x[3]==='pending'?'проверка':x[3]==='bad'?'спор':'—'}</span></div>`).join('')}</div>`;
  };

  // «Есть расхождение» в акте приёмки → спор у диспетчера
  document.addEventListener('click', (e)=>{
    const b = e.target.closest('button'); if(!b || !/Есть расхождение/.test(b.textContent)) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const text = prompt('Что не совпадает с актом консьержа?', 'Новая царапина на заднем бампере, в акте её нет');
    if(text) act('dispute.open', {orderId:openJobId, n:2, text}, 'Спор открыт — диспетчер платформы свяжется в чате');
  }, true);

  // ---------------- уведомления ----------------
  window.openStoNotif = function(id){
    const n = stoNotifs.find(x=>x.id===id); if(!n) return;
    n.unread=false; updateStoBell(); MA.act('notif.read', {id}).catch(()=>{});
    document.getElementById('notifPop').classList.remove('open');
    const l = n.link || {};
    if(l.view==='job' && l.orderId && requests.find(r=>r.id===l.orderId && r.status==='taken')) openJob(l.orderId);
    else if(l.view==='job' || l.view==='myjobs') showView('myjobs');
    else showView(['marketplace','history','profile'].includes(l.view) ? l.view : 'marketplace');
  };
  window.readAllSto = function(){ stoNotifs.forEach(n=>n.unread=false); updateStoBell(); renderNotifPop(); MA.act('notif.read', {all:true}).catch(()=>{}); };

  const css = document.createElement('style');
  css.textContent = `.offer-form{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--paper)}
    .of-row{display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:8px}.of-row label{font-size:11.5px;color:var(--ink-faint);display:flex;flex-direction:column;gap:4px}
    .of-row input{border:1px solid var(--line);border-radius:9px;padding:9px 10px;font:14px 'Inter',sans-serif;color:var(--ink);background:#fff}
    .of-hint{font-size:11.5px;color:var(--ink-faint);line-height:1.45;margin-bottom:10px}
    .offer-wait{font-size:12px;color:var(--teal);font-weight:600}.offer-others{display:block;font-size:11px;color:var(--ink-faint);font-weight:500;margin-top:2px}
    .sto-chat{display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;margin-bottom:10px}
    .sc-msg{max-width:82%;padding:8px 11px;border-radius:12px;font-size:13px;line-height:1.45;background:var(--paper-dim);align-self:flex-start}
    .sc-msg.out{background:var(--amber-soft);align-self:flex-end}.sc-who{font-size:10.5px;color:var(--ink-faint);margin-bottom:2px}
    .sc-in{display:flex;gap:8px}.sc-in input{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:14px 'Inter',sans-serif}
    button[data-wait]{opacity:.55}
    @media (max-width:700px){.of-row{grid-template-columns:1fr}}`;
  document.head.appendChild(css);

  MA.connect({ role:'sto', id:ME, badge:{pos:'bottom-right'},
    onState(v, prev, first){ applyState(v); if(first){ renderMarket(); } rerender(); const c=document.getElementById('stoChat'); if(c) c.scrollTop=c.scrollHeight; },
    onNotify(n){ pushStoUi(n); },
    onLoc(l){ if(!V) return; const o=V.orders.find(x=>x.id===l.orderId); if(o && o[l.leg]) o[l.leg].progress=l.progress; }
  });
  function pushStoUi(n){
    const bell = document.getElementById('bellIco');
    bell.classList.remove('bell-ring'); void bell.offsetWidth; bell.classList.add('bell-ring');
    if(n.sound) beep();
    showToast(n.title + (n.text ? ' · ' + n.text : ''));
  }
})();
