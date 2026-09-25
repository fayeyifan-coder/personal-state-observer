const OPTIONS = {
  mood: [
    { value: 1, label: '很差', icon: '😞' },
    { value: 2, label: '不太好', icon: '🙁' },
    { value: 3, label: '一般', icon: '😐' },
    { value: 4, label: '不错', icon: '🙂' },
    { value: 5, label: '很好', icon: '😄' }
  ],
  energy: [
    { value: 1, label: '几乎没有', icon: '🪫' },
    { value: 2, label: '比较低', icon: '😴' },
    { value: 3, label: '一般', icon: '😐' },
    { value: 4, label: '不错', icon: '🙂' },
    { value: 5, label: '很有精神', icon: '⚡' }
  ],
  drive: [
    { value: 1, label: '很难开始', icon: '🐌' },
    { value: 2, label: '有点困难', icon: '😩' },
    { value: 3, label: '一般', icon: '😐' },
    { value: 4, label: '比较容易', icon: '🙂' },
    { value: 5, label: '很容易', icon: '🚀' }
  ],
  sleepQuality: [
    { value: 1, label: '几乎没睡好', icon: '😵' },
    { value: 2, label: '不太好', icon: '🙁' },
    { value: 3, label: '一般', icon: '😐' },
    { value: 4, label: '不错', icon: '🙂' },
    { value: 5, label: '睡得很好', icon: '😴' }
  ],
  sleepDuration: [
    { value: 240, label: '＜5 小时' },
    { value: 330, label: '5–6 小时' },
    { value: 390, label: '6–7 小时' },
    { value: 450, label: '7–8 小时' },
    { value: 510, label: '8–9 小时' },
    { value: 600, label: '＞9 小时' }
  ],
  sleepProblem: [
    { value: 'onset_slow', label: '入睡比较慢' },
    { value: 'night_awake', label: '夜里醒过' },
    { value: 'early_wake', label: '醒得比较早' },
    { value: 'fragmented', label: '睡眠断断续续' },
    { value: 'wake_tired', label: '睡够了还是累' },
    { value: 'dream_tired', label: '做梦让我觉得累' },
    { value: 'hunger', label: '饿了' },
    { value: 'urination', label: '想上厕所' },
    { value: 'physical', label: '身体不舒服' },
    { value: 'mind_busy', label: '脑子停不下来' },
    { value: 'unknown', label: '说不上来' }
  ],
  sleepOnsetReason: [
    { value: 'none', label: '没有特别原因' },
    { value: 'hunger', label: '饿了' },
    { value: 'urination', label: '想上厕所' },
    { value: 'physical', label: '身体不舒服' },
    { value: 'mind_busy', label: '脑子停不下来' },
    { value: 'environment', label: '环境原因' },
    { value: 'other', label: '其他' }
  ],
  wakeFatigue: [
    { value: 1, label: '很清醒', icon: '😊' },
    { value: 2, label: '还不错', icon: '🙂' },
    { value: 3, label: '一般', icon: '😐' },
    { value: 4, label: '有些疲倦', icon: '😴' },
    { value: 5, label: '非常疲倦', icon: '🫠' }
  ],
  dreamMemory: [
    { value: 0, label: '没有印象' },
    { value: 1, label: '有印象' },
    { value: 2, label: '记得比较清楚' },
    { value: 3, label: '特别清楚、很强烈' }
  ],
  dreamFatigue: [
    { value: 0, label: '没有' },
    { value: 1, label: '有一点' },
    { value: 2, label: '很明显' }
  ],
  bedtimeUrinationDelay: [
    { value: 0, label: '没有明显影响' },
    { value: 1, label: '有一点' },
    { value: 2, label: '明显推迟了入睡' },
    { value: 3, label: '反复有尿意，明显影响入睡' }
  ],
  nightHungerEvent: [
    { value: 0, label: '没有' },
    { value: 1, label: '有一点，但没影响睡眠' },
    { value: 2, label: '影响了入睡' },
    { value: 3, label: '半夜明显饿到睡不着 / 醒来' }
  ],
  nightHungerIntake: [
    { value: 0, label: '没有' },
    { value: 1, label: '吃了一点' },
    { value: 2, label: '吃了一顿' }
  ],
  nightHungerRelief: [
    { value: 0, label: '没有明显缓解' },
    { value: 1, label: '有一点缓解' },
    { value: 2, label: '明显缓解' },
    { value: 3, label: '完全缓解' }
  ],
  napDuration: [
    { value: 0, label: '没有' },
    { value: 25, label: '20–30 分钟' },
    { value: 45, label: '30–60 分钟' },
    { value: 90, label: '1–2 小时' },
    { value: 120, label: '2 小时以上' }
  ],
  napQuality: [
    { value: 0, label: '没睡着' },
    { value: 1, label: '不太好' },
    { value: 2, label: '一般' },
    { value: 3, label: '不错' },
    { value: 4, label: '很好' }
  ],
  bedtimeTemperature: [
    { value: -2, label: '很冷', icon: '🥶' },
    { value: -1, label: '冷' },
    { value: 0, label: '刚刚好', icon: '🙂' },
    { value: 1, label: '热' },
    { value: 2, label: '很热', icon: '🥵' }
  ],
  recordingFlag: [
    { value: 'none', label: '没有特别明显的' },
    { value: 'low_mood', label: '心情明显偏低' },
    { value: 'low_energy', label: '没什么精神' },
    { value: 'hard_to_start', label: '特别难启动' },
    { value: 'high_energy', label: '特别有精神' },
    { value: 'unusually_active', label: '异常活跃 / 停不下来' }
  ],
  morningAppetite: [
    { value: 0, label: '完全没胃口' },
    { value: 1, label: '没什么胃口' },
    { value: 2, label: '和平时差不多' },
    { value: 3, label: '比较有胃口' },
    { value: 4, label: '特别有胃口' }
  ],
  previousEveningFullness: [
    { value: 0, label: '没吃东西' },
    { value: 1, label: '刚刚好' },
    { value: 2, label: '比较饱' },
    { value: 3, label: '很饱' },
    { value: 4, label: '撑得难受' }
  ],
  bedtimeHunger: [
    { value: 0, label: '一点都不饿' },
    { value: 1, label: '有一点饿' },
    { value: 2, label: '正常' },
    { value: 3, label: '比较饿' },
    { value: 4, label: '非常饿' }
  ],
  libido: [
    { value: 0, label: '没有' },
    { value: 1, label: '比平时少' },
    { value: 2, label: '和平时差不多' },
    { value: 3, label: '比平时多' },
    { value: 4, label: '明显比平时多' }
  ],
  physicalDiscomfort: [
    { value: 0, label: '很舒服' },
    { value: 1, label: '还不错' },
    { value: 2, label: '一般' },
    { value: 3, label: '不太舒服' },
    { value: 4, label: '很不舒服' }
  ],
  discomfortArea: [
    { value: 'head', label: '头' },
    { value: 'eyes', label: '眼睛' },
    { value: 'throat', label: '喉咙' },
    { value: 'chest', label: '胸口' },
    { value: 'abdomen', label: '腹部' },
    { value: 'waist_back', label: '腰 / 背' },
    { value: 'limbs', label: '四肢' },
    { value: 'joints', label: '关节' },
    { value: 'skin', label: '皮肤' },
    { value: 'other', label: '其他' }
  ],
  cycleGateway: [
    { value: 'none', label: '没有' },
    { value: 'bleeding', label: '有出血' },
    { value: 'discharge', label: '有分泌物变化' },
        { value: 'unsure', label: '不确定' }
  ],
  bleedingLevel: [
    { value: 'spotting', label: '点滴' },
    { value: 'light', label: '少量' },
    { value: 'medium', label: '中等' },
    { value: 'heavy', label: '较多' }
  ],
  dischargeAmount: [
    { value: 1, label: '少量' },
    { value: 2, label: '中等' },
    { value: 3, label: '较多' }
  ],
  dischargeCharacter: [
    { value: 'transparent', label: '透明' },
    { value: 'white', label: '乳白' },
    { value: 'yellow', label: '黄色' },
    { value: 'brown', label: '褐色' },
    { value: 'bloody', label: '带血' },
    { value: 'other', label: '其他' }
  ]
};

