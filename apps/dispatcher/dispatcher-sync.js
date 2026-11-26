/* Панель диспетчера ↔ сервер экосистемы «Мой автомеханик».
   Данные прототипа (sosCalls, disputes, concierges, unassigned, orders) заменяются живыми данными,
   кнопки диспетчера и директора отправляют действия на сервер — их сразу видят клиентка, СТО и консьерж. */
(function(){
  let V = null, pendingRender = false;
  const esc = (s)=>MA.esc(s);
  const C = ()=>V.consts;

  function conciergeRows(){
    const busyOrder = {};
    V.orders.forEach(o=>{
      if(o.ret && o.ret.conciergeId && o.ret.step<5) busyOrder[o.ret.conciergeId] = {o, leg:'ret'};
      else if(o.pickup && o.pickup.conciergeId && o.pickup.step<6) busyOrder[o.pickup.conciergeId] = {o, leg:'pickup'};
    });
    return Object.values(V.concierges).map(k=>{
      const b = busyOrder[k.id];
      let status, note, order = null;
      if(b){
        const L = b.o[b.leg], steps = b.leg==='ret' ? C().RETURN_STEPS : C().PICKUP_STEPS;
        order = b.o.id;
        const drivingNow = b.leg==='pickup' ? (L.step===1||L.step===4) : (L.step===1||L.step===3);
        status = k.lateMin>0 ? 'late' : drivingNow ? 'road' : 'job';
        note = `${steps[L.step]}${drivingNow?` · ${Math.round((L.progress||0)*100)}% пути`:''} · ${b.leg==='ret'?'возврат':'забор'} · ${b.o.address||''} · слот ${b.o.slot||''}`;
      } else if(!k.onShift){ status='off'; note = 'Не на смене'; }
      else { status='free'; note = 'Свободен'; }
      return { id:k.id, name:k.name, car:k.car, rating:k.rating, status, order, note, lateMin:k.lateMin, dist:null, fines:k.fines||[], live:true };
    });
  }

  function orderRow(o){
    const now = Date.now();
    let step=0, stage='', since=o.updatedAt, stuck=null;
    const kn = (id)=> id && V.concierges[id] ? V.concierges[id].name : '—';
    if(o.status==='confirmed'){
      if(o.delivery==='self'){ step=0; stage='Клиентка везёт машину сама'; }
      else if(!o.pickup || !o.pickup.conciergeId){ step=0; stage='Ждёт консьержа'; since=o.pickup?o.pickup.ts:o.updatedAt; }
      else { step=[0,1,2,3,4,4,5][o.pickup.step]; stage=C().PICKUP_STEPS[o.pickup.step]; since=o.pickup.ts; }
    } else if(o.status==='at_sto'){
      step=5; stage='СТО: '+C().STO_STAGES[o.stage]+(o.stage===2&&o.estimate.status==='sent'?' · смета ждёт клиентку':''); since=o.stageTs||o.updatedAt;
      if(o.stage===0 && o.acts[2] && o.acts[2].status==='pending') stage='СТО проверяет акт приёмки №2';
      if(o.stage===2 && o.estimate.status==='sent' && now-(o.estimate.ts||now) > 3*3600e3){ stuck='Смета не согласована больше 3 часов'; stage='Смета ждёт согласования клиентки'; }
    } else if(o.status==='ready'){
      if(o.delivery==='self'){ step=6; stage='Готово · клиентка заберёт сама'; }
      else if(!o.ret || !o.ret.conciergeId){ step=6; stage='Готово · ждёт консьержа на возврат'; since=o.ret?o.ret.ts:o.updatedAt; }
      else { step=o.ret.step<3?6:7; stage=C().RETURN_STEPS[o.ret.step]; since=o.ret.ts; }
    } else if(o.status==='returned'){
      step=8; stage = o.frozen ? `Возвращено · спор ${o.disputeId||''}` : 'Возвращено · ждёт оплату'; since=(o.ret&&o.ret.ts)||o.updatedAt;
    }
    if(o.late) { stuck = o.late; stage = 'Консьерж опаздывает'; }
    const kid = (o.ret && o.ret.conciergeId) || (o.pickup && o.pickup.conciergeId);
    return { id:o.id, car:o.car, client:o.client, sto:o.stoName||'—', concierge: o.delivery==='self' ? 'не нужен' : kn(kid), step, stage,
      inStage: fmtDur((now-since)/1000), stuck, frozen:o.frozen, raw:o };
  }

  function apply(v){
    V = v;
    const t = (ts)=> MA.when(ts).replace('Сегодня, ','');
    sosCalls = V.sos.map(s=>Object.assign({}, s, { ago:(T0-s.ts)/1000, log:s.log.map(l=>({t:t(l.ts), x:l.x})),
      scenario: (s.kind==='tow'?'Эвакуатор · ':'')+(s.source==='concierge'?'Консьерж · ':'')+s.scenario }));
    disputes = V.disputes.map(d=>Object.assign({}, d, { ago:(T0-d.ts)/1000, takenAt: d.takenTs==null ? null : (d.takenTs-d.ts)/1000,
      log:d.log.map(l=>({t:t(l.ts), x:l.x})), chat:d.chat.map(c=>({w:c.w, t:t(c.ts), x:c.x})), estimate: d.estimate || [] }))
      .sort((a,b)=>b.ts-a.ts);
    concierges = conciergeRows();
    unassigned = V.orders.filter(o=>V.free[o.id]).map(o=>({ id:o.id, car:o.car, client:o.clientShort||o.client, address: o.status==='ready' ? `${o.stoName} → ${o.address}` : o.address,
      slot:o.slot, sto:o.stoName, leg: o.status==='ready'?'ret':'pickup', free:V.free[o.id] }));
    orders = V.orders.filter(o=>['confirmed','at_sto','ready'].includes(o.status) || (o.status==='returned')).map(orderRow)
      .sort((a,b)=>(!!b.stuck-!!a.stuck)||(a.step-b.step));
    handoverNotes = Object.assign({}, V.handoverNotes);
  }

  function safeRender(){
    const a = document.activeElement;
    if(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('.content')){ pendingRender = true; updateCounts(); return; }
    pendingRender = false;
    if(currentView==='dispute' && !disputes.find(x=>x.id===openDisputeId)) currentView='disputes';
    render();
    if(currentView==='dispute' && document.getElementById('decSel')) decChanged();
  }
  document.addEventListener('focusout', ()=> setTimeout(()=>{ if(pendingRender && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) safeRender(); }, 50));

  async function act(type, p, ok){
    try{ const r = await MA.act(type, p); if(ok) showToast(typeof ok==='function' ? ok(r) : ok); return r || true; }
    catch(e){ showToast(e.message); return null; }
  }

  // ---------------- действия ----------------
  window.sosStep = (id, step, what)=> act('sos.step', {id, step, what}, r=>r.text);
  window.takeDispute = ()=> act('dispute.take', {id:openDisputeId}, 'Спор в работе — стороны получили push');
  window.requestInfo = (who, what)=> act('dispute.request', {id:openDisputeId, who, what}, `Запрос отправлен ${who} — push в приложение`);
  window.sendChat = ()=>{ const el=document.getElementById('chatInp'); const v=el.value.trim(); if(!v) return; el.value=''; el.blur(); act('dispute.chat', {id:openDisputeId, text:v}, 'Сообщение ушло в чат заказа'); };
  window.submitProposal = ()=>{
    const k = document.getElementById('decSel').value;
    const amount = +document.getElementById('decAmount').value || 0;
    const reason = document.getElementById('decReason').value.trim();
    if(!reason){ showToast('Добавьте обоснование решения'); return; }
    document.activeElement && document.activeElement.blur();
    act('dispute.propose', {id:openDisputeId, decision:k, amount, reason}, (k==='partial'||k==='full') ? 'Отправлено директору — ему пришёл push' : 'Спор закрыт — стороны получили push');
  };
  window.approve = (id)=>{ const c=(document.getElementById('dirComment-'+id)||{}).value||''; act('dispute.approve', {id, comment:c}, 'Возврат утверждён — клиентка и СТО получили push'); };
  window.reject = (id)=>{ const c=((document.getElementById('dirComment-'+id)||{}).value||'').trim(); if(!c){ showToast('Напишите, что нужно доработать'); return; } act('dispute.reject', {id, comment:c}, 'Спор возвращён диспетчеру'); };
  window.assign = (orderId, conciergeId)=>{
    const u = unassigned.find(x=>x.id===orderId);
    act('concierge.assign', {orderId, conciergeId, leg:u&&u.leg}, ()=>`${V.concierges[conciergeId].name} назначен на заказ №${orderId} — клиентке пришёл push с карточкой консьержа`);
  };
  window.reassign = (i)=> act('concierge.reassign', {conciergeId:concierges[i].id}, r=>`Заказ передан: ${r.to}. ${concierges[i].name} — штраф ${money(CONCIERGE_FEE*0.5)}`);
  window.removeFine = (i)=>{ const reason=document.getElementById('fineReason').value; fineEdit=null; act('fine.remove', {conciergeId:concierges[i].id, reason}, `Штраф ${concierges[i].name} снят. Причина: ${reason}`); };
  window.nudge = (id)=> act('order.nudge', {orderId:id}, ()=>{ const o=orders.find(x=>x.id===id); return `Сообщение отправлено: ${o.client} и ${o.sto}`; });

  // ---------------- экраны, которым нужны живые данные ----------------
  window.renderConcierges = function(){
    document.getElementById('view-concierges').innerHTML = `
      <div class="topbar"><div><h1>Консьержи</h1><p class="sub">Назначение на заказы и контроль опозданий. Опоздание больше 20 минут — штраф 50% от стоимости выезда (${money(CONCIERGE_FEE)}).</p></div></div>
      ${unassigned.map(u=>`<div class="panel" style="border-color:var(--amber);">
        <h4>Ждёт назначения · заказ №${u.id} · ${u.leg==='ret'?'возврат клиентке':'забор у клиентки'}</h4>
        <div class="kv"><span>${esc(u.car)} · ${esc(u.client)}</span><b>${esc(u.address)} · ${esc(u.slot)}</b></div>
        <p class="warn-note" style="margin:10px 0 8px;">Ближайшие свободные к адресу ${u.leg==='ret'?'СТО':'забора'}:</p>
        ${u.free.length ? u.free.map(c=>`<div class="kv" style="align-items:center;"><span><b style="color:var(--ink);">${esc(c.name)}</b> · ${esc(c.car)}${c.rating?' · ★ '+c.rating:''}${c.dist!=null?` · ${String(c.dist).replace('.',',')} км`:''}</span><button class="btn btn-primary btn-sm" onclick="assign('${u.id}','${c.id}')">Назначить</button></div>`).join('') : '<p class="warn-note">Свободных консьержей на смене нет</p>'}
      </div>`).join('')}
      <table class="tbl"><thead><tr><th>Консьерж</th><th>Статус</th><th>Сейчас</th><th>Штрафы</th><th></th></tr></thead><tbody>
      ${concierges.map((c,i)=>{
        const active = c.fines.filter(f=>!f.removed);
        return `<tr class="${c.status==='late'?'hl':''}">
          <td class="nw"><div class="who"><b>${esc(c.name)}</b></div><div class="sub">${esc(c.car)}${c.rating?' · ★ '+c.rating:''}</div></td>
          <td class="nw"><span class="pill ${c.status}">${C_STATUS[c.status]}${c.status==='late'?' '+c.lateMin+' мин':''}</span></td>
          <td>${c.order?`Заказ №${c.order}<div class="sub">${esc(c.note)}</div>`:`<span class="sub">${esc(c.note)}</span>`}</td>
          <td class="mono nw">${active.length?active.map(f=>`${money(f.sum)} · №${f.order}`).join('<br>'):'—'}${c.fines.some(f=>f.removed)?'<div class="sub">есть снятые</div>':''}</td>
          <td><div class="cell-actions">
            ${c.status==='late'?`<button class="btn btn-outline btn-sm" onclick="reassign(${i})">Переназначить</button> `:''}
            ${active.length?`<button class="btn btn-outline btn-sm" onclick="fineEdit=${i}; renderConcierges();">Снять штраф</button>`:''}
          </div></td></tr>
          ${fineEdit===i?`<tr><td colspan="5" style="background:var(--paper);">
            <div style="display:flex; gap:8px; align-items:center;"><select class="inp" id="fineReason" style="max-width:360px;"><option>Пробка из-за ДТП на маршруте</option><option>Задержка по вине клиентки</option><option>Диспетчер изменил маршрут</option><option>Другое</option></select>
            <button class="btn btn-dark btn-sm" onclick="removeFine(${i})">Снять с обоснованием</button><button class="btn btn-outline btn-sm" onclick="fineEdit=null; renderConcierges();">Отмена</button></div></td></tr>`:''}`;
      }).join('')}</tbody></table>`;
  };

  window.renderOrders = function(){
    document.getElementById('view-orders').innerHTML = `
      <div class="topbar"><div><h1>Заказы</h1><p class="sub">Шаги консьержа и СТО в реальном времени · подсветка зависших заказов</p></div></div>
      <table class="tbl"><thead><tr><th style="width:210px;">Заказ</th><th>Ход заказа</th><th style="width:220px;">Сейчас</th><th></th></tr></thead><tbody>
      ${orders.map(o=>`<tr class="${o.stuck?'hl':''}">
        <td><b>№${o.id}</b> · ${esc(o.car)}<div class="sub">${esc(o.client)} · ${esc(o.sto)}</div><div class="sub">Консьерж: ${esc(o.concierge)}</div></td>
        <td><div class="steps-track">${ORDER_STEPS.map((s,i)=>`<div class="${i<o.step?'done':i===o.step?'cur':''}" title="${s}"></div>`).join('')}</div>
          <div class="steps-lbl"><span>${ORDER_STEPS[0]}</span><span>${o.step>=8?'Возвращено':ORDER_STEPS[o.step]}</span><span>${ORDER_STEPS[7]}</span></div></td>
        <td>${esc(o.stage)}<div class="sub">в стадии: ${o.inStage}</div>${o.stuck?`<div class="sub" style="color:var(--alert); font-weight:600;">${esc(o.stuck)}</div>`:''}${o.frozen?'<div class="sub" style="color:var(--alert);">оплата заморожена</div>':''}</td>
        <td style="text-align:right; white-space:nowrap;">${o.stuck?`<button class="btn btn-outline btn-sm" onclick="nudge('${o.id}')">Написать сторонам</button>`:''}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="sub">Активных заказов нет</td></tr>'}</tbody></table>`;
  };

  window.renderHandover = function(){
    const items = [
      ...sosCalls.filter(s=>s.step<4).map(s=>({k:s.id, t:`SOS ${s.id} · ${s.scenario} · ${s.client}`, s:SOS_STEPS[s.step]})),
      ...disputes.filter(d=>d.status!=='closed').map(d=>({k:d.id, t:`Спор ${d.id} · ${d.type} · ${d.client}`, s:STATUS_LBL[d.status]})),
      ...orders.filter(o=>o.stuck).map(o=>({k:'o'+o.id, t:`Заказ №${o.id} · ${o.stuck}`, s:o.stage}))
    ];
    document.getElementById('view-handover').innerHTML = `
      <div class="topbar"><div><h1>Передача смены</h1><p class="sub">Комментарии сохраняются на сервере и видны следующей смене</p></div></div>
      <div class="panel handover">${items.map(it=>`<div style="padding:10px 0; border-bottom:1px solid var(--line);">
        <div style="display:flex; justify-content:space-between; gap:10px;"><b style="font-size:13.5px;">${esc(it.t)}</b><span class="pill waiting">${esc(it.s)}</span></div>
        <textarea placeholder="Комментарий для следующей смены" data-hk="${it.k}">${esc(handoverNotes[it.k]||'')}</textarea>
      </div>`).join('')}
      <button class="btn btn-primary btn-block" style="margin-top:14px;" onclick="MA.act('handover.submit',{count:${items.length}}).then(()=>showToast('Смена передана Андрею М. — ${items.length} открытых пунктов с комментариями'))">Передать смену</button></div>`;
  };
  let noteTimer = {};
  document.addEventListener('input', (e)=>{
    const k = e.target.dataset && e.target.dataset.hk; if(!k) return;
    handoverNotes[k] = e.target.value;
    clearTimeout(noteTimer[k]); noteTimer[k] = setTimeout(()=>MA.act('handover.note', {key:k, text:e.target.value}).catch(()=>{}), 500);
  });

  // факты спора по реальным актам заказа
  const _facts = factsHtml;
  window.factsHtml = function(d){
    if(d.facts==='acts' && d.acts && d.acts[1] && d.acts[d.actN || 4]){
      const a = d.acts[1], b = d.acts[d.actN || 4];
      const fresh = b.damages.filter(x=>!a.damages.includes(x));
      const row = (l, x, y, bad)=>`<div class="kv"><span>${l}</span><b ${bad?'style="color:var(--alert);"':''}>${x} → ${y}</b></div>`;
      return `<div class="cmp" style="margin-bottom:6px; font-size:11px; color:var(--ink-faint); font-family:'IBM Plex Mono',monospace;"><span>АКТ №1 · ${MA.hhmm(a.ts)}</span><span>АКТ №${b.n} · ${MA.hhmm(b.ts)}</span></div>
        ${['Спереди','Справа','Слева'].map(p=>`<div class="cmp" style="margin-bottom:8px;"><div class="ph">${I.cam}<div class="cap">${p} · ${MA.hhmm(a.ts)}</div></div><div class="ph" ${fresh.length&&p!=='Слева'?'style="outline:2px solid var(--alert); outline-offset:-2px;"':''}>${I.cam}<div class="cap">${p} · ${MA.hhmm(b.ts)}</div></div></div>`).join('')}
        ${row('Пробег, км', a.mileage.toLocaleString('ru'), b.mileage.toLocaleString('ru'), b.mileage-a.mileage>30)}
        ${row('Топливо', a.fuel, b.fuel, a.fuel!==b.fuel)}
        <div class="kv"><span>Повреждения в акте №1</span><b>${esc(a.damages.join('; ')||'нет')}</b></div>
        <div class="kv"><span>Повреждения в акте №${b.n}</span><b ${fresh.length?'style="color:var(--alert);"':''}>${esc(b.damages.join('; ')||'нет')}</b></div>
        ${d.acts[2]&&d.acts[3]?`<div class="kv"><span>Акты №2 и №3 (СТО)</span><b>${d.acts[3].damages.length>d.acts[2].damages.length?'Расхождение появилось на СТО':'На СТО новых повреждений не зафиксировано'}</b></div>`:''}
        <div class="kv"><span>Кто вёз машину</span><b>Консьерж ${esc(d.concierge)}</b></div>`;
    }
    if(d.facts==='estimate' && !d.estimate.length) return `<p class="warn-note">Смета по заказу ещё не сформирована</p>`;
    return _facts(d);
  };

  // уведомления → тост + звук; SOS всегда со звуком
  // смена: настоящий сотрудник из аккаунта. Директор может смотреть и экран диспетчера, диспетчер экран директора — нет
  window.renderShift = function(){
    const me = V && V.profile ? V.profile.name : '';
    document.getElementById('shiftBox').innerHTML = role==='dispatcher'
      ? `Вы вошли как <b>диспетчер</b>${me?`<br><b>${esc(me)}</b>`:''}`
      : `Вы вошли как <b>директор</b>${me?` · ${esc(me)}`:''}<br>Утверждаете все возвраты клиенткам`;
  };
  let roleSet = false;
  MA.connect({ role:'dispatcher', badge:{pos:'bottom-right'},
    onState(v){
      apply(v);
      if(!roleSet){
        roleSet = true;
        const isDir = v.me && v.me.role==='director';
        document.getElementById('roleR').style.display = isDir ? '' : 'none';
        setRole(isDir ? 'director' : 'dispatcher');
      }
      safeRender();
    },
    onNotify(n){ showToast(n.title + (n.text ? ' · ' + n.text : '')); if(n.sound || n.urgent) beep(); }
  });
})();
