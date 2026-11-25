import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/seed.js';
import { apply, tick, viewFor, DomainError } from '../src/domain.js';

const C = { role: 'client', id: 'c1' }, STO = { role: 'sto', id: 'sto1' }, K = { role: 'concierge', id: 'k1' }, D = { role: 'dispatcher', id: 'd1' };
const run = (S, who, type, p, now) => apply(S, who, type, p, now);
function advance(S, ms, from) { let t = from; for (let i = 0; i < ms / 1000; i++) { t += 1000; tick(S, t); } return t; }

test('полный цикл: заявка → предложения → консьерж → ремонт → возврат → оплата', () => {
  let now = Date.now();
  const S = seed(now);
  S.demo.spawnRequestAt = 0; S.demo.spawnSosAt = 0;

  const { result: { orderId: id } } = run(S, C, 'order.create', { tags: ['Стук или скрип'], text: 'Стучит спереди при повороте' }, now);
  const o = S.orders[id];
  assert.equal(o.status, 'published');
  // СТО видит заявку без контактов клиентки
  const sv = viewFor(S, STO).orders.find((x) => x.id === id);
  assert.equal(sv.phone, null); assert.equal(sv.address, null);

  run(S, STO, 'offer.send', { orderId: id, price: 120, note: 'Готовы сегодня' }, now);
  now = advance(S, 15000, now);                       // боты-СТО присылают свои цены
  assert.ok(o.offers.length >= 3, 'ожидаем предложения от ботов-СТО');

  const mine = o.offers.find((x) => x.stoId === 'sto1');
  run(S, C, 'order.confirm', { orderId: id, offerId: mine.id, delivery: 'concierge', slot: 'Сегодня, 18:00–20:00' }, now);
  assert.equal(o.status, 'confirmed'); assert.equal(o.stoId, 'sto1');
  // теперь СТО видит контакты
  assert.ok(viewFor(S, STO).orders.find((x) => x.id === id).phone);

  // консьерж Игорь выходит на смену и берёт забор
  run(S, K, 'concierge.shift', { on: true }, now);
  assert.ok(viewFor(S, K).orders.some((x) => x.id === id && x.addressHidden));
  run(S, K, 'job.take', { orderId: id, leg: 'pickup' }, now);
  assert.throws(() => run(S, { role: 'concierge', id: 'k3' }, 'job.take', { orderId: id, leg: 'pickup' }, now), DomainError);
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
  const S = seed(now);
  const o = S.orders['0229'];
  const d = S.disputes['Д-031'];
  run(S, D, 'dispute.take', { id: d.id }, now);
  run(S, D, 'dispute.propose', { id: d.id, decision: 'partial', amount: 40, reason: 'Царапина подтверждена фото' }, now);
  assert.equal(d.status, 'approval');
  run(S, { role: 'director', id: 'r1' }, 'dispute.approve', { id: d.id }, now);
  assert.equal(d.status, 'closed'); assert.equal(o.frozen, false); assert.equal(o.estimate.total, 95);
});

test('боты доводят заказ клиентки до конца, если диспетчер назначил бота-консьержа и выбрана СТО-бот', () => {
  let now = Date.now();
  const S = seed(now);
  S.demo.spawnRequestAt = 0; S.demo.spawnSosAt = 0;
  const { result: { orderId: id } } = run(S, C, 'order.create', { tags: ['Плановое ТО'] }, now);
  now = advance(S, 6000, now);
  const o = S.orders[id];
  const bot = o.offers.find((x) => x.stoId !== 'sto1');
  run(S, C, 'order.confirm', { orderId: id, offerId: bot.id, delivery: 'concierge' }, now);
  run(S, D, 'concierge.assign', { orderId: id, conciergeId: 'k3' }, now);
  for (let i = 0; i < 400 && o.status !== 'ready'; i++) { now += 1000; tick(S, now); if (o.acts[1] && o.acts[1].status === 'pending') run(S, C, 'act.accept', { orderId: id, n: 1 }, now); if (o.estimate.status === 'sent') run(S, C, 'estimate.approve', { orderId: id }, now); }
  assert.equal(o.status, 'ready');
  run(S, D, 'concierge.assign', { orderId: id, conciergeId: 'k4' }, now);
  for (let i = 0; i < 400 && o.status !== 'returned'; i++) { now += 1000; tick(S, now); }
  assert.equal(o.status, 'returned');
});
