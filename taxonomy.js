// מבנה הסיווג — מקור האמת היחיד.
// שני צירים מאונכים:
//   מחלקה › קטגוריה  = על מה הכסף יצא
//   מקור (stream)     = לאיזה מרכז רווח זה שייך — כאן נפגשות הכנסות והוצאות

/* ==================== מחלקות וקטגוריות ==================== */

export const DEPTS = [
  { key: 'home', label: 'דיור ובית', icon: 'home', slot: 0, flow: 'out', cats: [
    { key: 'rent',        label: 'שכירות / משכנתא', kind: 'fixed',    need: 'essential' },
    { key: 'arnona',      label: 'ארנונה',           kind: 'fixed',    need: 'essential' },
    { key: 'electricity', label: 'חשמל',             kind: 'fixed',    need: 'essential' },
    { key: 'water',       label: 'מים',              kind: 'fixed',    need: 'essential' },
    { key: 'gas',         label: 'גז',               kind: 'fixed',    need: 'essential' },
    { key: 'vaad',        label: 'ועד בית',          kind: 'fixed',    need: 'essential' },
    { key: 'internet',    label: 'אינטרנט',          kind: 'fixed',    need: 'essential' },
    { key: 'repairs',     label: 'תחזוקה ותיקונים',  kind: 'oneoff',   need: 'essential' },
    { key: 'furniture',   label: 'ריהוט וציוד',      kind: 'oneoff',   need: 'discretionary' },
    { key: 'cleaning',    label: 'ניקיון / עוזרת',   kind: 'fixed',    need: 'discretionary' },
    { key: 'general',     label: 'כללי — בית',       kind: 'variable', need: 'essential' },
  ]},

  { key: 'food', label: 'מזון', icon: 'food', slot: 1, flow: 'out', cats: [
    { key: 'super',      label: 'סופרמרקט',           kind: 'variable', need: 'essential' },
    { key: 'grocery',    label: 'מכולת / ירקן / קצב', kind: 'variable', need: 'essential' },
    { key: 'restaurant', label: 'מסעדות ובתי קפה',    kind: 'variable', need: 'discretionary' },
    { key: 'delivery',   label: 'משלוחים',            kind: 'variable', need: 'discretionary' },
    { key: 'coffee',     label: 'קפה בדרך',           kind: 'variable', need: 'discretionary' },
    { key: 'alcohol',    label: 'אלכוהול',            kind: 'variable', need: 'discretionary' },
    { key: 'general',    label: 'כללי — מזון',        kind: 'variable', need: 'essential' },
  ]},

  { key: 'transport', label: 'תחבורה', icon: 'car', slot: 2, flow: 'out', cats: [
    { key: 'fuel',      label: 'דלק',                kind: 'variable', need: 'essential' },
    { key: 'carins',    label: 'ביטוח רכב',          kind: 'fixed',    need: 'essential' },
    { key: 'service',   label: 'טסט וטיפולים',       kind: 'oneoff',   need: 'essential' },
    { key: 'parking',   label: 'חניה',               kind: 'variable', need: 'essential' },
    { key: 'toll',      label: 'כבישי אגרה',         kind: 'variable', need: 'discretionary' },
    { key: 'fines',     label: 'קנסות ודוחות',       kind: 'oneoff',   need: 'discretionary' },
    { key: 'transit',   label: 'תחבורה ציבורית',     kind: 'variable', need: 'essential' },
    { key: 'taxi',      label: 'מוניות / גט',        kind: 'variable', need: 'discretionary' },
    { key: 'leasing',   label: 'ליסינג / החזר רכב',  kind: 'fixed',    need: 'essential' },
    { key: 'general',   label: 'כללי — תחבורה',      kind: 'variable', need: 'essential' },
  ]},

  { key: 'health', label: 'בריאות', icon: 'health', slot: 3, flow: 'out', cats: [
    { key: 'kupa',      label: 'קופ״ח / ביטוח בריאות', kind: 'fixed',    need: 'essential' },
    { key: 'pharmacy',  label: 'בית מרקחת',            kind: 'variable', need: 'essential' },
    { key: 'doctor',    label: 'רופאים פרטיים',        kind: 'oneoff',   need: 'essential' },
    { key: 'dental',    label: 'שיניים',               kind: 'oneoff',   need: 'essential' },
    { key: 'optics',    label: 'אופטיקה',              kind: 'oneoff',   need: 'essential' },
    { key: 'therapy',   label: 'טיפולים',              kind: 'variable', need: 'essential' },
    { key: 'gym',       label: 'חדר כושר',             kind: 'fixed',    need: 'discretionary' },
    { key: 'supps',     label: 'תוספי תזונה',          kind: 'variable', need: 'discretionary' },
    { key: 'general',   label: 'כללי — בריאות',        kind: 'variable', need: 'essential' },
  ]},

  { key: 'family', label: 'משפחה וילדים', icon: 'family', slot: 4, flow: 'out', cats: [
    { key: 'daycare',  label: 'גן / צהרון / חינוך', kind: 'fixed',    need: 'essential' },
    { key: 'classes',  label: 'חוגים',              kind: 'fixed',    need: 'discretionary' },
    { key: 'kidcloth', label: 'ביגוד ילדים',        kind: 'variable', need: 'essential' },
    { key: 'sitter',   label: 'בייביסיטר',          kind: 'variable', need: 'discretionary' },
    { key: 'support',  label: 'העברות משפחתיות',    kind: 'fixed',    need: 'essential' },
    { key: 'general',  label: 'כללי — משפחה',       kind: 'variable', need: 'essential' },
  ]},

  { key: 'shopping', label: 'קניות אישיות', icon: 'bag', slot: 5, flow: 'out', cats: [
    { key: 'clothing',    label: 'ביגוד והנעלה',   kind: 'variable', need: 'discretionary' },
    { key: 'grooming',    label: 'טיפוח ומספרה',   kind: 'variable', need: 'discretionary' },
    { key: 'electronics', label: 'אלקטרוניקה',     kind: 'oneoff',   need: 'discretionary' },
    { key: 'appliances',  label: 'מוצרי חשמל',     kind: 'oneoff',   need: 'discretionary' },
    { key: 'online',      label: 'שופינג אונליין', kind: 'variable', need: 'discretionary' },
    { key: 'gifts',       label: 'מתנות',          kind: 'oneoff',   need: 'discretionary' },
    { key: 'general',     label: 'כללי — קניות',   kind: 'variable', need: 'discretionary' },
  ]},

  { key: 'leisure', label: 'פנאי ובידור', icon: 'plane', slot: 6, flow: 'out', cats: [
    { key: 'domestic', label: 'נופש בארץ',        kind: 'oneoff',   need: 'discretionary' },
    { key: 'flights',  label: 'טיסות וחו״ל',      kind: 'oneoff',   need: 'discretionary' },
    { key: 'hotels',   label: 'מלונות',           kind: 'oneoff',   need: 'discretionary' },
    { key: 'events',   label: 'הופעות ואירועים',  kind: 'oneoff',   need: 'discretionary' },
    { key: 'learning', label: 'ספרים וקורסים',    kind: 'variable', need: 'discretionary' },
    { key: 'nightout', label: 'יציאות וברים',     kind: 'variable', need: 'discretionary' },
    { key: 'general',  label: 'כללי — פנאי',      kind: 'variable', need: 'discretionary' },
  ]},

  { key: 'subs', label: 'מנויים ודיגיטל', icon: 'repeat', slot: 7, flow: 'out', cats: [
    { key: 'streaming', label: 'סטרימינג',      kind: 'fixed', need: 'discretionary' },
    { key: 'cloud',     label: 'ענן ואחסון',    kind: 'fixed', need: 'discretionary' },
    { key: 'ai',        label: 'כלי AI',        kind: 'fixed', need: 'discretionary' },
    { key: 'software',  label: 'תוכנה ו-SaaS',  kind: 'fixed', need: 'discretionary' },
    { key: 'cellular',  label: 'סלולר',         kind: 'fixed', need: 'essential' },
    { key: 'micro',     label: 'מיקרו-מנויים',  kind: 'fixed', need: 'discretionary' },
    { key: 'general',   label: 'כללי — מנויים', kind: 'fixed', need: 'discretionary' },
  ]},

  { key: 'finance', label: 'פיננסים והתחייבויות', icon: 'bank', slot: 0, flow: 'out', cats: [
    { key: 'bankfees', label: 'עמלות בנק',        kind: 'fixed',  need: 'essential' },
    { key: 'cardfees', label: 'דמי כרטיס אשראי',  kind: 'fixed',  need: 'essential' },
    { key: 'interest', label: 'ריבית ומסגרת',     kind: 'fixed',  need: 'essential' },
    { key: 'loans',    label: 'החזרי הלוואות',    kind: 'fixed',  need: 'essential' },
    { key: 'insurance',label: 'ביטוח / פנסיה',    kind: 'fixed',  need: 'essential' },
    { key: 'tax',      label: 'מיסים',            kind: 'oneoff', need: 'essential' },
    { key: 'general',  label: 'כללי — פיננסים',   kind: 'fixed',  need: 'essential' },
  ]},

  { key: 'trading', label: 'מסחר ועסק', icon: 'chart', slot: 1, flow: 'out', cats: [
    { key: 'commissions', label: 'עמלות ברוקר',        kind: 'variable', need: 'essential' },
    { key: 'platforms',   label: 'פלטפורמות מסחר',     kind: 'fixed',    need: 'essential' },
    { key: 'prop',        label: 'אתגרי Prop / resets', kind: 'variable', need: 'essential' },
    { key: 'data',        label: 'דאטה ופידים',        kind: 'fixed',    need: 'essential' },
    { key: 'servers',     label: 'שרתים / VPS',        kind: 'fixed',    need: 'essential' },
    { key: 'accounting',  label: 'רו״ח ועסקי',         kind: 'oneoff',   need: 'essential' },
    { key: 'general',     label: 'כללי — מסחר',        kind: 'variable', need: 'essential' },
  ]},

  { key: 'transfer', label: 'העברות', icon: 'swap', slot: 2, flow: 'neutral', cats: [
    { key: 'p2p',        label: 'ביט / פייבוקס',      kind: 'variable', need: 'essential' },
    { key: 'withdrawal', label: 'משיכת מזומן',        kind: 'variable', need: 'essential' },
    { key: 'internal',   label: 'העברה בין חשבונות',  kind: 'variable', need: 'essential' },
    { key: 'refund',     label: 'זיכוי / החזר',       kind: 'oneoff',   need: 'essential' },
    { key: 'invest',     label: 'הפקדה להשקעות',      kind: 'fixed',    need: 'essential' },
    { key: 'general',    label: 'כללי — העברות',      kind: 'variable', need: 'essential' },
  ]},

  { key: 'income', label: 'הכנסות', icon: 'income', slot: 3, flow: 'in', cats: [
    { key: 'salary',    label: 'משכורת',            kind: 'fixed',    need: 'essential' },
    { key: 'payout',    label: 'משיכת רווח / payout', kind: 'variable', need: 'essential' },
    { key: 'invoice',   label: 'חשבונית / פרויקט',  kind: 'variable', need: 'essential' },
    { key: 'rentin',    label: 'שכר דירה שהתקבל',   kind: 'fixed',    need: 'essential' },
    { key: 'dividend',  label: 'דיבידנד / ריבית',   kind: 'variable', need: 'essential' },
    { key: 'taxback',   label: 'החזרי מס',          kind: 'oneoff',   need: 'essential' },
    { key: 'side',      label: 'הכנסה צדדית',       kind: 'variable', need: 'essential' },
    { key: 'general',   label: 'כללי — הכנסות',     kind: 'variable', need: 'essential' },
  ]},
];

