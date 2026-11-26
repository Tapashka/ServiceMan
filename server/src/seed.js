// Стартовые данные экосистемы «Мой автомеханик».
// Один набор данных для всех приложений: клиентки, СТО, консьержи, диспетчерская.
// Все времена — в миллисекундах относительно момента сброса демо (now).

const MIN = 60 * 1000, H = 60 * MIN, D = 24 * H;

export const STO_ME = 'sto1';      // панель СТО открыта от имени этой станции
export const CLIENT_ME = 'c1';     // клиентское приложение — Анна Иванова
export const CONCIERGE_ME = 'k1';  // приложение консьержа — Игорь

export const PHOTO_SLOTS = ['Спереди','Сзади','Слева','Справа','Колесо ПЛ','Колесо ПП','Колесо ЗЛ','Колесо ЗП','Салон спереди','Салон сзади','Багажник','Приборная панель'];
export const KIT = ['Ключи (2 шт.)','Техпаспорт','Запасное колесо','Домкрат','Аптечка','Огнетушитель','Знак аварийной остановки'];

export const TAG_PRICE = {
  'Стук или скрип':[90,180], 'Вибрация при движении':[60,160], 'Горит лампочка на панели':[45,150],
  'Плохо заводится':[60,150], 'Подтекает жидкость':[50,140], 'Странный запах':[40,120],
  'Кондиционер не холодит':[60,120], 'Плановое ТО':[150,270], 'Не знаю, просто проверить':[30,80]
};
export const TAG_WORK = {
  'Стук или скрип':['Колодки передние','Работа по замене'],
  'Вибрация при движении':['Балансировка и проверка ходовой','Работа'],
  'Горит лампочка на панели':['Датчик по результату диагностики','Компьютерная диагностика и замена'],
  'Плохо заводится':['Аккумулятор','Диагностика и замена'],
  'Подтекает жидкость':['Прокладки и уплотнители','Работа по замене'],
  'Странный запах':['Фильтр салона и очистка','Работа'],
  'Кондиционер не холодит':['Заправка фреоном','Диагностика кондиционера'],
  'Плановое ТО':['Масло и фильтры','Работы по ТО-2'],
  'Не знаю, просто проверить':['Расходные материалы','Осмотр и диагностика']
};

