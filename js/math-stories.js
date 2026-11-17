// ============================================================================
// APEX OVERDRIVE - Story questions that match what the crew is doing at the station.
// Built for 5th graders (ages 10-11): small clean numbers, one idea per question,
// a typical-mistake distractor, and a 2-step worked example for the AI tutor video.
// Patches window.mathEngine.generateQuestion(grade, context).
// context: 'fuel' | 'tires' | 'turbo' | 'suspension' | 'shield' | 'revive' | 'general'
// ============================================================================
(function () {
  const me = window.mathEngine;
  if (!me) return;

  const R = (a, b) => me.randInt(a, b);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);

  // Four answer options: the right one, the classic mistake, and two near misses.
  function buildOptions(correct, trap) {
    const set = new Set([correct]);
    if (trap !== undefined && trap !== correct && trap >= 0) set.add(trap);
    const offsets = [-10, -5, -2, -1, 1, 2, 5, 10];
    let guard = 0;
    while (set.size < 4 && guard++ < 60) {
      const cand = correct + pick(offsets);
      if (cand >= 0 && cand !== correct) set.add(cand);
    }
    return shuffle(Array.from(set));
  }

  // ---------- story makers: each returns a plain description ---------------
  // { topic, text, expr, ans, trap?, tip, steps:[[formula, explain],...] }
  const STORIES = {
    fuel: [
      () => {
        const r = R(6, 12), t = R(3, 9);
        return {
          topic: 'כפל: קצב כפול זמן',
          text: `המשאבה מזרימה ${r} ליטר בכל דקה. כמה ליטר דלק יזרמו ב-${t} דקות?`,
          expr: `${r} × ${t} = ?`, ans: r * t, trap: r + t,
          tip: 'כשמשהו חוזר שוב ושוב באותו גודל — כופלים! כל דקה זה אותו מספר ליטרים.',
          steps: [[`${r} × ${t} = ${r * t}`, `בכל דקה ${r} ליטר, ובמשך ${t} דקות מקבלים ${r} כפול ${t}.`]]
        };
      },
      () => {
        const cap = pick([40, 50, 60, 80]);
        const have = pick([10, 15, 20, 25, 30].filter(x => x < cap));
        return {
          topic: 'חיסור: כמה חסר?',
          text: `המיכל מחזיק ${cap} ליטר ויש בו כרגע ${have} ליטר. כמה ליטר חסרים כדי למלא אותו?`,
          expr: `${cap} − ${have} = ?`, ans: cap - have, trap: cap + have,
          tip: 'כשרוצים לדעת כמה חסר — מחסרים את מה שיש ממה שצריך.',
          steps: [[`${cap} − ${have} = ${cap - have}`, `מהמיכל המלא (${cap}) מורידים את מה שכבר יש (${have}).`]]
        };
      },
      () => {
        const p = R(3, 9), n = R(6, 14);
        return {
          topic: 'כפל: מחיר ליחידה',
          text: `ליטר דלק עולה ${p} מטבעות. כמה מטבעות עולים ${n} ליטרים?`,
          expr: `${p} × ${n} = ?`, ans: p * n, trap: p + n,
          tip: 'פרקו את המספר הגדול: חלק אחד פשוט ועוד מה שנשאר, ואז חברו.',
          steps: n > 10
            ? [
                [`${p} × 10 = ${p * 10}`, `קודם 10 ליטרים עולים ${p * 10}.`],
                [`${p * 10} + ${p} × ${n - 10} = ${p * n}`, `מוסיפים את ${n - 10} הליטרים שנשארו, ומקבלים ${p * n}.`]
              ]
            : [
                [`${p} × 5 = ${p * 5}`, `קודם 5 ליטרים עולים ${p * 5}.`],
                [`${p * 5} + ${p} × ${n - 5} = ${p * n}`, `מוסיפים את ${n - 5} הליטרים שנשארו, ומקבלים ${p * n}.`]
              ]
        };
      },
      () => {
        const k = R(3, 8), q = R(6, 12);
        return {
          topic: 'חילוק: חלוקה שווה',
          text: `${k * q} ליטר דלק מתחלקים שווה בשווה בין ${k} מכוניות. כמה ליטר מקבלת כל מכונית?`,
          expr: `${k * q} ÷ ${k} = ?`, ans: q, trap: k * q - k,
          tip: 'חלוקה שווה = חילוק. חשבו: ' + k + ' כפול איזה מספר נותן ' + (k * q) + '?',
          steps: [[`${k} × ${q} = ${k * q}`, `בודקים: ${k} כפול ${q} שווה ${k * q}, אז ${k * q} לחלק ל-${k} הוא ${q}.`]]
        };
      },
      () => {
        const cap = pick([40, 60, 80, 100]);
        const frac = pick([['חצי', 2], ['רבע', 4]]);
        return {
          topic: 'שברים: חצי ורבע',
          text: `הצוות מילא ${frac[0]} ממיכל של ${cap} ליטר. כמה ליטר מילאו?`,
          expr: `${cap} ÷ ${frac[1]} = ?`, ans: cap / frac[1], trap: cap / (frac[1] === 2 ? 4 : 2),
          tip: frac[0] + ' זה חילוק ב-' + frac[1] + '.',
          steps: [[`${cap} ÷ ${frac[1]} = ${cap / frac[1]}`, `${frac[0]} מתוך ${cap} הוא ${cap} לחלק ל-${frac[1]}.`]]
        };
      }
    ],

    tires: [
      () => {
        const n = R(6, 14);
        return {
          topic: 'כפל ב-4',
          text: `לכל מכונית יש 4 גלגלים. כמה גלגלים הצוות צריך להחליף ב-${n} מכוניות?`,
          expr: `4 × ${n} = ?`, ans: 4 * n, trap: n + 4,
          tip: 'כפל ב-4 קל: מכפילים פעמיים. כפול 2, ועוד פעם כפול 2.',
          steps: [[`${n} × 2 = ${n * 2},  ${n * 2} × 2 = ${n * 4}`, `מכפילים פעמיים ב-2 ומקבלים ${n * 4}.`]]
        };
      },
      () => {
        const b = R(4, 8);
        return {
          topic: 'כפל: ברגים בגלגלים',
          text: `בכל גלגל ${b} ברגים. כמה ברגים צריך להבריג בכל 4 הגלגלים?`,
          expr: `${b} × 4 = ?`, ans: b * 4, trap: b + 4,
          tip: 'ארבעה גלגלים, בכל אחד אותו מספר ברגים — כופלים.',
          steps: [[`${b} × 4 = ${b * 4}`, `${b} ברגים בגלגל, ארבע פעמים.`]]
        };
      },
      () => {
        const p = pick([15, 20, 25, 30, 35, 40, 45]);
        return {
          topic: 'כפל: מחיר ארבעה צמיגים',
          text: `צמיג אחד עולה ${p} מטבעות. כמה עולים 4 צמיגים?`,
          expr: `${p} × 4 = ?`, ans: p * 4, trap: p + 4,
          tip: 'מכפילים פעמיים: קודם כפול 2 ואז שוב כפול 2.',
          steps: [[`${p} × 2 = ${p * 2},  ${p * 2} × 2 = ${p * 4}`, `${p} כפול 2 הוא ${p * 2}, ושוב כפול 2 הוא ${p * 4}.`]]
        };
      },
      () => {
        const a = R(20, 40), b = R(6, 15);
        return {
          topic: 'חיסור: כמה נשארו?',
          text: `במחסן יש ${a} צמיגים. הצוות לקח ${b} צמיגים להחלפה. כמה צמיגים נשארו?`,
          expr: `${a} − ${b} = ?`, ans: a - b, trap: a + b,
          tip: 'לקחו = פחות. מחסרים את מה שנלקח ממה שהיה.',
          steps: [[`${a} − ${b} = ${a - b}`, `היו ${a}, לקחו ${b}, נשארו ${a - b}.`]]
        };
      },
      () => {
        const k = R(3, 6), q = R(4, 9);
        return {
          topic: 'חילוק: חלוקת ברגים',
          text: `יש ${k * q} ברגים לחלוקה שווה בין ${k} גלגלים. כמה ברגים לכל גלגל?`,
          expr: `${k * q} ÷ ${k} = ?`, ans: q, trap: k * q - k,
          tip: 'חלוקה שווה = חילוק.',
          steps: [[`${k} × ${q} = ${k * q}`, `${k} כפול ${q} נותן ${k * q}, לכן כל גלגל מקבל ${q}.`]]
        };
      }
    ],

    turbo: [
      () => {
        const a = R(12, 25), s = R(3, 6);
        return {
          topic: 'כפל: האצה בכל שנייה',
          text: `הטורבו מוסיף ${a} קמ״ש בכל שנייה. כמה קמ״ש יוסיף אחרי ${s} שניות?`,
          expr: `${a} × ${s} = ?`, ans: a * s, trap: a + s,
          tip: 'אותה תוספת בכל שנייה — כופלים בזמן.',
          steps: [[`${a} × ${s} = ${a * s}`, `${a} קמ״ש בכל שנייה, ${s} שניות.`]]
        };
      },
      () => {
        const v = R(120, 180), a = R(25, 60);
        return {
          topic: 'חיבור: מהירות חדשה',
          text: `הרכב נוסע ב-${v} קמ״ש והטורבו מוסיף ${a} קמ״ש. מה המהירות החדשה?`,
          expr: `${v} + ${a} = ?`, ans: v + a, trap: v - a,
          tip: 'מוסיף = חיבור. חברו קודם את העשרות, ואז את היחידות.',
          steps: [[`${v} + ${a} = ${v + a}`, `מהמהירות ${v} מוסיפים ${a} ומקבלים ${v + a}.`]]
        };
      },
      () => {
        const a = R(5, 20), b = R(3, 8), c = R(3, 7);
        return {
          topic: 'סדר פעולות: כפל לפני חיבור',
          text: `הצוות מתקין ${b} סוללות בכל אחד מ-${c} תאים, ועוד ${a} סוללות רזרבה. כמה סוללות בסך הכל?`,
          expr: `${a} + ${b} × ${c} = ?`, ans: a + b * c, trap: (a + b) * c,
          tip: 'כפל קודם! קודם מחשבים ' + b + ' × ' + c + ', ורק אחר כך מוסיפים.',
          steps: [
            [`${b} × ${c} = ${b * c}`, `קודם הכפל: ${b} סוללות בכל תא, ${c} תאים.`],
            [`${b * c} + ${a} = ${a + b * c}`, `ועכשיו מוסיפים את ${a} סוללות הרזרבה.`]
          ]
        };
      }
    ],

    suspension: [
      () => {
        const k = R(2, 4), n = R(4, 9);
        return {
          topic: 'כפל: קפיצים בבולמים',
          text: `בכל בולם יש ${k} קפיצים. כמה קפיצים צריך ל-${n} בולמים?`,
          expr: `${k} × ${n} = ?`, ans: k * n, trap: k + n,
          tip: 'כל בולם מקבל אותו מספר קפיצים — כופלים.',
          steps: [[`${k} × ${n} = ${k * n}`, `${k} קפיצים בכל בולם, ${n} בולמים.`]]
        };
      },
      () => {
        const a = R(12, 30), b = R(10, 25), c = R(5, 15);
        return {
          topic: 'חיבור שלושה מספרים',
          text: `הצוות מחליף ${a} ברגים, ${b} אומים ו-${c} דסקיות. כמה חלקים החליפו ביחד?`,
          expr: `${a} + ${b} + ${c} = ?`, ans: a + b + c, trap: a + b,
          tip: 'חברו שני מספרים ואז הוסיפו את השלישי.',
          steps: [[`${a} + ${b} = ${a + b},  ${a + b} + ${c} = ${a + b + c}`, `קודם ${a} ועוד ${b}, ואז מוסיפים ${c}.`]]
        };
      },
      () => {
        const k = R(3, 6), q = R(5, 12);
        return {
          topic: 'חילוק: מוט ארוך',
          text: `מוט באורך ${k * q} ס״מ נחתך ל-${k} חלקים שווים. מה אורך כל חלק?`,
          expr: `${k * q} ÷ ${k} = ?`, ans: q, trap: k * q - k,
          tip: 'חלקים שווים = חילוק.',
          steps: [[`${k} × ${q} = ${k * q}`, `${k} חלקים באורך ${q} נותנים ${k * q}, לכן כל חלק ${q} ס״מ.`]]
        };
      }
    ],

    shield: [
      () => {
        const r = R(3, 7), c = R(4, 9);
        return {
          topic: 'כפל: שורות ועמודות',
          text: `מגן האנרגיה בנוי מ-${r} שורות, ובכל שורה ${c} משושים. כמה משושים יש במגן?`,
          expr: `${r} × ${c} = ?`, ans: r * c, trap: r + c,
          tip: 'שורות כפול עמודות נותן את כל הלוחיות.',
          steps: [[`${r} × ${c} = ${r * c}`, `${r} שורות, בכל אחת ${c} משושים.`]]
        };
      },
      () => {
        const l = R(4, 9), w = R(2, 5);
        return {
          topic: 'היקף מלבן',
          text: `המגן הוא מלבן באורך ${l} מ׳ וברוחב ${w} מ׳. מה היקף המגן (סכום כל הצלעות)?`,
          expr: `${l} + ${w} + ${l} + ${w} = ?`, ans: 2 * (l + w), trap: l * w,
          tip: 'היקף = חיבור כל ארבע הצלעות: שתי צלעות ארוכות ושתי קצרות.',
          steps: [[`${l} + ${w} = ${l + w},  ${l + w} × 2 = ${2 * (l + w)}`, `מחברים אורך ורוחב ומכפילים ב-2.`]]
        };
      },
      () => {
        const l = R(4, 9), w = R(3, 6);
        return {
          topic: 'שטח מלבן',
          text: `לוח המגן הוא מלבן באורך ${l} מ׳ וברוחב ${w} מ׳. מה שטח הלוח במטרים רבועים?`,
          expr: `${l} × ${w} = ?`, ans: l * w, trap: 2 * (l + w),
          tip: 'שטח = אורך כפול רוחב.',
          steps: [[`${l} × ${w} = ${l * w}`, `שטח מלבן הוא אורך כפול רוחב.`]]
        };
      }
    ],

    revive: [
      () => {
        const a = R(4, 9), b = R(4, 9), c = R(3, 20);
        return {
          topic: 'סדר פעולות עם חיסור',
          text: 'כדי להתניע מחדש את המנוע פותרים את המעגל החשמלי:',
          expr: `${a} × ${b} − ${c} = ?`, ans: a * b - c, trap: a * (b - c),
          tip: 'כפל קודם, חיסור אחר כך.',
          steps: [
            [`${a} × ${b} = ${a * b}`, 'קודם מחשבים את הכפל.'],
            [`${a * b} − ${c} = ${a * b - c}`, `ואז מחסרים ${c}.`]
          ]
        };
      },
      () => {
        const a = R(12, 25), b = R(3, 6);
        return {
          topic: 'כפל דו-ספרתי בפירוק',
          text: 'המנוע נדלק כשמכפילים נכון. כמה זה:',
          expr: `${a} × ${b} = ?`, ans: a * b, trap: a + b,
          tip: 'פרקו את ' + a + ' לעשרות ויחידות וכפלו כל חלק.',
          steps: [
            [`${Math.floor(a / 10) * 10} × ${b} = ${Math.floor(a / 10) * 10 * b}`, 'קודם העשרות.'],
            [`${Math.floor(a / 10) * 10 * b} + ${a % 10} × ${b} = ${a * b}`, 'ואז מוסיפים את היחידות כפול המספר.']
          ]
        };
      }
    ]
  };

  STORIES.general = [].concat(STORIES.fuel, STORIES.tires, STORIES.turbo, STORIES.suspension, STORIES.shield);

  let lastExpr = '';

  function makeStoryQuestion(context) {
    const pool = STORIES[context] || STORIES.general;
    let s, guard = 0;
    do { s = pick(pool)(); } while (s.expr === lastExpr && guard++ < 8);
    lastExpr = s.expr;

    // A second, different example for the tutor video.
    let ex, g2 = 0;
    do { ex = pick(pool)(); } while ((ex.expr === s.expr || ex.topic !== s.topic) && g2++ < 20);
    if (!ex || ex.topic !== s.topic) ex = s;

    const steps = ex.steps.map((st, i) => ({
      label: `שלב ${i + 1}`,
      formula: st[0],
      explain: st[1]
    }));
    steps.push({
      label: 'עכשיו תורך',
      formula: s.expr.replace('?', '…'),
      explain: 'עכשיו עשו אותו דבר עם המספרים של השאלה שלכם.'
    });

    return {
      topic: s.topic,
      prompt: s.text,
      expression: s.expr,
      answer: s.ans,
      options: buildOptions(s.ans, s.trap),
      isStory: true,
      similar: {
        title: `איך פותרים: ${s.topic}`,
        exampleExpr: ex.expr.replace(' = ?', ''),
        aiTip: s.tip,
        steps
      }
    };
  }

  // Kids never see negative or zero distractors from the classic templates either.
  me.buildOptions = function (correct) {
    return buildOptions(correct);
  };

  const classic = me.generateQuestion.bind(me);
  me.generateQuestion = function (grade = 'junior', context = 'general') {
    const storyChance = grade === 'junior' ? 0.8 : grade === 'mid' ? 0.4 : 0;
    if (Math.random() < storyChance) return makeStoryQuestion(context);
    return classic(grade);
  };
})();