const QUESTIONS = [
  { id: 'mood', parentId: null, phase: '今天', text: '今天心情怎么样？', helper: '只选最接近今天的感觉。', type: 'choice', options: OPTIONS.mood },
  { id: 'energy', parentId: null, phase: '今天', text: '今天有精神吗？', helper: '想的是今天整体的精神与身体活力。', type: 'choice', options: OPTIONS.energy },
  { id: 'drive', parentId: null, phase: '今天', text: '今天做事情容易开始吗？', helper: '不管最后做没做完，只看“开始行动”有多容易。', type: 'choice', options: OPTIONS.drive },
  {
    id: 'sleep_quality', parentId: null, phase: '昨夜', text: '昨晚睡得怎么样？', type: 'choice', options: OPTIONS.sleepQuality
  },
  {
    id: 'sleep_duration_min', parentId: 'sleep_quality', phase: '昨夜', text: '昨晚大概睡了多久？', helper: '可以只选一个大概范围。', type: 'choice', options: OPTIONS.sleepDuration
  },
  {
    id: 'sleep_problem', parentId: 'sleep_quality', phase: '昨夜', text: '主要哪里不太好？', helper: '可以多选。只选真正影响你的部分。', type: 'multiChoice',
    showWhen: { all: [{ field: 'sleep_quality', op: 'lte', value: 3 }] }, options: OPTIONS.sleepProblem
  },
  {
    id: 'sleep_onset_reason', parentId: 'sleep_problem', phase: '昨夜', text: '昨晚是什么让你一直没睡着？', helper: '可以多选。', type: 'multiChoice',
    showWhen: { all: [
      { field: 'sleep_quality', op: 'lte', value: 3 },
      { field: 'sleep_problem', op: 'includes', value: 'onset_slow' },
      { field: 'sleep_problem', op: 'notIncludes', value: 'hunger' },
      { field: 'sleep_problem', op: 'notIncludes', value: 'urination' },
      { field: 'sleep_problem', op: 'notIncludes', value: 'physical' },
      { field: 'sleep_problem', op: 'notIncludes', value: 'mind_busy' }
    ] }, options: OPTIONS.sleepOnsetReason
  },
  {
    id: 'wake_fatigue', parentId: 'sleep_quality', phase: '昨夜', text: '今天醒来的时候感觉怎么样？', type: 'choice',
    showWhen: { all: [{ field: 'sleep_quality', op: 'lte', value: 3 }] }, options: OPTIONS.wakeFatigue
  },
  {
    id: 'dream_memory', parentId: 'sleep_problem', phase: '昨夜', text: '这个梦你记得多清楚？', helper: '“没有印象”不等于没有做梦。', type: 'choice',
    showWhen: { all: [{ field: 'sleep_quality', op: 'lte', value: 3 }, { field: 'sleep_problem', op: 'includes', value: 'dream_tired' }] }, options: OPTIONS.dreamMemory
  },
  {
    id: 'dream_fatigue', parentId: 'dream_memory', phase: '昨夜', text: '醒来后，这个梦让你觉得累吗？', type: 'choice',
    showWhen: { all: [
      { field: 'sleep_quality', op: 'lte', value: 3 },
      { field: 'sleep_problem', op: 'includes', value: 'dream_tired' },
      { field: 'dream_memory', op: 'gte', value: 1 }
    ] }, options: OPTIONS.dreamFatigue
  },
  {
    id: 'bedtime_urination_delay', parentId: 'sleep_problem', phase: '昨夜', text: '昨晚睡前，有没有因为想上厕所而延迟入睡？', helper: '指已经准备睡觉后，因为感觉有尿，不得不去厕所，导致入睡时间被推迟。', type: 'choice',
    showWhen: { all: [{ field: 'sleep_quality', op: 'lte', value: 3 }, { field: 'sleep_problem', op: 'includes', value: 'urination' }] }, options: OPTIONS.bedtimeUrinationDelay
  },
  {
    id: 'night_hunger_event', parentId: 'sleep_problem', phase: '昨夜', text: '昨晚有没有因为饿而睡不着或醒来？', type: 'choice',
    showWhen: { all: [{ field: 'sleep_quality', op: 'lte', value: 3 }, { field: 'sleep_problem', op: 'includes', value: 'hunger' }] }, options: OPTIONS.nightHungerEvent
  },
  {
    id: 'night_hunger_intake', parentId: 'night_hunger_event', phase: '昨夜', text: '后来吃东西了吗？', type: 'choice',
    showWhen: { all: [{ field: 'night_hunger_event', op: 'gte', value: 2 }] }, options: OPTIONS.nightHungerIntake
  },
  {
    id: 'night_hunger_relief', parentId: 'night_hunger_intake', phase: '昨夜', text: '吃东西后，饥饿感缓解了吗？', type: 'choice',
    showWhen: { all: [{ field: 'night_hunger_intake', op: 'gte', value: 1 }] }, options: OPTIONS.nightHungerRelief
  },

  {
    id: 'nap_duration_min', parentId: null, phase: '白天 / 睡前', text: '今天午休了吗？', type: 'choice', options: OPTIONS.napDuration
  },
  {
    id: 'nap_quality', parentId: 'nap_duration_min', phase: '白天 / 睡前', text: '这次午休睡得怎么样？', type: 'choice',
    showWhen: { all: [{ field: 'nap_duration_min', op: 'gt', value: 0 }] }, options: OPTIONS.napQuality
  },
  {
    id: 'bedtime_temperature_feeling', parentId: null, phase: '昨夜', text: '昨晚睡前，身体感觉怎么样？', type: 'choice', options: OPTIONS.bedtimeTemperature
  }
];

