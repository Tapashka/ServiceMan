import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/seed.js';
import { apply, viewFor, ensureProfile, DomainError } from '../src/domain.js';

// Участники тестов — это «зарегистрированные пользователи»: профиль создаётся так же, как при первом входе.
const C = { role: 'client', id: 'u-client' }, STO = { role: 'sto', id: 'u-sto' }, STO2 = { role: 'sto', id: 'u-sto2' };
const K = { role: 'concierge', id: 'u-k' }, K2 = { role: 'concierge', id: 'u-k2' };
const D = { role: 'dispatcher', id: 'u-d' }, DIR = { role: 'director', id: 'u-dir' };
const run = (S, who, type, p, now) => apply(S, who, type, p, now);
function world(now) {
  const S = seed(now);
  ensureProfile(S, C, { name: 'Клиентка Тест', phone: '+375 29 000-00-01', address: 'ул. Тестовая, 1' }, now);
  ensureProfile(S, STO, { name: 'Мастер', stoName: 'СТО Тест', address: 'ул. Сервисная, 2' }, now);
  ensureProfile(S, STO2, { name: 'Мастер 2', stoName: 'СТО Два' }, now);
  ensureProfile(S, K, { name: 'Консьерж Тест', car: 'Lada' }, now);
  ensureProfile(S, K2, { name: 'Второй Консьерж' }, now);
  ensureProfile(S, D, { name: 'Диспетчер Тест' }, now);
  ensureProfile(S, DIR, { name: 'Директор Тест' }, now);
  return S;
}

test('стартовое состояние пустое: никаких выдуманных клиенток, СТО, заказов', () => {
  const S = seed();
  for (const k of ['clients', 'stos', 'concierges', 'orders', 'disputes']) assert.equal(Object.keys(S[k]).length, 0, k);
  assert.equal(S.sos.length, 0); assert.equal(S.notifications.length, 0); assert.equal(S.ledger.length, 0);
});

test('профиль создаётся один раз и берёт данные из регистрации', () => {
  const S = seed();
  assert.equal(ensureProfile(S, C, { name: 'Анна Петрова', phone: '+375' }), true);
  assert.equal(ensureProfile(S, C, { name: 'Другое имя' }), false);
  assert.equal(S.clients[C.id].name, 'Анна Петрова'); assert.equal(S.clients[C.id].cars.length, 0);
  ensureProfile(S, STO, { name: 'Иван', stoName: 'Гараж №1' });
  assert.equal(S.stos[STO.id].name, 'Гараж №1'); assert.equal(S.stos[STO.id].rating, null);
});

test('права: роль и владение заказом проверяются на сервере', () => {
  const now = Date.now();
  const S = world(now);
  const other = { role: 'client', id: 'u-other' }; ensureProfile(S, other, { name: 'Чужая' }, now);
  const { result: { orderId: id } } = run(S, C, 'order.create', { tags: ['Плановое ТО'] }, now);
  assert.throws(() => run(S, other, 'order.cancel', { orderId: id }, now), /Чужой заказ/);
  assert.throws(() => run(S, C, 'offer.send', { orderId: id, price: 10 }, now), /недоступно для вашей роли/);
  assert.throws(() => run(S, STO, 'sto.stage', { orderId: id, to: 1 }, now), /Чужой заказ/);
  assert.throws(() => run(S, D, 'dispute.approve', { id: 'x' }, now), /недоступно/);
  assert.throws(() => run(S, { role: 'client', id: 'nobody' }, 'order.create', { tags: ['Плановое ТО'] }, now), /Профиль/);
  // СТО не видит контакты клиентки, пока та её не выбрала
  const sv = viewFor(S, STO).orders.find((x) => x.id === id);
  assert.equal(sv.phone, null); assert.equal(sv.address, null);
});

