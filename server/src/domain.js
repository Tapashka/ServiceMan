// Бизнес-логика экосистемы: единый жизненный цикл заказа для клиентки, СТО, консьержа и диспетчера.
//
//  published ──(клиентка выбрала предложение)──▶ confirmed ──(акт №2 / машина на СТО)──▶ at_sto
//      │                                             │ консьерж: pickup.step 0..6            │ СТО: stage 0..4
//      └ СТО присылают предложения (offers)          ▼                                       ▼
//  closed ◀──(оплата)── returned ◀──(акт №4)── ready (stage 4) ── консьерж: ret.step 0..5
//
// Все действия приходят как {type, p} от конкретного участника (actor = {role, id}).

import { TAG_PRICE, TAG_WORK, KIT, STO_ME, CLIENT_ME, CONCIERGE_ME } from './seed.js';

const SEC = 1000, MIN = 60 * SEC;
export const CONCIERGE_FEE = 25;     // цена выезда для клиентки, Br
export const COMMISSION = 0.05;      // комиссия платформы
export const PAY = { pickup: 9, ret: 9 };

// Скорость демо: сколько мс бот ждёт перед следующим шагом
const BOT = { offer: 3500, choose: 6000, step: 5000, drive: 22000, stoStage: 7000, approve: 5000, pay: 6000 };

export const PICKUP_STEPS = ['Заказ принят','Выехал к клиентке','На месте','Акт осмотра №1','В пути в СТО','Акт осмотра №2','Машина в СТО'];
export const RETURN_STEPS = ['Заказ принят','Еду в СТО','В СТО · акт №3','Везу машину клиентке','Акт осмотра №4','Машина у клиентки'];
export const STO_STAGES = ['Принято','Диагностика','Смета','Ремонт','Готово'];

export class DomainError extends Error {}
const fail = (m) => { throw new DomainError(m); };

const R = Math.round;
export function haversine(a, b) {
  const toR = (x) => x * Math.PI / 180, Rr = 6371000;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * Rr * Math.asin(Math.sqrt(h));
}
const km = (a, b) => +(haversine(a, b) / 1000).toFixed(1);
const clone = (x) => JSON.parse(JSON.stringify(x));
const hhmm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

export function priceRange(tags) {
  const r = (tags || []).map((t) => TAG_PRICE[t]).filter(Boolean);
  if (!r.length) return [40, 150];
  return [Math.min(...r.map((x) => x[0])), Math.max(...r.map((x) => x[1]))];
}

// ---------------------------------------------------------------- уведомления
function notify(S, ctx, to, n) {
  const item = Object.assign({ id: 'n' + (S.seq) + '_' + Math.random().toString(36).slice(2, 7), to, ts: ctx.now, read: false, link: null, cat: 'order', ico: 'order' }, n);
  S.notifications.unshift(item);
  if (S.notifications.length > 300) S.notifications.length = 300;
  ctx.out.push(item);
}
const toClient = (o) => ({ role: 'client', id: o.clientId });
const toSto = (id) => ({ role: 'sto', id });
const toK = (id) => ({ role: 'concierge', id });
const toDisp = { role: 'dispatcher' };
const toDir = { role: 'director' };

function log(o, ctx, x) { o.log.push({ ts: ctx.now, x }); o.updatedAt = ctx.now; }
function botAt(o, ctx, delay) { o.bot.next = ctx.now + delay; }

function getOrder(S, id) { const o = S.orders[id]; if (!o) fail('Заказ не найден: ' + id); return o; }
function kName(S, id) { return id && S.concierges[id] ? S.concierges[id].name : '—'; }
function stoName(S, id) { return id && S.stos[id] ? S.stos[id].name : '—'; }
function cName(S, o) { return S.clients[o.clientId] ? S.clients[o.clientId].name : '—'; }
function chatPush(S, o, ctx, from, name, text) {
  o.chat.push({ id: o.chat.length + 1, from, name, text, ts: ctx.now });
  o.updatedAt = ctx.now;
  if (o.disputeId && S.disputes[o.disputeId] && S.disputes[o.disputeId].status !== 'closed' && from !== 'dispatcher')
    S.disputes[o.disputeId].chat.push({ w: name, ts: ctx.now, x: text });
}

function makeAct(S, o, n, by, ctx, p = {}) {
  const cl = S.clients[o.clientId], st = S.stos[o.stoId];
  const place = (n === 1 || n === 4) ? (o.address || cl.address) : st.address;
  const prev = o.acts[n - 1];
  const mileage = +String(p.mileage || '').replace(/\D/g, '') || (prev ? prev.mileage + (n === 4 ? 16 : n === 2 ? 12 : 3) : 84200);
  const act = {
    n, by, ts: ctx.now, place, mileage,
    fuel: p.fuel || (prev ? prev.fuel : '1/2'),
    photos: p.photos == null ? 12 : p.photos,
    damages: p.damages || (prev ? prev.damages.slice() : []),
    kitMissing: p.kitMissing || [],
    items: p.items != null && p.items !== '' ? p.items : (prev ? prev.items : 'Личных вещей нет'),
    status: 'pending'
  };
  o.acts[n] = act;
  return act;
}

// ---------------------------------------------------------------- действия
export function apply(S, actor, type, p = {}, now = Date.now()) {
  const ctx = { now, out: [], result: null };
  const A = ACTIONS[type];
  if (!A) fail('Неизвестное действие: ' + type);
  A(S, actor, p, ctx);
  S.seq++;
  return ctx;
}