export function seed(now = Date.now()) {
  const t = (ago) => now - ago;

  const clients = {
    c1: { id:'c1', name:'Анна Иванова', short:'Анна И.', phone:'+375 29 123-45-67', address:'ул. Немига, д. 14, кв. 27', district:'Центральный',
          lng:27.5545, lat:53.9035, plan:'advanced', bot:false,
          cars:[{ id:'car1', make:'Kia Rio, 2019', plate:'1234 АВ-7', mileage:'84 200 км', vin:'XW8...4471', gear:'АКПП' }] },
    c2: { id:'c2', name:'Мария Соколова', short:'Мария С.', phone:'+375 33 555-21-09', address:'ул. Кирова, 9', district:'Центральный', lng:27.5550, lat:53.8960, bot:true, cars:[] },
    c3: { id:'c3', name:'Елена Титова', short:'Елена Т.', phone:'+375 25 887-14-02', address:'просп. Независимости, 62', district:'Ленинский', lng:27.5930, lat:53.9180, bot:true, cars:[] },
    c4: { id:'c4', name:'Ольга Петрова', short:'Ольга П.', phone:'+375 29 442-98-31', address:'ул. Притыцкого, 22', district:'Фрунзенский', lng:27.4880, lat:53.9080, bot:true, cars:[] },
    c5: { id:'c5', name:'Наталья Волкова', short:'Наталья В.', phone:'+375 33 671-33-80', address:'ул. Сурганова, 1', district:'Советский', lng:27.5850, lat:53.9250, bot:true, cars:[] },
    c6: { id:'c6', name:'Ирина Ковальчук', short:'Ирина К.', phone:'+375 29 310-77-45', address:'ул. Железнодорожная, 33', district:'Московский', lng:27.5310, lat:53.8800, bot:true, cars:[] },
    c7: { id:'c7', name:'Светлана Мороз', short:'Светлана М.', phone:'+375 29 618-40-11', address:'ул. Голубева, 7', district:'Московский', lng:27.5120, lat:53.8720, bot:true, cars:[] },
    c8: { id:'c8', name:'Юлия Романович', short:'Юлия Р.', phone:'+375 44 702-55-90', address:'ул. Козлова, 12', district:'Первомайский', lng:27.5990, lat:53.9100, bot:true, cars:[] },
    c9: { id:'c9', name:'Вероника Савчук', short:'Вероника С.', phone:'+375 29 220-17-63', address:'ул. Платонова, 30', district:'Первомайский', lng:27.6010, lat:53.9140, bot:true, cars:[] },
    c10:{ id:'c10', name:'Татьяна Лис', short:'Татьяна Л.', phone:'+375 29 701-22-48', address:'ул. Кальварийская, 25', district:'Фрунзенский', lng:27.5160, lat:53.9080, bot:true, cars:[] }
  };

  const stos = {
    sto1: { id:'sto1', name:'Автосервис на Независимости', initials:'АН', address:'просп. Независимости, 45', lng:27.5866, lat:53.9163, rating:4.8, orders:640, bot:false,
            hint:'Въезд со двора, со стороны ул. Платонова. Машину оставьте у бокса №2.', brand:'TRW, Германия', f:0.45 },
    sto2: { id:'sto2', name:'СТО «Мотор+»', initials:'М+', address:'ул. Мясникова, 78', lng:27.5405, lat:53.8952, rating:4.7, orders:410, bot:true,
            hint:'Шлагбаум откроется по номеру авто. Приёмка — вход слева.', brand:'Bosch, Германия', f:0.55 },
    sto3: { id:'sto3', name:'Гараж «На Некрасова»', initials:'НК', address:'ул. Некрасова, 114', lng:27.6235, lat:53.9335, rating:4.6, orders:220, bot:true,
            hint:'Заезд через ворота с синей вывеской. Парковка для клиентов у входа.', brand:'Fenox, Россия', f:0.3 },
    sto4: { id:'sto4', name:'Автосервис «Скорость»', initials:'СК', address:'ул. Тимирязева, 65', lng:27.5205, lat:53.9165, rating:4.8, orders:530, bot:true,
            hint:'Въезд с ул. Тимирязева, второй поворот направо. Приёмка в первом боксе.', brand:'Brembo, Италия', f:0.8 }
  };

  const concierges = {
    k1: { id:'k1', name:'Игорь', full:'Игорь Ковалёв', car:'Chevrolet Cobalt', rating:4.9, trips:214, bot:false, onShift:false, type:'partner', lng:27.5795, lat:53.8905, fines:[], lateMin:0 },
    k2: { id:'k2', name:'Дмитрий', full:'Дмитрий Лукашевич', car:'Kia Rio', rating:4.6, trips:131, bot:true, onShift:true, type:'staff', lng:27.5480, lat:53.8990, lateMin:24,
          fines:[{ id:'f1', order:'0260', sum:12.5, date:'07.10', removed:false }] },
    k3: { id:'k3', name:'Сергей', full:'Сергей Мельник', car:'Lada Vesta', rating:4.8, trips:188, bot:true, onShift:true, type:'partner', lng:27.5450, lat:53.8850, fines:[], lateMin:0 },
    k4: { id:'k4', name:'Алексей', full:'Алексей Гринь', car:'Renault Logan', rating:4.7, trips:97, bot:true, onShift:true, type:'partner', lng:27.4900, lat:53.9050, fines:[], lateMin:0 },
    k5: { id:'k5', name:'Павел', full:'Павел Шостак', car:'Skoda Octavia', rating:4.9, trips:256, bot:true, onShift:false, type:'staff', lng:27.6100, lat:53.9300, fines:[], lateMin:0 }
  };

  const base = (o) => Object.assign({
    offers:[], stoId:null, price:null, stage:0, stageTs:null, diagnosis:'', estimate:{ items:[], total:0, status:'none' },
    pickup:null, ret:null, acts:{}, chat:[], paid:false, rating:null, refund:0, frozen:false, disputeId:null,
    delivery:'concierge', comment:'', gear:'АКПП', plate:'', bot:{ paused:false, next:0 }, log:[], updatedAt:o.createdAt
  }, o);

  const fullAct = (n, by, ts, place, mileage, fuel, extra={}) => Object.assign({
    n, by, ts, place, mileage, fuel, photos:12, damages:['Царапина на заднем бампере слева, ~5 см'], kitMissing:[],
    items:'Детское кресло, зонт в багажнике', status:'accepted'
  }, extra);

  const orders = {
    // --- новые заявки в ленте СТО (от клиенток-ботов) ---
    '0281': base({ id:'0281', clientId:'c4', car:'Skoda Rapid, 2017', plate:'4410 IT-7', gear:'МКПП', symptom:'Плановое ТО-2, дополнительно просит проверить тормоза и уровень масла.',
      tags:['Плановое ТО'], slot:'Сегодня, 18:00–20:00', urgent:false, createdAt:t(62*MIN), status:'published' }),
    '0282': base({ id:'0282', clientId:'c5', car:'Renault Logan, 2016', plate:'0098 MP-7', gear:'МКПП', symptom:'Плохо заводится в холод, подозрение на аккумулятор.',
      tags:['Плохо заводится'], slot:'Завтра, 08:00–10:00', urgent:false, createdAt:t(2*H), status:'published' }),
    '0283': base({ id:'0283', clientId:'c3', car:'Volkswagen Polo, 2018', plate:'1203 KH-7', gear:'МКПП', symptom:'Горит лампочка Check Engine на панели, машина дёргается на холостых.',
      tags:['Горит лампочка на панели'], slot:'Сегодня, 14:00–16:00', urgent:true, createdAt:t(6*MIN), status:'published' }),

    // --- заказ ждёт консьержа (лента консьержа + «ждёт назначения» у диспетчера) ---
    '0272': base({ id:'0272', clientId:'c6', car:'Toyota Corolla, 2015', plate:'7845 AB-7', gear:'АКПП', symptom:'Скрип при торможении, иногда тянет вправо.',
      tags:['Стук или скрип'], slot:'Сегодня, 16:00–18:00', urgent:true, createdAt:t(50*MIN), status:'confirmed', stoId:'sto1', price:140,
      offers:[{ id:9001, stoId:'sto1', price:140, items:[{name:'Колодки передние (TRW, Германия)',price:95},{name:'Работа по замене',price:45}], note:'Готовы принять сегодня', ts:t(45*MIN) }],
      estimate:{ items:[{name:'Колодки передние (TRW, Германия)',price:95},{name:'Работа по замене',price:45}], total:140, status:'none' },
      pickup:{ conciergeId:null, step:0, ts:t(45*MIN), progress:0 } }),

    // --- активные заказы, которые видит диспетчер ---
    '0244': base({ id:'0244', clientId:'c2', car:'Hyundai Solaris, 2021', plate:'5521 КН-7', symptom:'Не холодит кондиционер, посторонний звук при включении.',
      tags:['Кондиционер не холодит'], slot:'Сегодня, 14:00–16:00', createdAt:t(5*H), status:'confirmed', stoId:'sto1', price:95,
      offers:[{ id:9002, stoId:'sto1', price:95, items:[{name:'Заправка фреоном',price:60},{name:'Диагностика кондиционера',price:35}], note:'', ts:t(4.5*H) }],
      pickup:{ conciergeId:'k2', step:1, ts:t(40*MIN), progress:0.35 }, late:'Опоздание консьержа > 20 мин', bot:{ paused:true, next:0 } }),
    '0263': base({ id:'0263', clientId:'c7', car:'Peugeot 308, 2019', plate:'3307 ВО-7', symptom:'Стучит подвеска на неровностях.',
      tags:['Стук или скрип'], slot:'Сегодня, 10:00–12:00', createdAt:t(7*H), status:'at_sto', stoId:'sto2', price:210, stage:2, stageTs:t(3*H+10*MIN),
      estimate:{ items:[{name:'Стойки стабилизатора (Lemförder)',price:120},{name:'Работа',price:90}], total:210, status:'sent', ts:t(3*H+10*MIN) },
      pickup:{ conciergeId:'k3', step:6, ts:t(5*H), progress:1 },
      acts:{ 1: fullAct(1,'k3',t(6*H),'ул. Голубева, 7',61240,'1/2'), 2: fullAct(2,'k3',t(5*H),'ул. Мясникова, 78',61251,'1/2') },
      bot:{ paused:true, next:0 } }),
    '0265': base({ id:'0265', clientId:'c8', car:'Nissan Qashqai, 2020', plate:'8812 АР-7', symptom:'Плановое ТО, замена масла и фильтров.',
      tags:['Плановое ТО'], slot:'Сегодня, 08:00–10:00', createdAt:t(8*H), status:'at_sto', stoId:'sto3', price:180, stage:3, stageTs:t(65*MIN),
      estimate:{ items:[{name:'Масло и фильтры',price:110},{name:'Работы по ТО-2',price:70}], total:180, status:'approved', ts:t(2*H) },
      pickup:{ conciergeId:'k4', step:6, ts:t(6*H), progress:1 },
      acts:{ 1: fullAct(1,'k4',t(7*H),'ул. Козлова, 12',40110,'5/8'), 2: fullAct(2,'k4',t(6*H),'ул. Некрасова, 114',40122,'5/8') },
      bot:{ paused:true, next:0 } }),

    // --- возвращённые заказы со спорами (оплата заморожена) ---
    '0229': base({ id:'0229', clientId:'c9', car:'Kia Ceed, 2019', plate:'6604 НВ-7', symptom:'Стук спереди при повороте руля.', tags:['Стук или скрип'],
      slot:'Вчера, 10:00–12:00', createdAt:t(30*H), status:'returned', stoId:'sto1', price:135, paid:false, stage:4, frozen:true, disputeId:'Д-031',
      estimate:{ items:[{name:'Колодки передние (TRW)',price:90},{name:'Работа по замене',price:45}], total:135, status:'approved' },
      pickup:{ conciergeId:'k1', step:6, ts:t(28*H), progress:1 }, ret:{ conciergeId:'k1', step:5, ts:t(25*MIN), progress:1 },
      acts:{ 1: fullAct(1,'k1',t(29*H),'ул. Платонова, 30',84200,'1/2'), 2: fullAct(2,'k1',t(28*H),'просп. Независимости, 45',84212,'1/2'),
             3: fullAct(3,'sto1',t(70*MIN),'просп. Независимости, 45',84215,'1/2'),
             4: fullAct(4,'k1',t(25*MIN),'ул. Платонова, 30',84231,'3/8',{ damages:['Царапина на заднем бампере слева, ~5 см','Царапина на переднем бампере справа'], status:'disputed' }) },
      bot:{ paused:true, next:0 } }),
    '0251': base({ id:'0251', clientId:'c3', car:'Volkswagen Polo, 2018', plate:'2290 КО-7', symptom:'Горит Check Engine.', tags:['Горит лампочка на панели'],
      slot:'2 дня назад', createdAt:t(3*D), status:'returned', stoId:'sto1', price:150, stage:4, frozen:true, disputeId:'Д-029',
      estimate:{ items:[{name:'Датчик кислорода Bosch',price:95},{name:'Работа по замене',price:35},{name:'Диагностика',price:20}], total:150, status:'approved' },
      bot:{ paused:true, next:0 } }),
    '0198': base({ id:'0198', clientId:'c4', car:'Skoda Rapid, 2017', plate:'4410 IT-7', symptom:'Плановое ТО-2.', tags:['Плановое ТО'],
      slot:'4 дня назад', createdAt:t(4*D), status:'returned', stoId:'sto2', price:230, stage:4, frozen:true, disputeId:'Д-027',
      estimate:{ items:[{name:'ТО-2 (масло, фильтры)',price:150},{name:'Проверка тормозов',price:40},{name:'Щётки стеклоочистителя (не согласовано)',price:40}], total:230, status:'approved' },
      bot:{ paused:true, next:0 } }),

    // --- история СТО (закрытые) ---
    '0170': base({ id:'0170', clientId:'c5', car:'Chery Tiggo 4, 2020', symptom:'ТО', tags:['Плановое ТО'], createdAt:t(90*D), status:'closed', stoId:'sto1', price:230, paid:true, paidTs:t(90*D), rating:5, stage:4, bot:{paused:true,next:0} }),
    '0164': base({ id:'0164', clientId:'c2', car:'Kia Rio, 2020', symptom:'Колодки', tags:['Стук или скрип'], createdAt:t(95*D), status:'closed', stoId:'sto1', price:160, paid:true, paidTs:t(95*D), rating:5, stage:4, bot:{paused:true,next:0} }),
    '0151': base({ id:'0151', clientId:'c8', car:'Lada Vesta, 2019', symptom:'Диагностика', tags:['Не знаю, просто проверить'], createdAt:t(101*D), status:'closed', stoId:'sto1', price:95, paid:true, paidTs:t(101*D), rating:4, stage:4, bot:{paused:true,next:0} })
  };

  const disputes = {
    'Д-031': { id:'Д-031', order:'0229', type:'Повреждение при перегоне', source:'Акт №4 · кнопка «Есть претензия»', claim:'На переднем бампере справа новая царапина — в акте при заборе её не было.',
      orderSum:135, amount:120, ts:t(11*MIN), takenTs:null, status:'open', facts:'acts',
      log:[{ts:t(11*MIN), x:'Клиентка открыла спор из акта №4'},{ts:t(11*MIN), x:'Оплата 135 Br приостановлена'}],
      chat:[{w:'Вероника Савчук', ts:t(10*MIN), x:'Машину вернули с царапиной на бампере справа. Утром её не было, это видно по фото.'}] },
    'Д-029': { id:'Д-029', order:'0251', type:'Качество ремонта', source:'Чат поддержки', claim:'После замены датчика Check Engine снова горит на второй день.',
      orderSum:150, amount:150, ts:t(30*H), takenTs:t(30*H)+6*MIN, status:'waiting', facts:'estimate', waitingFor:'СТО',
      log:[{ts:t(30*H), x:'Клиентка написала в поддержку'},{ts:t(30*H)+6*MIN, x:'Диспетчер Ольга взяла спор в работу'},{ts:t(30*H)+10*MIN, x:'Запрошено объяснение у СТО и фото ошибки с панели у клиентки'},{ts:t(27*H), x:'Клиентка прислала фото панели'}],
      chat:[{w:'Елена Титова', ts:t(30*H), x:'Заплатила 150 рублей, а лампочка снова горит.'},{w:'Диспетчер', ts:t(30*H)+10*MIN, x:'Елена, пришлите, пожалуйста, фото панели с ошибкой. Мы запросили объяснение у СТО.'}] },
    'Д-027': { id:'Д-027', order:'0198', type:'Несогласие со сметой', source:'Карточка заказа · «Есть претензия»', claim:'В итоговом чеке появилась замена щёток стеклоочистителя за 40 Br, я её не согласовывала.',
      orderSum:230, amount:40, ts:t(2*D+5*H), takenTs:t(2*D+5*H)+6*MIN, status:'approval', facts:'estimate',
      proposal:{ decision:'partial', amount:40, reason:'Позиция «Щётки стеклоочистителя» добавлена после утверждения сметы, согласия клиентки в чате нет.', by:'Ольга К.' },
      log:[{ts:t(2*D+5*H), x:'Клиентка открыла спор'},{ts:t(2*D+5*H)+6*MIN, x:'Диспетчер взяла в работу'},{ts:t(2*D+2*H), x:'СТО подтвердила: позицию добавили без согласования'},{ts:t(20*H), x:'Предложен частичный возврат 40 Br → на утверждение директору'}],
      chat:[{w:'СТО «Мотор+»', ts:t(2*D+2*H), x:'Щётки были в плохом состоянии, мастер заменил. Согласен, что не согласовали.'}] },
    'Д-022': { id:'Д-022', order:'0260', type:'Опоздание консьержа', source:'Чат поддержки', claim:'Консьерж приехал на 35 минут позже слота.',
      orderSum:60, amount:0, ts:t(5*D), takenTs:t(5*D)+5*MIN, status:'closed', facts:'log',
      result:'Отказ в возврате клиентке: ремонт выполнен качественно. Консьержу начислен штраф 50% выезда (12,50 Br).',
      log:[{ts:t(5*D), x:'Спор открыт'},{ts:t(5*D)+5*MIN, x:'Взят в работу'},{ts:t(5*D)+42*MIN, x:'Закрыт: отказ, штраф консьержу'}], chat:[] }
  };
  // клиент/СТО/консьерж для споров по старым заказам без полной карточки
  disputes['Д-022'].client = 'Наталья Волкова'; disputes['Д-022'].car = 'Renault Logan, 2016'; disputes['Д-022'].sto = 'Автосервис на Независимости'; disputes['Д-022'].concierge = 'Дмитрий';
  disputes['Д-029'].concierge = 'Игорь'; disputes['Д-027'].concierge = 'Дмитрий';

  const sos = [
    { id:'S-118', clientId:'c10', client:'Татьяна Лис', phone:'+375 29 701-22-48', car:'Renault Sandero, 2017 · 7712 КН-7', scenario:'Не заводится', place:'ул. Кальварийская, 25 · точность 12 м', plan:'Продвинутый', ts:t(38*1000), step:0, log:[], source:'client' },
    { id:'S-117', clientId:null, client:'Ирина Ковальчук', phone:'+375 29 310-77-45', car:'Toyota Corolla, 2015', scenario:'Пробито колесо', place:'просп. Победителей, 9', plan:'Максимальный', ts:t(3*H), step:4, log:[], reaction:64, source:'client' }
  ];

  const ledger = [ // выплаты консьержу Игорю
    { id:'l1', k:'k1', ts:t(1*D), text:'Kia Ceed, полный цикл', sum:16 },
    { id:'l2', k:'k1', ts:t(2*D), text:'опоздание 24 мин, штраф 50%', sum:-8 },
    { id:'l3', k:'k1', ts:t(2*D+H), text:'Skoda Rapid, возврат', sum:9 },
    { id:'l4', k:'k1', ts:t(3*D), text:'Hyundai Solaris, полный цикл', sum:16 },
    { id:'l5', k:'k1', ts:t(3*D+H), text:'штраф снят диспетчером (ДТП на МКАД)', sum:0 }
  ];

  const N = (to, cat, ico, title, text, ago, link, read=false) => ({ id:'n'+Math.random().toString(36).slice(2,9), to, cat, ico, title, text, ts:t(ago), link:link||null, read });
  const notifications = [
    N({role:'client',id:'c1'}, 'reminder','reminder','Через 21 день заканчивается ОСГО','Полис действует до 16 декабря 2026. Продлите заранее.', 3*H, {view:'service', key:'insurance'}),
    N({role:'client',id:'c1'}, 'payment','payment','Пакет «Продвинутый» продлён','Списание с карты •• 4092. Следующее — 12 декабря.', 26*H, {view:'profile'}, true),
    N({role:'client',id:'c1'}, 'reminder','reminder','Пора менять шины на зимние','Рекомендуем до 1 декабря. Ваши зимние шины на хранении — заберём и привезём.', 28*H, {view:'service', key:'tires'}, true),
    N({role:'sto',id:'sto1'}, 'order','chat','Новое сообщение в чате','Мария С.: «Можно забрать машину завтра до 10?»', 2*H, {view:'myjobs'}, true),
    N({role:'sto',id:'sto1'}, 'order','order','Новая оценка: ★★★★★','Chery Tiggo 4 · «Быстро и всё объяснили»', 26*H, {view:'history'}, true),
    N({role:'sto',id:'sto1'}, 'billing','billing','Пробный месяц заканчивается через 5 дней','Далее подписка 150 BYN/мес. Проверьте привязанную карту.', 27*H, {view:'profile'}, true)
  ];

  return {
    version: 1, seq: 1, resetAt: now, nextOrder: 300, nextOffer: 1, nextSos: 120, nextDispute: 32,
    clients, stos, concierges, orders, disputes, sos, ledger, notifications,
    handoverNotes: {},
    demo: { spawnRequestAt: now + 20 * 1000, spawnSosAt: now + 45 * 1000 }
  };
}