/* ==================== מקורות — מרכזי רווח ==================== */
// כאן נפגשות הכנסות והוצאות של אותה פעילות. "מסחר" צובר גם עמלות וגם משיכות רווח,
// ולכן אפשר לשאול "כמה המסחר באמת הכניס אחרי כל העלויות".

export const DEFAULT_STREAMS = [
  { id: 'household', name: 'משק בית',  kind: 'household',  slot: 0, builtin: true },
  { id: 'salary',    name: 'משכורת',   kind: 'employment', slot: 2, builtin: true },
  { id: 'trading',   name: 'מסחר',     kind: 'venture',    slot: 1, builtin: true },
];

export const STREAM_KIND_LABEL = {
  household: 'משק בית', employment: 'שכיר', venture: 'פעילות עסקית', property: 'נכס', other: 'אחר',
};

/** ניחוש המקור מתוך המחלקה — עובד גם כשהמשתמש לא בחר כלום */
export function guessStream(deptKey, catKey) {
  if (deptKey === 'trading') return 'trading';
  if (deptKey === 'income') {
    if (catKey === 'salary') return 'salary';
    if (catKey === 'payout' || catKey === 'dividend') return 'trading';
    return 'household';
  }
  return 'household';
}

/* ==================== תוויות ==================== */

export const KIND_LABEL   = { fixed: 'קבוע', variable: 'משתנה', oneoff: 'חד-פעמי' };
export const NEED_LABEL   = { essential: 'חיוני', discretionary: 'רשות' };
export const SCOPE_LABEL  = { personal: 'פרטי', business: 'עסקי' };
export const METHOD_LABEL = {
  cash: 'מזומן', credit: 'אשראי', bank: 'העברה בנקאית', bit: 'ביט / פייבוקס', other: 'אחר',
};
export const FLOW_LABEL = { out: 'הוצאה', in: 'הכנסה', neutral: 'העברה' };