const ACTIONS = {
  // ======================== КЛИЕНТКА ========================
  'order.create'(S, a, p, ctx) {
    const c = S.clients[a.id] || fail('Нет клиентки');
    const car = (c.cars.find((x) => x.id === p.carId) || c.cars[0] || { make: p.car || 'Автомобиль', plate: '', gear: 'АКПП' });
    const tags = (p.tags || []).filter(Boolean);
    const text = (p.text || '').trim();
    if (!tags.length && !text) fail('Опишите, что случилось, или выберите симптом');
    const id = String(S.nextOrder++).padStart(4, '0');
    const [pmin, pmax] = priceRange(tags);
    S.orders[id] = {
      id, clientId: c.id, car: car.make, plate: car.plate, gear: car.gear || 'АКПП', symptom: text || tags.join(', '), tags: tags.length ? tags : ['Не знаю, просто проверить'],
      slot: p.slot || 'Сегодня, 18:00–20:00', urgent: !!p.urgent, createdAt: ctx.now, updatedAt: ctx.now, status: 'published', priceMin: pmin, priceMax: pmax,
      offers: [], stoId: null, price: null, stage: 0, stageTs: null, diagnosis: '', estimate: { items: [], total: 0, status: 'none' },
      pickup: null, ret: null, acts: {}, chat: [], paid: false, rating: null, refund: 0, frozen: false, disputeId: null,
      delivery: 'concierge', comment: '', address: c.address, lng: c.lng, lat: c.lat, bot: { paused: false, next: ctx.now + BOT.offer }, log: []
    };
    log(S.orders[id], ctx, 'Заявка опубликована');
    Object.values(S.stos).filter((s) => !s.bot).forEach((s) => notify(S, ctx, toSto(s.id), { cat: 'req', ico: 'req', title: 'Новая заявка · ' + car.make,
      text: `${tags[0] || text.slice(0, 40)} · р-н ${c.district}, ${km(c, s)} км`, link: { view: 'marketplace', orderId: id }, sound: true }));
    ctx.result = { orderId: id };
  },

  'order.cancel'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (o.clientId !== a.id) fail('Чужой заказ');
    if (!['published', 'confirmed'].includes(o.status) || (o.pickup && o.pickup.step > 0)) fail('Заказ уже в работе — отмена через диспетчера');
    o.status = 'cancelled'; log(o, ctx, 'Клиентка отменила заказ');
    if (o.stoId) notify(S, ctx, toSto(o.stoId), { title: 'Заказ отменён', text: `Заявка №${o.id} · ${o.car}`, link: { view: 'myjobs' } });
    if (o.pickup && o.pickup.conciergeId) notify(S, ctx, toK(o.pickup.conciergeId), { title: 'Заказ отменён клиенткой', text: `№${o.id} · ${o.car}` });
  },

  'order.confirm'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (a.role === 'client' && o.clientId !== a.id) fail('Чужой заказ');
    if (o.status !== 'published') fail('Заявка уже подтверждена');
    const off = o.offers.find((x) => x.id === +p.offerId) || fail('Предложение не найдено');
    o.stoId = off.stoId; o.price = off.price; o.status = 'confirmed';
    o.delivery = p.delivery === 'self' ? 'self' : 'concierge';
    o.slot = p.slot || o.slot; o.comment = p.comment || '';
    if (p.address) { o.address = p.address; }
    if (p.lng && p.lat) { o.lng = +p.lng; o.lat = +p.lat; }
    o.estimate = { items: off.items.map((x) => ({ name: x.name, price: x.price })), total: off.price, status: 'none' };
    o.stage = 0; o.stageTs = ctx.now;
    if (o.delivery === 'concierge') o.pickup = { conciergeId: null, step: 0, ts: ctx.now, progress: 0 };
    log(o, ctx, `Клиентка выбрала ${stoName(S, o.stoId)} — ${o.price} Br · ${o.delivery === 'self' ? 'привезёт сама' : 'с консьержем'}`);
    botAt(o, ctx, BOT.step);
    notify(S, ctx, toSto(o.stoId), { ico: 'order', title: 'Клиентка выбрала ваше предложение', text: `Заявка №${o.id} · ${o.car} · ${o.price} Br. ${o.delivery === 'self' ? 'Клиентка привезёт машину сама' : 'Консьерж заберёт машину'} · ${o.slot}`, link: { view: 'job', orderId: o.id }, sound: true });
    o.offers.filter((x) => x.stoId !== o.stoId && !S.stos[x.stoId].bot).forEach((x) => notify(S, ctx, toSto(x.stoId), { ico: 'req', title: 'Клиентка выбрала другую СТО', text: `Заявка №${o.id} · ${o.car}` }));
    if (o.delivery === 'concierge') {
      Object.values(S.concierges).filter((k) => !k.bot && k.onShift).forEach((k) => notify(S, ctx, toK(k.id), { title: 'Новый заказ в ленте', text: `Забор · ${o.car} · ${o.slot}`, link: { view: 'feed' }, sound: true }));
      notify(S, ctx, toDisp, { ico: 'late', title: `Заказ №${o.id} ждёт консьержа`, text: `${o.car} · ${o.address} · ${o.slot}`, link: { view: 'concierges' } });
    }
    notify(S, ctx, toClient(o), { cat: 'order', ico: 'order', title: 'Заявка подтверждена', text: `${stoName(S, o.stoId)} · ${o.price} Br. ${o.delivery === 'self' ? 'Ждём вас на СТО · ' + o.slot : 'Ищем автоконсьержа на ' + o.slot}`, link: { view: 'status' } });
  },

  'estimate.approve'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (a.role === 'client' && o.clientId !== a.id) fail('Чужой заказ');
    if (o.estimate.status !== 'sent') fail('Смета ещё не пришла');
    if (Array.isArray(p.items) && p.items.length) { // клиентка могла выбрать другую запчасть
      o.estimate.items = p.items.map((x) => ({ name: String(x.name), price: +x.price || 0 }));
      o.estimate.total = o.estimate.items.reduce((s, x) => s + x.price, 0);
    }
    o.estimate.status = 'approved'; o.estimate.approvedTs = ctx.now;
    o.stage = 3; o.stageTs = ctx.now;
    log(o, ctx, `Смета ${o.estimate.total} Br одобрена клиенткой`);
    botAt(o, ctx, BOT.stoStage);
    notify(S, ctx, toSto(o.stoId), { ico: 'order', title: 'Смета одобрена', text: `Заявка №${o.id} · ${o.car} · ${o.estimate.total} Br. Можно начинать ремонт`, link: { view: 'job', orderId: o.id }, sound: true });
  },

  'estimate.decline'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (o.estimate.status !== 'sent') fail('Смета не на согласовании');
    o.estimate.status = 'declined'; log(o, ctx, 'Клиентка не согласовала смету');
    chatPush(S, o, ctx, 'client', cName(S, o), p.reason || 'Смета не подходит, давайте обсудим.');
    notify(S, ctx, toSto(o.stoId), { ico: 'chat', title: 'Смета не согласована', text: `Заявка №${o.id}: ${p.reason || 'клиентка просит пересмотреть смету'}`, link: { view: 'job', orderId: o.id } });
  },

  'act.accept'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    const act = o.acts[p.n] || fail('Акта нет');
    if (act.status !== 'pending') fail('Акт уже обработан');
    if ((p.n == 1 || p.n == 4) && a.role !== 'client' && a.role !== 'system') fail('Акт подтверждает клиентка');
    if (p.n == 2 && a.role !== 'sto' && a.role !== 'system') fail('Акт №2 подтверждает СТО');
    act.status = 'accepted'; act.acceptedTs = ctx.now;
    log(o, ctx, `Акт №${p.n} подтверждён`);
    if (p.n == 2) {
      botAt(o, ctx, BOT.stoStage);
      if (o.pickup && o.pickup.conciergeId) notify(S, ctx, toK(o.pickup.conciergeId), { title: 'СТО подтвердила приёмку', text: `Акт №2 · заказ №${o.id}` });
      notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'doc', title: 'Машина принята в сервисе', text: `${stoName(S, o.stoId)} подтвердил акт приёмки №2.`, link: { view: 'inspect', orderId: o.id, n: 2 } });
    }
    if (p.n == 4) { botAt(o, ctx, BOT.pay); }
  },

  'order.pay'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (a.role === 'client' && o.clientId !== a.id) fail('Чужой заказ');
    if (o.paid) fail('Уже оплачено');
    if (o.status !== 'returned') fail('Оплата станет доступна, когда машина вернётся к вам');
    if (o.frozen) fail('Оплата заморожена до решения спора');
    if (o.acts[4] && o.acts[4].status === 'pending') { o.acts[4].status = 'accepted'; o.acts[4].acceptedTs = ctx.now; }
    const total = o.estimate.total || o.price || 0;
    o.paid = true; o.paidTs = ctx.now; o.paidAmount = total; o.status = 'closed';
    log(o, ctx, `Оплачено ${total} Br`);
    notify(S, ctx, toSto(o.stoId), { ico: 'billing', title: 'Заказ оплачен', text: `№${o.id} · ${o.car} · ${total} Br. Выплата СТО ${R(total * (1 - COMMISSION) * 100) / 100} Br`, link: { view: 'history' } });
    notify(S, ctx, toClient(o), { cat: 'payment', ico: 'payment', title: 'Оплата прошла', text: `${total} Br · заказ №${o.id}. Оцените работу сервиса`, link: { view: 'status' } });
    ctx.result = { amount: total };
  },

  'order.rate'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    o.rating = Math.max(1, Math.min(5, +p.stars || 5)); o.ratingComment = p.comment || '';
    log(o, ctx, `Оценка ${o.rating}★`);
    notify(S, ctx, toSto(o.stoId), { ico: 'order', title: 'Новая оценка: ' + '★'.repeat(o.rating), text: `${o.car}${o.ratingComment ? ' · «' + o.ratingComment + '»' : ''}`, link: { view: 'history' } });
  },

  'car.add'(S, a, p, ctx) {
    const c = S.clients[a.id] || fail('Нет клиентки');
    if (!p.make || !p.plate) fail('Укажите марку и гос. номер машины');
    const car = { id: 'car' + (c.cars.length + 1) + '_' + ctx.now.toString(36), make: p.make, plate: p.plate, mileage: p.mileage || '—', vin: p.vin || '—', gear: p.gear || 'АКПП' };
    c.cars.push(car); ctx.result = car;
  },
  'client.update'(S, a, p, ctx) {
    const c = S.clients[a.id] || fail('Нет клиентки');
    ['name', 'phone', 'address', 'plan'].forEach((k) => { if (p[k]) c[k] = p[k]; });
    if (p.lng && p.lat) { c.lng = +p.lng; c.lat = +p.lat; }
  },

  // ======================== ЧАТ ========================
  'chat.send'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    const text = String(p.text || '').trim(); if (!text) fail('Пустое сообщение');
    const name = a.role === 'client' ? cName(S, o) : a.role === 'sto' ? stoName(S, a.id) : a.role === 'concierge' ? kName(S, a.id) + ' · консьерж' : 'Диспетчер';
    chatPush(S, o, ctx, a.role, name, text);
    const short = text.length > 80 ? text.slice(0, 78) + '…' : text;
    if (a.role !== 'client') notify(S, ctx, toClient(o), { cat: 'chat', ico: 'chat', title: a.role === 'sto' ? 'Сообщение от мастера' : a.role === 'concierge' ? 'Сообщение от консьержа' : 'Сообщение диспетчера', text: '«' + short + '»', link: { view: 'chat', orderId: o.id } });
    if (a.role !== 'sto' && o.stoId) notify(S, ctx, toSto(o.stoId), { ico: 'chat', title: 'Новое сообщение в чате', text: `${name}: «${short}»`, link: { view: 'job', orderId: o.id } });
    const kid = activeConciergeOf(o);
    if (a.role !== 'concierge' && kid) notify(S, ctx, toK(kid), { title: 'Сообщение по заказу №' + o.id, text: `${name}: «${short}»`, link: { view: 'trip' } });
    // клиентка-бот отвечает, чтобы переписка выглядела живой
    const cl = S.clients[o.clientId];
    if (cl && cl.bot && a.role !== 'client') o.bot.reply = ctx.now + 4000;
  },

  // ======================== СТО ========================
  'offer.send'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (o.status !== 'published') fail('Заявка уже недоступна');
    const price = +p.price; if (!(price > 0)) fail('Укажите цену');
    let items = Array.isArray(p.items) ? p.items.filter((x) => x && x.name).map((x) => ({ name: String(x.name), price: +x.price || 0 })) : [];
    if (!items.length) { const w = TAG_WORK[o.tags[0]] || ['Запчасти и материалы', 'Работа']; const parts = R(price * 0.6); items = [{ name: w[0], price: parts }, { name: w[1], price: price - parts }]; }
    o.offers = o.offers.filter((x) => x.stoId !== a.id);
    const off = { id: S.nextOffer++, stoId: a.id, price, items, note: p.note || '', ts: ctx.now };
    o.offers.push(off); o.updatedAt = ctx.now;
    log(o, ctx, `${stoName(S, a.id)} предложила ${price} Br`);
    if (S.clients[o.clientId] && S.clients[o.clientId].bot) botAt(o, ctx, BOT.choose);
    notify(S, ctx, toClient(o), { cat: 'order', ico: 'order', title: `Новое предложение: ${price} Br`, text: `${stoName(S, a.id)} ответил на заявку №${o.id}${p.note ? ' · ' + p.note : ''}`, link: { view: 'offers', orderId: o.id } });
    ctx.result = off;
  },
  'offer.withdraw'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (o.status !== 'published') fail('Клиентка уже выбрала');
    o.offers = o.offers.filter((x) => x.stoId !== a.id);
  },

  'sto.intakeSelf'(S, a, p, ctx) { // клиентка привезла машину сама
    const o = getOrder(S, p.orderId);
    if (o.stoId !== a.id && a.role !== 'system') fail('Чужой заказ');
    if (o.delivery !== 'self' || o.status !== 'confirmed') fail('Приёмка недоступна');
    o.status = 'at_sto';
    makeAct(S, o, 2, a.id, ctx, p).status = 'accepted';
    log(o, ctx, 'Машина принята на СТО (клиентка привезла сама)');
    botAt(o, ctx, BOT.stoStage);
    notify(S, ctx, toClient(o), { cat: 'order', ico: 'doc', title: 'Машина принята в сервисе', text: `${stoName(S, o.stoId)} · акт приёмки №2`, link: { view: 'status' } });
  },

  'sto.diagnosis'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    o.diagnosis = String(p.text || ''); o.updatedAt = ctx.now;
  },

  'sto.stage'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (a.role === 'sto' && o.stoId !== a.id) fail('Чужой заказ');
    const to = +p.to;
    if (o.status !== 'at_sto') fail('Машина ещё не на СТО');
    if (to !== o.stage + 1) fail('Неверный шаг');
    if (o.stage === 0) { const a2 = o.acts[2]; if (!a2 || a2.status !== 'accepted') fail('Сначала подтвердите акт приёмки'); }
    if (to === 3 && o.estimate.status !== 'approved') fail('Смета ещё не одобрена клиенткой');
    if (to > 4) fail('Заказ уже готов');
    if (p.diagnosis != null) o.diagnosis = String(p.diagnosis);
    o.stage = to; o.stageTs = ctx.now;
    log(o, ctx, 'Стадия: ' + STO_STAGES[to]);
    const msgs = {
      1: ['Стадия: Диагностика', `Мастер начал осмотр ${o.car}. Заявка №${o.id}.`],
      2: ['Мастер готовит смету', `Диагностика завершена${o.diagnosis ? ': ' + o.diagnosis.slice(0, 90) : ''}`],
      4: ['Машина готова', o.delivery === 'self' ? 'Можно забирать в сервисе.' : 'Ищем консьержа, чтобы вернуть машину вам.']
    };
    if (msgs[to]) notify(S, ctx, toClient(o), { cat: 'order', ico: 'order', title: msgs[to][0], text: msgs[to][1], link: { view: 'status' } });
    if (to === 4) {
      o.status = 'ready';
      if (o.delivery === 'concierge') {
        const prev = o.pickup && o.pickup.conciergeId;
        o.ret = { conciergeId: null, step: 0, ts: ctx.now, progress: 0, prefer: prev };
        Object.values(S.concierges).filter((k) => !k.bot && k.onShift).forEach((k) => notify(S, ctx, toK(k.id), { title: 'Новый заказ в ленте', text: `Возврат · ${o.car} · ${stoName(S, o.stoId)}`, link: { view: 'feed' }, sound: true }));
        notify(S, ctx, toDisp, { ico: 'late', title: `Заказ №${o.id} ждёт консьержа на возврат`, text: `${o.car} · ${stoName(S, o.stoId)} → ${o.address}`, link: { view: 'concierges' } });
      }
    }
    botAt(o, ctx, to === 4 ? BOT.step : BOT.stoStage);
  },

  'estimate.send'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (o.stage !== 2) fail('Смета отправляется на стадии «Смета»');
    const items = (p.items || []).filter((x) => x && x.name).map((x) => ({ name: String(x.name), price: +x.price || 0 }));
    if (!items.length) fail('Добавьте позиции сметы');
    o.estimate = { items, total: items.reduce((s, x) => s + x.price, 0), status: 'sent', ts: ctx.now, alternatives: p.alternatives || null };
    log(o, ctx, `Смета ${o.estimate.total} Br отправлена клиентке`);
    botAt(o, ctx, BOT.approve);
    notify(S, ctx, toClient(o), { cat: 'order', ico: 'order', title: 'Смета на согласование', text: `${stoName(S, o.stoId)}: ${o.estimate.total} Br · ${items.map((x) => x.name).join(', ').slice(0, 80)}`, link: { view: 'status' } });
  },

  'sto.selfHandover'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (o.delivery !== 'self' || o.status !== 'ready') fail('Выдача недоступна');
    makeAct(S, o, 3, a.id, ctx, p).status = 'accepted';
    o.status = 'returned'; log(o, ctx, 'Клиентка забрала машину');
    notify(S, ctx, toClient(o), { cat: 'payment', ico: 'payment', title: 'Машина выдана', text: `Оплатите заказ №${o.id}: ${o.estimate.total} Br`, link: { view: 'status' } });
  },

  // ======================== АКТЫ (консьерж / СТО) ========================
  'act.create'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    const n = +p.n;
    if (n === 1) {
      if (!o.pickup || o.pickup.conciergeId !== a.id || o.pickup.step < 2) fail('Акт №1 заполняется на месте у клиентки');
      if ((p.photos || 0) < 12) fail('Нужны все 12 фото');
      makeAct(S, o, 1, a.id, ctx, p);
      o.pickup.step = 4; o.pickup.ts = ctx.now; o.pickup.progress = 0;
      log(o, ctx, 'Акт №1 подписан, консьерж везёт машину в СТО');
      notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'doc', title: 'Акт осмотра ждёт проверки', text: `${kName(S, a.id)} сфотографировал машину при заборе. Проверьте акт — на это есть 24 часа.`, link: { view: 'inspect', orderId: o.id, n: 1 } });
      notify(S, ctx, toSto(o.stoId), { ico: 'concierge', title: 'Автоконсьерж везёт машину', text: `${kName(S, a.id)} · заявка №${o.id}. Подготовьте приёмку.`, link: { view: 'job', orderId: o.id } });
    } else if (n === 2) {
      if (!o.pickup || o.pickup.conciergeId !== a.id || o.pickup.step < 5) fail('Акт №2 заполняется в СТО');
      makeAct(S, o, 2, a.id, ctx, p);
      o.pickup.step = 6; o.pickup.ts = ctx.now; o.status = 'at_sto'; o.stage = 0; o.stageTs = ctx.now;
      payConcierge(S, o, a.id, 'pickup', ctx);
      log(o, ctx, 'Машина передана в СТО, акт №2 ждёт подтверждения станции');
      botAt(o, ctx, BOT.step);
      notify(S, ctx, toSto(o.stoId), { ico: 'camera', title: 'Приёмка: проверьте акт №2', text: `${kName(S, a.id)} передал ${o.car} · заявка №${o.id}`, link: { view: 'job', orderId: o.id }, sound: true });
      notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'concierge', title: 'Машина в сервисе', text: `${kName(S, a.id)} передал машину мастеру. Трансляция геопозиции завершена.`, link: { view: 'status' } });
    } else if (n === 3) {
      if (a.role !== 'sto' && a.role !== 'system') fail('Акт №3 подписывает СТО');
      if (!o.ret || !o.ret.conciergeId) fail('Консьерж ещё не назначен на возврат');
      if (o.ret.step < 2) fail('Консьерж ещё не приехал в СТО');
      makeAct(S, o, 3, o.stoId, ctx, p).status = 'accepted';
      o.ret.step = 3; o.ret.ts = ctx.now; o.ret.progress = 0;
      log(o, ctx, 'Акт №3 подписан, машина выдана консьержу');
      botAt(o, ctx, BOT.step);
      notify(S, ctx, toK(o.ret.conciergeId), { title: 'СТО выдала машину', text: `Акт №3 подписан · везите ${o.car} клиентке`, link: { view: 'trip' } });
      notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'concierge', title: `${kName(S, o.ret.conciergeId)} везёт машину к вам`, text: 'Следите на карте в статусе заказа.', link: { view: 'status' } });
    } else if (n === 4) {
      if (!o.ret || o.ret.conciergeId !== a.id || o.ret.step < 4) fail('Акт №4 заполняется у клиентки');
      if ((p.photos || 0) < 12) fail('Нужны все 12 фото');
      makeAct(S, o, 4, a.id, ctx, p);
      o.ret.step = 5; o.ret.ts = ctx.now; o.status = 'returned';
      payConcierge(S, o, a.id, 'ret', ctx);
      log(o, ctx, 'Машина возвращена клиентке, акт №4 ждёт проверки');
      botAt(o, ctx, BOT.pay);
      notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'doc', title: 'Машина возвращена — проверьте акт №4', text: 'Сравните с актом при заборе и оплатите заказ.', link: { view: 'compare', orderId: o.id } });
      notify(S, ctx, toSto(o.stoId), { ico: 'concierge', title: 'Машина у клиентки', text: `Заявка №${o.id} · ждём оплату`, link: { view: 'job', orderId: o.id } });
    } else fail('Неизвестный акт');
  },

  // ======================== КОНСЬЕРЖ ========================
  'concierge.shift'(S, a, p, ctx) {
    const k = S.concierges[a.id] || fail('Нет консьержа');
    k.onShift = !!p.on;
    notify(S, ctx, toDisp, { ico: 'ok', title: `${k.name} ${k.onShift ? 'вышел на смену' : 'закончил смену'}`, text: k.car, link: { view: 'concierges' } });
  },
  'concierge.type'(S, a, p, ctx) { const k = S.concierges[a.id]; if (k && ['partner', 'staff', 'sto'].includes(p.type)) k.type = p.type; },
  'concierge.loc'(S, a, p, ctx) { const k = S.concierges[a.id]; if (k && p.lng && p.lat) { k.lng = +p.lng; k.lat = +p.lat; } },

  'job.take'(S, a, p, ctx) { takeJob(S, p.orderId, p.leg, a.id, ctx, 'self'); },
  'concierge.assign'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    const leg = p.leg || (o.status === 'ready' ? 'ret' : 'pickup');
    takeJob(S, o.id, leg, p.conciergeId, ctx, 'dispatcher');
  },
  'concierge.reassign'(S, a, p, ctx) {
    const k = S.concierges[p.conciergeId] || fail('Нет консьержа');
    const o = Object.values(S.orders).find((x) => activeConciergeOf(x) === k.id) || fail('У консьержа нет заказа');
    const leg = o.ret && o.ret.conciergeId === k.id ? 'ret' : 'pickup';
    const free = freeConcierges(S, o).filter((x) => x.id !== k.id)[0] || fail('Нет свободных консьержей');
    k.fines.push({ id: 'f' + ctx.now, order: o.id, sum: CONCIERGE_FEE * 0.5, date: 'сегодня', removed: false });
    S.ledger.unshift({ id: 'l' + ctx.now, k: k.id, ts: ctx.now, text: `опоздание ${k.lateMin || 21} мин, штраф 50% · №${o.id}`, sum: -CONCIERGE_FEE * 0.5 });
    k.lateMin = 0; o.late = null;
    o[leg].conciergeId = free.id; o[leg].step = Math.min(o[leg].step, 1); o[leg].ts = ctx.now; o[leg].progress = 0;
    o.bot.paused = false; botAt(o, ctx, BOT.step);
    log(o, ctx, `Диспетчер передал заказ: ${free.name} вместо ${k.name}`);
    notify(S, ctx, toK(k.id), { title: 'Заказ передан другому консьержу', text: `№${o.id} · штраф за опоздание ${CONCIERGE_FEE * 0.5} Br`, link: { view: 'money' } });
    if (!free.bot) notify(S, ctx, toK(free.id), { title: 'Диспетчер назначил вам заказ', text: `№${o.id} · ${o.car}`, link: { view: 'trip' }, sound: true });
    notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'concierge', title: 'Консьерж заменён', text: `К вам едет ${free.name} · ${free.car} · ${free.rating} ★`, link: { view: 'status' } });
    ctx.result = { to: free.name };
  },
  'trip.step'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    const leg = p.leg === 'ret' ? 'ret' : 'pickup';
    const L = o[leg] || fail('Нет поездки');
    if (L.conciergeId !== a.id && a.role !== 'system') fail('Это не ваш заказ');
    const k = S.concierges[L.conciergeId];
    if (leg === 'pickup') {
      if (![0, 1, 2, 4].includes(L.step)) fail('Сейчас нужно заполнить акт');
      L.step = L.step === 2 ? 3 : L.step + 1;
    } else {
      if (L.step === 2) fail('Дождитесь, пока СТО подпишет акт №3');
      if (![0, 1, 3].includes(L.step)) fail('Сейчас нужно заполнить акт');
      L.step += 1;
    }
    L.ts = ctx.now; L.progress = 0;
    const steps = leg === 'pickup' ? PICKUP_STEPS : RETURN_STEPS;
    log(o, ctx, `${k.name}: ${steps[L.step]}`);
    if (leg === 'pickup' && L.step === 1) { o.late = null; k.lateMin = 0; notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'concierge', title: `${k.name} выехал к вам`, text: `${k.car} · ${k.rating} ★. Следите на карте.`, link: { view: 'status' } }); }
    if (leg === 'pickup' && L.step === 2) notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'concierge', title: 'Автоконсьерж прибыл', text: `${k.name} у подъезда: ${o.address}. ${k.car}.`, link: { view: 'status' }, sound: true });
    if (leg === 'pickup' && L.step === 5) notify(S, ctx, toSto(o.stoId), { ico: 'concierge', title: 'Консьерж приехал', text: `${k.name} · ${o.car} · заявка №${o.id}. Ждёт приёмку.`, link: { view: 'job', orderId: o.id }, sound: true });
    if (leg === 'ret' && L.step === 2) { notify(S, ctx, toSto(o.stoId), { ico: 'concierge', title: 'Консьерж приехал за машиной', text: `${k.name} · заявка №${o.id}. Заполните акт выдачи №3.`, link: { view: 'job', orderId: o.id }, sound: true }); botAt(o, ctx, BOT.step); }
    if (leg === 'ret' && L.step === 4) notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'concierge', title: `${k.name} привёз машину`, text: 'Встречайте у подъезда, он заполнит акт возврата.', link: { view: 'status' }, sound: true });
    botAt(o, ctx, BOT.step);
  },
  'fine.dispute'(S, a, p, ctx) {
    const k = S.concierges[a.id];
    notify(S, ctx, toDisp, { ico: 'late', title: `${k.name} оспаривает штраф`, text: p.reason || 'Просит пересмотреть штраф за опоздание', link: { view: 'concierges' } });
  },

  // ======================== SOS / ЭВАКУАТОР ========================
  'sos.create'(S, a, p, ctx) {
    const id = 'S-' + (S.nextSos++);
    let s;
    if (a.role === 'concierge') {
      const k = S.concierges[a.id]; const o = p.orderId ? S.orders[p.orderId] : null;
      s = { id, clientId: o ? o.clientId : null, conciergeId: k.id, client: `Консьерж ${k.name}`, phone: 'через приложение', car: o ? `${o.car} · ${o.plate || ''}` : k.car,
        scenario: p.scenario || 'Происшествие', place: p.place || (o ? `заказ №${o.id}` : 'геопозиция консьержа'), plan: 'консьерж', ts: ctx.now, step: 0, log: [], source: 'concierge', orderId: o ? o.id : null };
      if (o) { log(o, ctx, `Происшествие: ${s.scenario}`); if (o.stoId) notify(S, ctx, toSto(o.stoId), { ico: 'concierge', title: 'Происшествие с консьержем', text: `${s.scenario} · заказ №${o.id}. Диспетчер на связи.` }); }
    } else {
      const c = S.clients[a.id] || fail('Нет клиентки');
      const car = c.cars[0] || { make: '—', plate: '' };
      s = { id, clientId: c.id, client: c.name, phone: c.phone, car: `${car.make} · ${car.plate}`, scenario: p.scenario || 'Не указана', kind: p.kind || 'sos',
        place: (p.place || c.address) + ' · точность 15 м', plan: { basic: 'Базовый', advanced: 'Продвинутый', max: 'Максимальный' }[c.plan] || 'Продвинутый', ts: ctx.now, step: 0, log: [], source: 'client', to: p.to || null };
    }
    S.sos.unshift(s);
    notify(S, ctx, toDisp, { ico: 'sos', title: `${s.kind === 'tow' ? 'Эвакуатор' : 'SOS'} · ${s.scenario} · ${s.client}`, text: `${s.car} · ${s.place}`, link: { view: 'sos' }, sound: true, urgent: true });
    ctx.result = { id };
  },
  'sos.cancel'(S, a, p, ctx) {
    const s = S.sos.find((x) => x.id === p.id) || fail('Вызов не найден');
    if (s.step >= 4) return;
    s.step = 4; s.cancelled = true; s.log.push({ ts: ctx.now, x: 'Клиентка отменила вызов' });
    notify(S, ctx, toDisp, { ico: 'ok', title: `Вызов ${s.id} отменён клиенткой`, text: s.scenario, link: { view: 'sos' } });
  },
  'sos.step'(S, a, p, ctx) {
    const s = S.sos.find((x) => x.id === p.id) || fail('Вызов не найден');
    const step = +p.step;
    if (step !== s.step + 1 && !(step === 2 && s.step === 1)) fail('Неверный шаг');
    if (step === 1) s.reaction = Math.round((ctx.now - s.ts) / 1000);
    s.step = step;
    const txt = { 1: `Вызов принят диспетчером${s.reaction ? ` за ${s.reaction} сек` : ''}`, 2: `Вызван партнёр: ${p.what || 'техпомощь'}, прибытие ~25 мин`, 3: 'Помощь на месте', 4: 'Вызов закрыт, запись в истории' }[step];
    s.log.push({ ts: ctx.now, x: txt });
    if (s.clientId && s.source === 'client') notify(S, ctx, { role: 'client', id: s.clientId }, { cat: 'concierge', ico: s.kind === 'tow' ? 'tow' : 'sos', title: { 1: 'Диспетчер принял вызов', 2: 'Помощь выехала', 3: 'Помощь на месте', 4: 'Вызов закрыт' }[step], text: txt, link: { view: 'service', key: s.kind === 'tow' ? 'tow' : 'sos' } });
    if (s.conciergeId) notify(S, ctx, toK(s.conciergeId), { title: 'Диспетчер: ' + txt, text: s.scenario });
    ctx.result = { text: txt };
  },

  // ======================== СПОРЫ ========================
  'dispute.open'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    if (o.disputeId && S.disputes[o.disputeId] && S.disputes[o.disputeId].status !== 'closed') fail('По заказу уже открыт спор');
    const id = 'Д-0' + (S.nextDispute++);
    const n = +p.n || null;
    if (n && o.acts[n]) o.acts[n].status = 'disputed';
    const isAct = !!n;
    const sum = o.estimate.total || o.price || 0;
    const who = a.role === 'client' ? cName(S, o) : a.role === 'sto' ? stoName(S, a.id) : 'Диспетчер';
    const d = { id, order: o.id, type: p.type || (isAct ? (n === 2 ? 'Расхождение при приёмке в СТО' : 'Повреждение при перегоне') : 'Претензия по заказу'),
      source: isAct ? `Акт №${n} · «${a.role === 'sto' ? 'Есть расхождение' : 'Есть претензия'}»` : 'Карточка заказа', claim: `${p.item ? p.item + ': ' : ''}${p.text || 'Без описания'}`,
      orderSum: sum, amount: p.amount != null ? +p.amount : sum, ts: ctx.now, takenTs: null, status: 'open', facts: isAct ? 'acts' : 'estimate', actN: n, openedBy: a.role,
      log: [{ ts: ctx.now, x: `${who} открыл(а) спор${isAct ? ' из акта №' + n : ''}` }, { ts: ctx.now, x: `Оплата ${sum} Br приостановлена` }],
      chat: p.text ? [{ w: who, ts: ctx.now, x: p.text }] : [] };
    S.disputes[id] = d; o.disputeId = id; o.frozen = true;
    log(o, ctx, `Открыт спор ${id}`);
    notify(S, ctx, toDisp, { ico: 'dispute', title: `Спор ${id} · ${d.type}`, text: `${cName(S, o)} · заказ №${o.id} · ${d.claim}`, link: { view: 'dispute', id }, sound: true });
    if (a.role !== 'client') notify(S, ctx, toClient(o), { cat: 'order', ico: 'alert', title: 'Открыт спор по заказу', text: `${who}: ${d.claim}. Диспетчер разбирается.`, link: { view: 'status' } });
    if (a.role !== 'sto' && o.stoId) notify(S, ctx, toSto(o.stoId), { ico: 'order', title: `Спор ${id} по заявке №${o.id}`, text: d.claim, link: { view: 'job', orderId: o.id } });
    ctx.result = { id };
  },
  'dispute.take'(S, a, p, ctx) {
    const d = S.disputes[p.id] || fail('Спор не найден');
    d.takenTs = ctx.now; d.status = 'open';
    d.log.push({ ts: ctx.now, x: `Диспетчер ${p.by || 'Ольга К.'} взяла спор в работу (через ${Math.round((ctx.now - d.ts) / 60000)} мин)` });
    const o = S.orders[d.order];
    if (o && S.clients[o.clientId]) notify(S, ctx, toClient(o), { cat: 'order', ico: 'alert', title: `Спор ${d.id} в работе`, text: 'Диспетчер рассматривает претензию. Решение — до 3 суток.', link: { view: 'status' } });
  },
  'dispute.request'(S, a, p, ctx) {
    const d = S.disputes[p.id] || fail('Спор не найден');
    d.status = 'waiting'; d.waitingFor = p.who;
    d.log.push({ ts: ctx.now, x: `Запрошено: ${p.what} у ${p.who}` });
    const o = S.orders[d.order];
    if (o) {
      if (/клиент/.test(p.who) && S.clients[o.clientId]) notify(S, ctx, toClient(o), { cat: 'chat', ico: 'chat', title: 'Диспетчер просит фото и пояснение', text: `Спор ${d.id}. Ответьте в чате заказа.`, link: { view: 'chat', orderId: o.id } });
      if (/СТО/.test(p.who) && o.stoId) notify(S, ctx, toSto(o.stoId), { ico: 'chat', title: 'Диспетчер просит объяснение', text: `Спор ${d.id} по заявке №${o.id}`, link: { view: 'job', orderId: o.id } });
      const kid = (o.ret && o.ret.conciergeId) || (o.pickup && o.pickup.conciergeId);
      if (/консьерж/.test(p.who) && kid) notify(S, ctx, toK(kid), { title: 'Диспетчер просит объяснение', text: `Спор ${d.id} по заказу №${o.id}` });
    }
  },
  'dispute.chat'(S, a, p, ctx) {
    const d = S.disputes[p.id] || fail('Спор не найден');
    const x = String(p.text || '').trim(); if (!x) fail('Пустое сообщение');
    d.chat.push({ w: 'Диспетчер', ts: ctx.now, x });
    const o = S.orders[d.order];
    if (o) { chatPush(S, o, ctx, 'dispatcher', 'Диспетчер', x); if (S.clients[o.clientId]) notify(S, ctx, toClient(o), { cat: 'chat', ico: 'chat', title: 'Сообщение диспетчера', text: '«' + x.slice(0, 80) + '»', link: { view: 'chat', orderId: o.id } }); }
  },
  'dispute.propose'(S, a, p, ctx) {
    const d = S.disputes[p.id] || fail('Спор не найден');
    const k = p.decision; const amount = +p.amount || 0;
    if (!p.reason) fail('Добавьте обоснование решения');
    const DEC = DECISIONS;
    if (k === 'partial' || k === 'full') {
      d.status = 'approval'; d.proposal = { decision: k, amount, reason: p.reason, by: p.by || 'Ольга К.' };
      d.log.push({ ts: ctx.now, x: `Предложен ${DEC[k].toLowerCase()} ${amount} Br → директору на утверждение` });
      notify(S, ctx, toDir, { ico: 'ok', title: `Возврат на утверждение: ${d.id}`, text: `${DEC[k]} ${amount} Br`, link: { view: 'approvals' }, sound: true });
    } else {
      closeDispute(S, d, ctx, k === 'insurance' ? `Страховой случай: ущерб от консьержа ${d.concierge || ''} передан в страховую. СТО получает полную выплату. ${p.reason}` : `${DEC[k]}. ${p.reason}`, 0);
    }
  },
  'dispute.approve'(S, a, p, ctx) {
    const d = S.disputes[p.id] || fail('Спор не найден');
    if (d.status !== 'approval') fail('Нет предложения на утверждение');
    closeDispute(S, d, ctx, `${DECISIONS[d.proposal.decision]} ${d.proposal.amount} Br утверждён директором. Удержан из выплаты СТО «${d.sto || ''}». ${d.proposal.reason}${p.comment ? ' Комментарий директора: ' + p.comment : ''}`, d.proposal.amount);
  },
  'dispute.reject'(S, a, p, ctx) {
    const d = S.disputes[p.id] || fail('Спор не найден');
    if (!p.comment) fail('Напишите, что нужно доработать');
    d.status = 'open'; d.log.push({ ts: ctx.now, x: `Директор вернул на доработку: ${p.comment}` }); delete d.proposal;
    notify(S, ctx, toDisp, { ico: 'dispute', title: `Директор вернул спор ${d.id}`, text: p.comment, link: { view: 'dispute', id: d.id } });
  },
  'fine.remove'(S, a, p, ctx) {
    const k = S.concierges[p.conciergeId] || fail('Нет консьержа');
    const f = k.fines.find((x) => !x.removed) || fail('Нет штрафов');
    f.removed = true; f.reason = p.reason || 'Другое';
    S.ledger.unshift({ id: 'l' + ctx.now, k: k.id, ts: ctx.now, text: `штраф снят диспетчером (${f.reason})`, sum: f.sum });
    notify(S, ctx, toK(k.id), { title: 'Штраф снят диспетчером', text: `${f.sum} Br · ${f.reason}`, link: { view: 'money' } });
  },
  'order.nudge'(S, a, p, ctx) {
    const o = getOrder(S, p.orderId);
    o.bot.paused = false; botAt(o, ctx, 2500);
    chatPush(S, o, ctx, 'dispatcher', 'Диспетчер', p.text || 'Заказ завис — пожалуйста, ответьте, что мешает продолжить.');
    if (S.clients[o.clientId]) notify(S, ctx, toClient(o), { cat: 'chat', ico: 'chat', title: 'Сообщение диспетчера', text: 'Заказ №' + o.id + ': проверьте смету и статус', link: { view: 'status' } });
    if (o.stoId) notify(S, ctx, toSto(o.stoId), { ico: 'chat', title: 'Диспетчер: заказ завис', text: `№${o.id} · ${o.car}`, link: { view: 'job', orderId: o.id } });
  },
  'handover.note'(S, a, p, ctx) { S.handoverNotes[p.key] = String(p.text || ''); },
  'handover.submit'(S, a, p, ctx) { notify(S, ctx, toDisp, { ico: 'ok', title: 'Смена передана', text: `${p.from || 'Ольга К.'} → ${p.to || 'Андрей М.'} · ${p.count || 0} открытых пунктов`, link: { view: 'handover' } }); },
  'notif.read'(S, a, p, ctx) {
    S.notifications.forEach((n) => { if ((p.all || n.id === p.id) && matchTo(n.to, a)) n.read = true; });
  },
  'demo.reset'() { /* обрабатывается сервером */ }
};