const OPTIONAL_QUESTIONS = [
  { id: 'today_flag', label: '今天有没有什么特别明显的状态？', type: 'multiChoice', options: OPTIONS.recordingFlag },
  { id: 'basal_temperature_c', label: '晨起体温', type: 'number', unit: '°C' },
  { id: 'weight_kg', label: '体重', type: 'number', unit: 'kg' },
  { id: 'morning_appetite', label: '今天早上有胃口吗？', type: 'choice', options: OPTIONS.morningAppetite },
  { id: 'previous_evening_fullness', label: '昨晚睡前吃完东西是什么感觉？', type: 'choice', options: OPTIONS.previousEveningFullness,
    showWhen: { all: [{ field: 'morning_appetite', op: 'lte', value: 1 }] } },
  { id: 'bedtime_hunger', label: '现在睡前饿吗？', type: 'choice', options: OPTIONS.bedtimeHunger },
  { id: 'libido', label: '今天的亲密需求和平时相比？', type: 'choice', options: OPTIONS.libido },
  { id: 'cycle_gateway', label: '今天有明显的生理变化吗？', type: 'choice', options: OPTIONS.cycleGateway },
  { id: 'bleeding_level', label: '今天出血多少？', type: 'choice', options: OPTIONS.bleedingLevel,
    showWhen: { all: [{ field: 'cycle_gateway', op: 'eq', value: 'bleeding' }] } },
  { id: 'discharge_amount', label: '今天分泌物多少？', type: 'choice', options: OPTIONS.dischargeAmount,
    showWhen: { all: [{ field: 'cycle_gateway', op: 'eq', value: 'discharge' }] } },
  { id: 'discharge_character', label: '更接近哪种？', type: 'multiChoice', options: OPTIONS.dischargeCharacter,
    showWhen: { all: [{ field: 'cycle_gateway', op: 'eq', value: 'discharge' }] } },
  { id: 'physical_discomfort', label: '今天身体舒服吗？', type: 'choice', options: OPTIONS.physicalDiscomfort },
  { id: 'discomfort_area', label: '哪里不舒服？', type: 'multiChoice', options: OPTIONS.discomfortArea,
    showWhen: { all: [{ field: 'physical_discomfort', op: 'gte', value: 3 }] } },
  { id: 'context_events', label: '今天有什么背景情况？', type: 'multiChoice', options: [
      { value: 'slept_late', label: '熬夜 / 睡得很晚' },
      { value: 'caffeine', label: '咖啡因较多' },
      { value: 'alcohol', label: '饮酒' },
      { value: 'exercise', label: '运动量很大' },
      { value: 'outdoors', label: '长时间户外' },
      { value: 'social', label: '社交很多' },
      { value: 'alone', label: '大部分时间独处' },
      { value: 'stress', label: '工作 / 学习压力大' },
      { value: 'illness', label: '身体不舒服 / 生病' },
      { value: 'medication', label: '服用药物' },
      { value: 'important_event', label: '发生重要事情' },
      { value: 'full_dinner', label: '晚餐吃得很饱' },
      { value: 'light_dinner', label: '晚餐吃得少 / 较早' },
      { value: 'other', label: '其他' }
    ] },
  { id: 'note', label: '今天还有什么想留下的吗？', type: 'text', maxLength: 500 }
];