/* ==================== גישה ==================== */

const _deptMap = new Map(DEPTS.map(d => [d.key, d]));

export function dept(key) { return _deptMap.get(key) || null; }

export function cat(deptKey, catKey) {
  return _deptMap.get(deptKey)?.cats.find(c => c.key === catKey) || null;
}

export function pathLabel(deptKey, catKey) {
  const d = dept(deptKey);
  if (!d) return 'לא מסווג';
  const c = cat(deptKey, catKey);
  return c ? `${d.label} › ${c.label}` : d.label;
}

export function catLabel(deptKey, catKey) {
  const c = cat(deptKey, catKey);
  if (!c) return dept(deptKey)?.label || '—';
  return c.key === 'general' ? dept(deptKey).label : c.label;
}

export function flowOf(deptKey) { return dept(deptKey)?.flow || 'out'; }

export function defaultsFor(deptKey, catKey) {
  const c = cat(deptKey, catKey);
  return {
    kind: c?.kind || 'variable',
    need: c?.need || 'essential',
    scope: deptKey === 'trading' ? 'business' : 'personal',
    stream: guessStream(deptKey, catKey),
  };
}

export const EXPENSE_DEPTS = DEPTS.filter(d => d.flow === 'out');
export const INCOME_CATS = dept('income').cats;

/** רשימה שטוחה להזרקה לפרומפט של המודל */
export function flatForPrompt() {
  return DEPTS.flatMap(d => d.cats.map(c => `${d.key}/${c.key} = ${d.label} › ${c.label}`)).join('\n');
}

/* ==================== צ'יפים מהירים ==================== */

export const QUICK_SEED = [
  ['food', 'super'], ['food', 'restaurant'], ['food', 'coffee'], ['transport', 'fuel'],
  ['shopping', 'general'], ['home', 'general'], ['health', 'general'], ['leisure', 'general'],
];