export const DECISIONS = { refuse: 'Отказ в претензии', partial: 'Частичный возврат', full: 'Полный возврат', rework: 'Бесплатная доработка на СТО', insurance: 'Страховой случай (ущерб от консьержа)' };

function closeDispute(S, d, ctx, result, refund) {
  d.status = 'closed'; d.result = result; d.closedTs = ctx.now;
  d.log.push({ ts: ctx.now, x: refund ? `Возврат ${refund} Br утверждён. Оплата разблокирована` : 'Спор закрыт. Оплата разблокирована' });
  const o = S.orders[d.order];
  if (o) {
    o.frozen = false; o.refund = refund || 0;
    if (o.acts[d.actN] && o.acts[d.actN].status === 'disputed') o.acts[d.actN].status = 'accepted';
    if (refund && o.estimate.total) { o.estimate.total = Math.max(0, o.estimate.total - refund); }
    log(o, ctx, `Спор ${d.id} закрыт${refund ? ', возврат ' + refund + ' Br' : ''}`);
    if (S.clients[o.clientId]) notify(S, ctx, toClient(o), { cat: 'payment', ico: 'payment', title: `Решение по спору ${d.id}`, text: refund ? `Возврат ${refund} Br. ${o.paid ? 'Деньги вернутся на карту' : 'Сумма к оплате уменьшена'}.` : result.slice(0, 110), link: { view: 'status' } });
    if (o.stoId) notify(S, ctx, toSto(o.stoId), { ico: 'billing', title: `Спор ${d.id} закрыт`, text: refund ? `Возврат ${refund} Br удержан из выплаты` : 'Оплата разблокирована', link: { view: 'job', orderId: o.id } });
  }
}