const FIELD_MAP = {
  sleep_duration_min: 'sleepDurationMin',
  sleep_quality: 'sleepQuality',
  sleep_problem: 'sleepProblem',
  sleep_onset_reason: 'sleepOnsetReason',
  wake_fatigue: 'wakeFatigue',
  dream_memory: 'dreamMemory',
  dream_fatigue: 'dreamFatigue',
  nap_duration_min: 'napDurationMin',
  nap_quality: 'napQuality',
  bedtime_urination_delay: 'bedtimeUrinationDelay',
  bedtime_temperature_feeling: 'bedtimeTemperatureFeeling',
  night_hunger_event: 'nightHungerEvent',
  night_hunger_intake: 'nightHungerIntake',
  night_hunger_relief: 'nightHungerRelief',
  today_flag: 'todayFlag',
  basal_temperature_c: 'basalTemperatureC',
  weight_kg: 'weightKg',
  morning_appetite: 'morningAppetite',
  previous_evening_fullness: 'previousEveningFullness',
  bedtime_hunger: 'bedtimeHunger',
  libido: 'libido',
  cycle_gateway: 'cycleGateway',
  bleeding_level: 'bleedingLevel',
  discharge_amount: 'dischargeAmount',
  discharge_character: 'dischargeCharacter',
  physical_discomfort: 'physicalDiscomfort',
  discomfort_area: 'discomfortArea',
  context_events: 'contextEvents',
  note: 'note'
};

window.StateObserverQuestions = { QUESTIONS, OPTIONAL_QUESTIONS, FIELD_MAP, SCHEMA_VERSION: '0.6' };
