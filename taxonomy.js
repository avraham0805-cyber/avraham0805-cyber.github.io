// מבנה המחלקות — מקור האמת היחיד לקטגוריות במערכת.
// flow: out = הוצאה | in = הכנסה | neutral = לא נספר בסטטיסטיקה
// לכל קטגוריה ברירות מחדל ל-kind (קבוע/משתנה/חד-פעמי) ו-need (חיוני/רשות),
// כדי שהמילון הלומד יוכל למלא הכל מתיוג אחד.

export const DEPTS = [
  { key: 'home', label: 'דיור ובית', icon: '🏠', color: '#5b8def', flow: 'out', cats: [
    { key: 'rent',        label: 'שכירות / משכנתא', kind: 'fixed',    need: 'essential' },
    { key: 'arnona',      label: 'ארנונה',           kind: 'fixed',    need: 'essential' },
    { key: 'electricity', label: 'חשמל',             kind: 'fixed',    need: 'essential' },
    { key: 'water',       label: 'מים',              kind: 'fixed',    need: 'essential' },
    { key: 'gas',         label: 'גז',               kind: 'fixed',    need: 'essential' },
    { key: 'vaad',        label: 'ועד בית',          kind: 'fixed',    need: 'essential' },
    { key: 'internet',    label: 'אינטרנט',          kind: 'fixed',    need: 'essential' },
    { key: 'repairs',     label: 'תחזוקה ותיקונים',  kind: 'oneoff',   need: 'essential' },
    { key: 'furniture',   label: 'ריהוט וציוד לבית', kind: 'oneoff',   need: 'discretionary' },
    { key: 'cleaning',    label: 'ניקיון / עוזרת',   kind: 'fixed',    need: 'discretionary' },
    { key: 'general',     label: 'כללי — בית',       kind: 'variable', need: 'essential' },
  ]},

  { key: 'food', label: 'מזון', icon: '🍽️', color: '#f2994a', flow: 'out', cats: [
    { key: 'super',      label: 'סופרמרקט',           kind: 'variable', need: 'essential' },
    { key: 'grocery',    label: 'מכולת / ירקן / קצב', kind: 'variable', need: 'essential' },
    { key: 'restaurant', label: 'מסעדות ובתי קפה',    kind: 'variable', need: 'discretionary' },
    { key: 'delivery',   label: 'משלוחים',            kind: 'variable', need: 'discretionary' },
    { key: 'coffee',     label: 'קפה בדרך',           kind: 'variable', need: 'discretionary' },
    { key: 'alcohol',    label: 'אלכוהול',            kind: 'variable', need: 'discretionary' },
    { key: 'general',    label: 'כללי — מזון',        kind: 'variable', need: 'essential' },
  ]},

  { key: 'transport', label: 'תחבורה', icon: '🚗', color: '#27ae60', flow: 'out', cats: [
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

  { key: 'health', label: 'בריאות', icon: '⚕️', color: '#eb5757', flow: 'out', cats: [
    { key: 'kupa',      label: 'קופ״ח / ביטוח בריאות', kind: 'fixed',    need: 'essential' },
    { key: 'pharmacy',  label: 'בית מרקחת',            kind: 'variable', need: 'essential' },
    { key: 'doctor',    label: 'רופאים פרטיים',        kind: 'oneoff',   need: 'essential' },
    { key: 'dental',    label: 'שיניים',               kind: 'oneoff',   need: 'essential' },
    { key: 'optics',    label: 'אופטיקה',              kind: 'oneoff',   need: 'essential' },
    { key: 'therapy',   label: 'טיפולים / פיזיותרפיה', kind: 'variable', need: 'essential' },
    { key: 'gym',       label: 'חדר כושר וכושר',       kind: 'fixed',    need: 'discretionary' },
    { key: 'supps',     label: 'תוספי תזונה',          kind: 'variable', need: 'discretionary' },
    { key: 'general',   label: 'כללי — בריאות',        kind: 'variable', need: 'essential' },
  ]},

  { key: 'family', label: 'משפחה וילדים', icon: '👪', color: '#bb6bd9', flow: 'out', cats: [
    { key: 'daycare',  label: 'גן / צהרון / חינוך',  kind: 'fixed',    need: 'essential' },
    { key: 'classes',  label: 'חוגים',               kind: 'fixed',    need: 'discretionary' },
    { key: 'kidcloth', label: 'ביגוד ילדים',         kind: 'variable', need: 'essential' },
    { key: 'sitter',   label: 'בייביסיטר',           kind: 'variable', need: 'discretionary' },
    { key: 'support',  label: 'העברות משפחתיות',     kind: 'fixed',    need: 'essential' },
    { key: 'general',  label: 'כללי — משפחה',        kind: 'variable', need: 'essential' },
  ]},

  { key: 'shopping', label: 'קניות אישיות', icon: '🛍️', color: '#f2c94c', flow: 'out', cats: [
    { key: 'clothing',    label: 'ביגוד והנעלה',      kind: 'variable', need: 'discretionary' },
    { key: 'grooming',    label: 'טיפוח ומספרה',      kind: 'variable', need: 'discretionary' },
    { key: 'electronics', label: 'אלקטרוניקה',        kind: 'oneoff',   need: 'discretionary' },
    { key: 'appliances',  label: 'מוצרי חשמל',        kind: 'oneoff',   need: 'discretionary' },
    { key: 'online',      label: 'שופינג אונליין',    kind: 'variable', need: 'discretionary' },
    { key: 'gifts',       label: 'מתנות',             kind: 'oneoff',   need: 'discretionary' },
    { key: 'general',     label: 'כללי — קניות',      kind: 'variable', need: 'discretionary' },
  ]},

  { key: 'leisure', label: 'פנאי ובידור', icon: '✈️', color: '#2d9cdb', flow: 'out', cats: [
    { key: 'domestic', label: 'נופש בארץ',            kind: 'oneoff',   need: 'discretionary' },
    { key: 'flights',  label: 'טיסות וחו״ל',          kind: 'oneoff',   need: 'discretionary' },
    { key: 'hotels',   label: 'מלונות',               kind: 'oneoff',   need: 'discretionary' },
    { key: 'events',   label: 'הופעות ואירועים',      kind: 'oneoff',   need: 'discretionary' },
    { key: 'learning', label: 'ספרים / קורסים / תחביבים', kind: 'variable', need: 'discretionary' },
    { key: 'nightout', label: 'יציאות וברים',         kind: 'variable', need: 'discretionary' },
    { key: 'general',  label: 'כללי — פנאי',          kind: 'variable', need: 'discretionary' },
  ]},

  { key: 'subs', label: 'מנויים ודיגיטל', icon: '📱', color: '#9b51e0', flow: 'out', cats: [
    { key: 'streaming', label: 'סטרימינג',           kind: 'fixed', need: 'discretionary' },
    { key: 'cloud',     label: 'ענן ואחסון',         kind: 'fixed', need: 'discretionary' },
    { key: 'ai',        label: 'כלי AI',             kind: 'fixed', need: 'discretionary' },
    { key: 'software',  label: 'תוכנה ו-SaaS',       kind: 'fixed', need: 'discretionary' },
    { key: 'cellular',  label: 'סלולר',              kind: 'fixed', need: 'essential' },
    { key: 'micro',     label: 'מיקרו-מנויים',       kind: 'fixed', need: 'discretionary' },
    { key: 'general',   label: 'כללי — מנויים',      kind: 'fixed', need: 'discretionary' },
  ]},

  { key: 'finance', label: 'פיננסים והתחייבויות', icon: '🏦', color: '#56ccf2', flow: 'out', cats: [
    { key: 'bankfees', label: 'עמלות בנק',              kind: 'fixed',  need: 'essential' },
    { key: 'cardfees', label: 'דמי כרטיס אשראי',        kind: 'fixed',  need: 'essential' },
    { key: 'interest', label: 'ריבית ומסגרת',           kind: 'fixed',  need: 'essential' },
    { key: 'loans',    label: 'החזרי הלוואות',          kind: 'fixed',  need: 'essential' },
    { key: 'insurance',label: 'ביטוח חיים / פנסיה / קה״ש', kind: 'fixed', need: 'essential' },
    { key: 'tax',      label: 'מיסים',                  kind: 'oneoff', need: 'essential' },
    { key: 'general',  label: 'כללי — פיננסים',         kind: 'fixed',  need: 'essential' },
  ]},

  { key: 'trading', label: 'מסחר ועסק', icon: '📈', color: '#00b894', flow: 'out', cats: [
    { key: 'commissions', label: 'עמלות ברוקר',        kind: 'variable', need: 'essential' },
    { key: 'platforms',   label: 'פלטפורמות מסחר',     kind: 'fixed',    need: 'essential' },
    { key: 'prop',        label: 'אתגרי Prop / resets', kind: 'variable', need: 'essential' },
    { key: 'data',        label: 'דאטה ופידים',        kind: 'fixed',    need: 'essential' },
    { key: 'servers',     label: 'שרתים / VPS',        kind: 'fixed',    need: 'essential' },
    { key: 'accounting',  label: 'רו״ח ועסקי',         kind: 'oneoff',   need: 'essential' },
    { key: 'general',     label: 'כללי — מסחר',        kind: 'variable', need: 'essential' },
  ]},

  { key: 'transfer', label: 'העברות — לא הוצאה', icon: '🔄', color: '#828282', flow: 'neutral', cats: [
    { key: 'p2p',        label: 'ביט / פייבוקס בין אנשים', kind: 'variable', need: 'essential' },
    { key: 'withdrawal', label: 'משיכת מזומן',            kind: 'variable', need: 'essential' },
    { key: 'internal',   label: 'העברה בין חשבונות',      kind: 'variable', need: 'essential' },
    { key: 'refund',     label: 'זיכוי / החזר כספי',      kind: 'oneoff',   need: 'essential' },
    { key: 'invest',     label: 'הפקדה להשקעות',          kind: 'fixed',    need: 'essential' },
    { key: 'general',    label: 'כללי — העברות',          kind: 'variable', need: 'essential' },
  ]},

  { key: 'income', label: 'הכנסות', icon: '💰', color: '#6fcf97', flow: 'in', cats: [
    { key: 'salary',   label: 'משכורת',              kind: 'fixed',    need: 'essential' },
    { key: 'payout',   label: 'רווחי מסחר / payout', kind: 'variable', need: 'essential' },
    { key: 'taxback',  label: 'החזרי מס',            kind: 'oneoff',   need: 'essential' },
    { key: 'side',     label: 'הכנסה צדדית',         kind: 'variable', need: 'essential' },
    { key: 'dividend', label: 'דיבידנדים וריבית',    kind: 'variable', need: 'essential' },
    { key: 'general',  label: 'כללי — הכנסות',       kind: 'variable', need: 'essential' },
  ]},
];

// שמונה הכפתורים במסך ההכנסה המהיר (זרע התחלתי — מסתדר מחדש לפי תדירות בפועל)
export const QUICK_SEED = [
  ['food', 'super'], ['food', 'restaurant'], ['food', 'coffee'], ['transport', 'fuel'],
  ['shopping', 'general'], ['home', 'general'], ['health', 'general'], ['leisure', 'general'],
];

export const KIND_LABEL  = { fixed: 'קבוע', variable: 'משתנה', oneoff: 'חד-פעמי' };
export const NEED_LABEL  = { essential: 'חיוני', discretionary: 'רשות' };
export const SCOPE_LABEL = { personal: 'פרטי', business: 'עסקי' };
export const METHOD_LABEL = {
  cash: 'מזומן', credit: 'אשראי', bank: 'העברה בנקאית',
  bit: 'ביט / פייבוקס', other: 'אחר',
};

const _deptMap = new Map(DEPTS.map(d => [d.key, d]));

export function dept(key) { return _deptMap.get(key) || null; }

export function cat(deptKey, catKey) {
  const d = _deptMap.get(deptKey);
  if (!d) return null;
  return d.cats.find(c => c.key === catKey) || null;
}

/** תווית קריאה "מחלקה › קטגוריה" */
export function pathLabel(deptKey, catKey) {
  const d = dept(deptKey);
  if (!d) return 'לא מסווג';
  const c = cat(deptKey, catKey);
  return c ? `${d.label} › ${c.label}` : d.label;
}

export function flowOf(deptKey) {
  return dept(deptKey)?.flow || 'out';
}

/** ברירות מחדל שנגזרות מהקטגוריה בלבד — הבסיס למילון הלומד */
export function defaultsFor(deptKey, catKey) {
  const c = cat(deptKey, catKey);
  return {
    kind: c?.kind || 'variable',
    need: c?.need || 'essential',
    scope: deptKey === 'trading' ? 'business' : 'personal',
  };
}

/** רשימה שטוחה "dept/cat — תווית" להזרקה לפרומפט של המודל */
export function flatForPrompt() {
  const out = [];
  for (const d of DEPTS)
    for (const c of d.cats)
      out.push(`${d.key}/${c.key} = ${d.label} › ${c.label}`);
  return out.join('\n');
}

export const DEPT_KEYS = DEPTS.map(d => d.key);