function payConcierge(S, o, kid, leg, ctx) {
  S.ledger.unshift({ id: 'l' + ctx.now + leg, k: kid, ts: ctx.now, text: `${o.car.split(',')[0]}, ${leg === 'pickup' ? 'забор' : 'возврат'}`, sum: PAY[leg], orderId: o.id });
  const k = S.concierges[kid]; k.trips++;
}

export function activeConciergeOf(o) {
  if (o.ret && o.ret.conciergeId && o.ret.step < 5) return o.ret.conciergeId;
  if (o.pickup && o.pickup.conciergeId && o.pickup.step < 6) return o.pickup.conciergeId;
  return null;
}
function busy(S, kid) { return Object.values(S.orders).some((o) => activeConciergeOf(o) === kid); }
export function freeConcierges(S, o) {
  const from = o && o.status === 'ready' ? S.stos[o.stoId] : o;
  return Object.values(S.concierges).filter((k) => k.onShift && !busy(S, k.id))
    .map((k) => Object.assign({}, k, { dist: from && from.lat ? km(k, from) : null }))
    .sort((a, b) => (a.dist || 0) - (b.dist || 0));
}

function takeJob(S, orderId, leg, kid, ctx, by) {
  const o = getOrder(S, orderId);
  leg = leg === 'ret' ? 'ret' : 'pickup';
  const L = o[leg] || fail('Заказ не требует консьержа');
  if (L.conciergeId) fail('Заказ уже взял другой консьерж');
  if (leg === 'pickup' && o.status !== 'confirmed') fail('Заказ недоступен');
  if (leg === 'ret' && o.status !== 'ready') fail('Машина ещё не готова');
  const k = S.concierges[kid] || fail('Нет консьержа');
  if (busy(S, kid)) fail('Сначала завершите текущий заказ');
  L.conciergeId = kid; L.step = 0; L.ts = ctx.now; L.progress = 0; L.assignedBy = by;
  log(o, ctx, `${k.name} взял ${leg === 'pickup' ? 'забор' : 'возврат'}${by === 'dispatcher' ? ' (назначил диспетчер)' : ''}`);
  botAt(o, ctx, BOT.step);
  notify(S, ctx, toClient(o), { cat: 'concierge', ico: 'concierge', title: leg === 'pickup' ? 'Автоконсьерж назначен' : 'Консьерж вернёт машину', text: `${k.name} · ${k.car} · ${k.rating} ★ · ${o.slot}`, link: { view: 'status' } });
  if (by === 'dispatcher' && !k.bot) notify(S, ctx, toK(kid), { title: 'Диспетчер назначил вам заказ', text: `№${o.id} · ${leg === 'pickup' ? 'забор' : 'возврат'} · ${o.car}`, link: { view: 'trip' }, sound: true });
  if (o.stoId) notify(S, ctx, toSto(o.stoId), { ico: 'concierge', title: `Консьерж назначен · №${o.id}`, text: `${k.name} · ${leg === 'pickup' ? 'привезёт машину' : 'заберёт машину у вас'}`, link: { view: 'job', orderId: o.id } });
  ctx.result = { orderId: o.id, leg };
}