test('полный цикл: заявка → предложения → консьерж → ремонт → возврат → оплата', () => {
  const now = Date.now();
  const S = world(now);
  run(S, C, 'car.add', { make: 'Kia Rio, 2019', plate: '0000 АА-7' }, now);

  const { result: { orderId: id } } = run(S, C, 'order.create', { tags: ['Стук или скрип'], text: 'Стучит спереди при повороте' }, now);
  const o = S.orders[id];
  assert.equal(o.status, 'published');
  // СТО видит заявку без контактов клиентки
  const sv = viewFor(S, STO).orders.find((x) => x.id === id);
  assert.equal(sv.phone, null); assert.equal(sv.address, null);

  run(S, STO, 'offer.send', { orderId: id, price: 120, note: 'Готовы сегодня' }, now);
  run(S, STO2, 'offer.send', { orderId: id, price: 150 }, now);
  assert.equal(o.offers.length, 2);
  assert.equal(o.car, 'Kia Rio, 2019');

  const mine = o.offers.find((x) => x.stoId === STO.id);
  run(S, C, 'order.confirm', { orderId: id, offerId: mine.id, delivery: 'concierge', slot: 'Сегодня, 18:00–20:00' }, now);
  assert.equal(o.status, 'confirmed'); assert.equal(o.stoId, STO.id);
  // теперь СТО видит контакты
  assert.ok(viewFor(S, STO).orders.find((x) => x.id === id).phone);

  // консьерж выходит на смену и берёт забор
  run(S, K, 'concierge.shift', { on: true }, now);
  assert.ok(viewFor(S, K).orders.some((x) => x.id === id && x.addressHidden));
  run(S, K, 'job.take', { orderId: id, leg: 'pickup' }, now);
  assert.throws(() => run(S, K2, 'job.take', { orderId: id, leg: 'pickup' }, now), DomainError);
  run(S, K, 'trip.step', { orderId: id, leg: 'pickup' }, now);   // выехал
  run(S, K, 'trip.step', { orderId: id, leg: 'pickup' }, now);   // на месте
  run(S, K, 'trip.step', { orderId: id, leg: 'pickup' }, now);   // начал акт
  assert.throws(() => run(S, K, 'act.create', { orderId: id, n: 1, photos: 5 }, now), DomainError);
  run(S, K, 'act.create', { orderId: id, n: 1, photos: 12, mileage: '84 200', fuel: '1/2' }, now);
  assert.equal(o.acts[1].status, 'pending');
  run(S, C, 'act.accept', { orderId: id, n: 1 }, now);
  run(S, K, 'trip.step', { orderId: id, leg: 'pickup' }, now);   // приехал в СТО
  run(S, K, 'act.create', { orderId: id, n: 2, photos: 12 }, now);
  assert.equal(o.status, 'at_sto');

  // СТО: приёмка → диагностика → смета
  assert.throws(() => run(S, STO, 'sto.stage', { orderId: id, to: 1 }, now), DomainError);
  run(S, STO, 'act.accept', { orderId: id, n: 2 }, now);
  run(S, STO, 'sto.stage', { orderId: id, to: 1 }, now);
  run(S, STO, 'sto.stage', { orderId: id, to: 2, diagnosis: 'Износ колодок 80%' }, now);
  run(S, STO, 'estimate.send', { orderId: id, items: [{ name: 'Колодки TRW', price: 90 }, { name: 'Работа', price: 45 }] }, now);
  assert.throws(() => run(S, STO, 'sto.stage', { orderId: id, to: 3 }, now), DomainError);
  run(S, C, 'estimate.approve', { orderId: id }, now);
  assert.equal(o.stage, 3);
  run(S, STO, 'sto.stage', { orderId: id, to: 4 }, now);
  assert.equal(o.status, 'ready');

  // возврат
  run(S, K, 'job.take', { orderId: id, leg: 'ret' }, now);
  run(S, K, 'trip.step', { orderId: id, leg: 'ret' }, now);      // еду в СТО
  run(S, K, 'trip.step', { orderId: id, leg: 'ret' }, now);      // в СТО
  assert.throws(() => run(S, K, 'trip.step', { orderId: id, leg: 'ret' }, now), DomainError);
  run(S, STO, 'act.create', { orderId: id, n: 3, photos: 12, mileage: '84215' }, now);
  run(S, K, 'trip.step', { orderId: id, leg: 'ret' }, now);      // у клиентки
  assert.throws(() => run(S, C, 'order.pay', { orderId: id }, now), DomainError);
  run(S, K, 'act.create', { orderId: id, n: 4, photos: 12, mileage: '84231' }, now);
  assert.equal(o.status, 'returned');
  const r = run(S, C, 'order.pay', { orderId: id }, now);
  assert.equal(r.result.amount, 135);
  assert.equal(o.status, 'closed');
  run(S, C, 'order.rate', { orderId: id, stars: 5 }, now);

  // уведомления разошлись всем сторонам
  assert.ok(viewFor(S, C).notifications.some((n) => n.title.includes('Смета')));
  assert.ok(viewFor(S, STO).notifications.some((n) => n.title.includes('оплачен')));
  assert.ok(viewFor(S, K).ledger.filter((l) => l.orderId === id).length === 2);
});

test('спор из акта → директор утверждает возврат → оплата разморожена и уменьшена', () => {
  const now = Date.now();
  const S = world(now);
  const { result: { orderId: id } } = run(S, C, 'order.create', { tags: ['Стук или скрип'] }, now);
  const o = S.orders[id];
  const off = run(S, STO, 'offer.send', { orderId: id, price: 135 }, now).result;
  run(S, C, 'order.confirm', { orderId: id, offerId: off.id, delivery: 'self' }, now);
  run(S, STO, 'sto.intakeSelf', { orderId: id }, now);
  run(S, STO, 'sto.stage', { orderId: id, to: 1 }, now);
  run(S, STO, 'sto.stage', { orderId: id, to: 2 }, now);
  run(S, STO, 'estimate.send', { orderId: id, items: [{ name: 'Колодки', price: 90 }, { name: 'Работа', price: 45 }] }, now);
  run(S, C, 'estimate.approve', { orderId: id }, now);
  run(S, C, 'dispute.open', { orderId: id, text: 'Не согласна с суммой' }, now);
  const d = S.disputes[o.disputeId];
  assert.ok(o.frozen);
  run(S, D, 'dispute.take', { id: d.id }, now);
  assert.match(d.log.at(-1).x, /Диспетчер Тест/);
  run(S, D, 'dispute.propose', { id: d.id, decision: 'partial', amount: 40, reason: 'Позиция не согласована' }, now);
  assert.equal(d.status, 'approval'); assert.equal(d.proposal.by, 'Диспетчер Тест');
  run(S, DIR, 'dispute.approve', { id: d.id }, now);
  assert.equal(d.status, 'closed'); assert.equal(o.frozen, false); assert.equal(o.estimate.total, 95);
});