// ---------------------------------------------------------------- боты (демо)
// Двигают заказы там, где участник — не живой пользователь приложения.
export function tick(S, now = Date.now()) {
  const ctx = { now, out: [], result: null, loc: [], events: [] };
  let changed = false;
  const sys = { role: 'system', id: 'bot' };
  const run = (type, actor, p) => { try { ACTIONS[type](S, actor, p, ctx); changed = true; ctx.events.push({ who: actor, type, p }); return true; } catch (e) { if (!(e instanceof DomainError)) throw e; return false; } };

  // демо-события: новая заявка в ленте СТО и новый SOS
  if (S.demo.spawnRequestAt && now >= S.demo.spawnRequestAt) {
    S.demo.spawnRequestAt = 0;
    const id = String(S.nextOrder++).padStart(4, '0');
    const c = S.clients.c6;
    S.orders[id] = { id, clientId: 'c6', car: 'Mazda 3, 2018', plate: '2211 ОН-7', gear: 'АКПП', symptom: 'Вибрация руля на скорости выше 80 км/ч.', tags: ['Вибрация при движении'],
      slot: 'Сегодня, 16:00–18:00', urgent: false, createdAt: now, updatedAt: now, status: 'published', priceMin: 60, priceMax: 160, offers: [], stoId: null, price: null, stage: 0, stageTs: null,
      diagnosis: '', estimate: { items: [], total: 0, status: 'none' }, pickup: null, ret: null, acts: {}, chat: [], paid: false, rating: null, refund: 0, frozen: false, disputeId: null,
      delivery: 'concierge', comment: '', address: c.address, lng: c.lng, lat: c.lat, bot: { paused: false, next: now + BOT.offer }, log: [{ ts: now, x: 'Заявка опубликована' }] };
    notify(S, ctx, toSto(STO_ME), { cat: 'req', ico: 'req', title: 'Новая заявка · Mazda 3, 2018', text: `Вибрация при движении · р-н ${c.district}, ${km(c, S.stos[STO_ME])} км`, link: { view: 'marketplace', orderId: id }, sound: true });
    changed = true;
  }
  if (S.demo.spawnSosAt && now >= S.demo.spawnSosAt) {
    S.demo.spawnSosAt = 0;
    S.sos.unshift({ id: 'S-' + (S.nextSos++), clientId: null, client: 'Ксения Б.', phone: '+375 33 640-18-02', car: 'Volkswagen Golf, 2016 · 4521 ММ-7', scenario: 'ДТП', place: 'пр-т Дзержинского, 104 · точность 9 м', plan: 'Максимальный', ts: now, step: 0, log: [], source: 'client' });
    notify(S, ctx, toDisp, { ico: 'sos', title: 'SOS · ДТП · Ксения Б.', text: 'пр-т Дзержинского, 104', link: { view: 'sos' }, sound: true, urgent: true });
    changed = true;
  }

  for (const o of Object.values(S.orders)) {
    if (['closed', 'cancelled'].includes(o.status)) continue;
    const cl = S.clients[o.clientId] || {};
    // ответ клиентки-бота в чате
    if (o.bot.reply && now >= o.bot.reply) { o.bot.reply = 0; chatPush(S, o, ctx, 'client', cl.name, 'Спасибо, поняла! Держите в курсе.'); changed = true; }

    // поездки ботов-консьержей: двигаем машинку по маршруту
    for (const leg of ['pickup', 'ret']) {
      const L = o[leg]; if (!L || !L.conciergeId) continue;
      const k = S.concierges[L.conciergeId]; if (!k || !k.bot || o.bot.paused) continue;
      const driving = leg === 'pickup' ? (L.step === 1 || L.step === 4) : (L.step === 1 || L.step === 3);
      if (driving && L.progress < 1) {
        L.progress = Math.min(1, L.progress + 1000 / BOT.drive);
        ctx.loc.push({ orderId: o.id, leg, step: L.step, progress: L.progress, conciergeId: k.id });
      }
    }

    if (o.bot.paused || !o.bot.next || now < o.bot.next) continue;
    o.bot.next = 0;
    const sto = S.stos[o.stoId];

    if (o.status === 'published') {
      // СТО-боты отвечают на заявки живой клиентки
      if (!cl.bot) {
        const bots = Object.values(S.stos).filter((s) => s.bot && !o.offers.some((x) => x.stoId === s.id));
        if (bots.length) {
          const s = bots[0];
          const [mn, mx] = o.priceMin ? [o.priceMin, o.priceMax] : priceRange(o.tags);
          const price = R((mn + (mx - mn) * s.f) / 5) * 5;
          const w = TAG_WORK[o.tags[0]] || ['Запчасти и материалы', 'Диагностика и работа'];
          const parts = R(price * 0.62);
          const notes = { sto2: 'Готовы принять сегодня в 20:00', sto3: 'Готовы принять завтра утром', sto4: 'Готовы принять завтра днём' };
          run('offer.send', { role: 'sto', id: s.id }, { orderId: o.id, price, items: [{ name: `${w[0]} (${s.brand})`, price: parts }, { name: w[1], price: price - parts }], note: notes[s.id] || '' });
          o.bot.next = now + BOT.offer;
        }
      } else {
        // клиентка-бот выбирает предложение живой СТО
        const mine = o.offers.find((x) => !S.stos[x.stoId].bot) || o.offers[0];
        if (mine) run('order.confirm', { role: 'system', id: 'bot' }, { orderId: o.id, offerId: mine.id, delivery: 'concierge' });
      }
      continue;
    }

    // консьерж-бот: шаги поездки и акты
    for (const leg of ['pickup', 'ret']) {
      const L = o[leg]; if (!L || !L.conciergeId) continue;
      const k = S.concierges[L.conciergeId]; if (!k.bot) continue;
      const kA = { role: 'concierge', id: k.id };
      if (leg === 'pickup' && L.step < 6) {
        if ((L.step === 1 || L.step === 4) && L.progress < 1) { o.bot.next = now + 1000; break; }
        if (L.step === 3) run('act.create', kA, { orderId: o.id, n: 1, photos: 12, fuel: '1/2' });
        else if (L.step === 5) run('act.create', kA, { orderId: o.id, n: 2, photos: 12 });
        else run('trip.step', kA, { orderId: o.id, leg });
        o.bot.next = now + BOT.step; break;
      }
      if (leg === 'ret' && L.step < 5) {
        if ((L.step === 1 || L.step === 3) && L.progress < 1) { o.bot.next = now + 1000; break; }
        if (L.step === 2) { if (sto.bot) run('act.create', sys, { orderId: o.id, n: 3, photos: 12 }); }
        else if (L.step === 4) run('act.create', kA, { orderId: o.id, n: 4, photos: 12 });
        else run('trip.step', kA, { orderId: o.id, leg });
        o.bot.next = now + BOT.step; break;
      }
    }

    // клиентка-бот: подтверждает акты, смету и платит
    if (cl.bot) {
      if (o.acts[1] && o.acts[1].status === 'pending') run('act.accept', sys, { orderId: o.id, n: 1 });
      if (o.estimate.status === 'sent') run('estimate.approve', sys, { orderId: o.id });
      if (o.status === 'returned' && !o.frozen) { run('order.pay', sys, { orderId: o.id }); run('order.rate', sys, { orderId: o.id, stars: 5, comment: 'Всё быстро, спасибо!' }); }
    }

    // СТО-бот: приёмка, стадии, смета, выдача
    if (sto && sto.bot) {
      if (o.status === 'confirmed' && o.delivery === 'self') run('sto.intakeSelf', { role: 'sto', id: sto.id }, { orderId: o.id });
      else if (o.status === 'at_sto') {
        if (o.acts[2] && o.acts[2].status === 'pending') run('act.accept', sys, { orderId: o.id, n: 2 });
        else if (o.stage === 0 || o.stage === 1) run('sto.stage', { role: 'sto', id: sto.id }, { orderId: o.id, to: o.stage + 1, diagnosis: o.stage === 1 ? `Проверили: ${o.symptom.toLowerCase()} Нужна замена, смета ниже.` : undefined });
        else if (o.stage === 2 && o.estimate.status !== 'sent' && o.estimate.status !== 'approved') {
          const items = o.estimate.items.length ? o.estimate.items : [{ name: 'Работа', price: o.price || 100 }];
          run('estimate.send', { role: 'sto', id: sto.id }, { orderId: o.id, items: items.concat([{ name: 'Диагностика', price: 0 }]) });
        } else if (o.stage === 3) run('sto.stage', { role: 'sto', id: sto.id }, { orderId: o.id, to: 4 });
      } else if (o.status === 'ready' && o.delivery === 'self' && cl.bot) run('sto.selfHandover', { role: 'sto', id: sto.id }, { orderId: o.id });
    }
    if (!o.bot.next && (o.status !== 'closed')) o.bot.next = now + BOT.step;
  }
  if (changed) S.seq++;
  return { changed, ctx };
}

// ---------------------------------------------------------------- представления
export function matchTo(to, who) {
  if (!to) return false;
  if (to.role === 'dispatcher') return who.role === 'dispatcher' || who.role === 'director';
  if (to.role === 'director') return who.role === 'director' || who.role === 'dispatcher';
  return to.role === who.role && (!to.id || to.id === who.id);
}

const maskClient = (o) => { o.client = null; o.phone = null; o.address = null; o.lng = o.lat = null; o.chat = []; return o; };

export function viewFor(S, who) {
  const V = {
    seq: S.seq, now: Date.now(), resetAt: S.resetAt, me: who,
    consts: { CONCIERGE_FEE, COMMISSION, PAY, PICKUP_STEPS, RETURN_STEPS, STO_STAGES, KIT, DECISIONS },
    stos: S.stos, concierges: {}, notifications: S.notifications.filter((n) => matchTo(n.to, who)).slice(0, 80)
  };
  for (const k of Object.values(S.concierges)) {
    V.concierges[k.id] = Object.assign({}, k, { busyWith: null });
  }
  for (const o of Object.values(S.orders)) { const kid = activeConciergeOf(o); if (kid && V.concierges[kid]) V.concierges[kid].busyWith = o.id; }

  const enrich = (o) => {
    const x = clone(o);
    const cl = S.clients[o.clientId] || {};
    x.client = cl.name; x.clientShort = cl.short; x.phone = cl.phone; x.district = cl.district;
    x.address = o.address || cl.address; x.lng = o.lng || cl.lng; x.lat = o.lat || cl.lat;
    x.stoName = o.stoId ? S.stos[o.stoId].name : null;
    x.priceMin = o.priceMin || priceRange(o.tags)[0]; x.priceMax = o.priceMax || priceRange(o.tags)[1];
    delete x.bot;
    return x;
  };

  if (who.role === 'client') {
    const c = S.clients[who.id];
    V.client = c;
    V.orders = Object.values(S.orders).filter((o) => o.clientId === who.id).map(enrich);
    V.sos = S.sos.filter((s) => s.clientId === who.id && s.source === 'client');
    V.disputes = Object.values(S.disputes).filter((d) => S.orders[d.order] && S.orders[d.order].clientId === who.id);
  } else if (who.role === 'sto') {
    V.sto = S.stos[who.id];
    V.orders = Object.values(S.orders).filter((o) => o.status === 'published' || o.stoId === who.id).map((o) => {
      const x = enrich(o);
      const mine = o.stoId === who.id && o.status !== 'published';
      x.distance = km(S.stos[who.id], { lng: x.lng, lat: x.lat });
      x.myOffer = o.offers.find((f) => f.stoId === who.id) || null;
      x.offersCount = o.offers.length;
      x.offers = x.myOffer ? [x.myOffer] : [];
      if (!mine) maskClient(x);
      return x;
    });
    V.disputes = Object.values(S.disputes).filter((d) => S.orders[d.order] && S.orders[d.order].stoId === who.id);
  } else if (who.role === 'concierge') {
    V.concierge = S.concierges[who.id];
    V.orders = Object.values(S.orders).filter((o) => o.delivery === 'concierge' && ((o.pickup && (!o.pickup.conciergeId ? o.status === 'confirmed' : o.pickup.conciergeId === who.id)) || (o.ret && (!o.ret.conciergeId ? o.status === 'ready' : o.ret.conciergeId === who.id)))).map((o) => {
      const x = enrich(o);
      const mine = (o.pickup && o.pickup.conciergeId === who.id) || (o.ret && o.ret.conciergeId === who.id);
      x.sto = S.stos[o.stoId];
      x.offers = [];
      if (!mine) { x.addressHidden = true; x.address = null; x.phone = null; x.chat = []; }
      return x;
    });
    V.ledger = S.ledger.filter((l) => l.k === who.id);
  } else { // dispatcher / director — видят всё
    V.clients = S.clients;
    V.orders = Object.values(S.orders).map(enrich);
    V.disputes = Object.values(S.disputes).map((d) => {
      const o = S.orders[d.order];
      const x = clone(d);
      if (o) { x.client = x.client || cName(S, o); x.car = x.car || o.car; x.sto = x.sto || stoName(S, o.stoId); x.concierge = x.concierge || kName(S, (o.ret && o.ret.conciergeId) || (o.pickup && o.pickup.conciergeId)); x.acts = o.acts; x.estimate = o.estimate.items.map((i) => [i.name, i.price]); }
      return x;
    });
    V.sos = S.sos;
    V.free = {};
    for (const o of Object.values(S.orders)) {
      const leg = o.status === 'confirmed' && o.pickup && !o.pickup.conciergeId ? 'pickup' : o.status === 'ready' && o.ret && !o.ret.conciergeId ? 'ret' : null;
      if (leg) V.free[o.id] = freeConcierges(S, o).map((k) => ({ id: k.id, name: k.name, car: k.car, rating: k.rating, dist: k.dist }));
    }
    V.handoverNotes = S.handoverNotes;
    V.ledger = S.ledger;
  }
  return V;
}
