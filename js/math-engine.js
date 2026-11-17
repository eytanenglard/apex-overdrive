// ============================================================================
// APEX OVERDRIVE - Adaptive Math Engine & AI Animated Video Tutor
// Designed for older kids/teens (Grades 4-9) with tactical telemetry framing
// ============================================================================

class MathEngine {
  constructor() {
    this.animFrame = null;
    this.videoStep = 0;
    this.videoProgress = 0;
    this.isPlayingVideo = false;
    this.currentSimilar = null;
  }

  randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  buildOptions(correct) {
    const set = new Set([correct]);
    const offsets = [-12, -10, -6, -4, -3, -2, -1, 1, 2, 3, 4, 6, 10, 12];
    while (set.size < 4) {
      const off = offsets[Math.floor(Math.random() * offsets.length)];
      const candidate = correct + off;
      if (candidate !== correct && candidate >= -50) {
        set.add(candidate);
      }
    }
    return Array.from(set).sort(() => Math.random() - 0.5);
  }

  generateQuestion(gradeLevel = 'mid') {
    const templates = this.getTemplatesForGrade(gradeLevel);
    const chosen = templates[Math.floor(Math.random() * templates.length)];
    return chosen.call(this);
  }

  getTemplatesForGrade(grade) {
    if (grade === 'junior') {
      return [
        this.tplOrderOfOpsBasic,
        this.tplMultiplyTwoDigit,
        this.tplDivisionClean,
        this.tplMissingFactor
      ];
    }
    if (grade === 'senior') {
      return [
        this.tplLinearEquation,
        this.tplPowersAndOps,
        this.tplPercentageFuel,
        this.tplTwoSideEquation
      ];
    }
    // Default 'mid' (Grades 6-7)
    return [
      this.tplOrderOfOpsBasic,
      this.tplLinearEquation,
      this.tplPercentageFuel,
      this.tplMultiplyTwoDigit,
      this.tplPowersAndOps
    ];
  }

  // 1. Order of Operations: A + B × C
  tplOrderOfOpsBasic() {
    const a = this.randInt(8, 35);
    const b = this.randInt(4, 12);
    const c = this.randInt(3, 9);
    const ans = a + b * c;

    // Similar problem with different numbers for AI Video Tutor
    const sa = a + 4;
    const sb = b + 1;
    const sc = c === 5 ? 4 : 5;
    const sMult = sb * sc;
    const sAns = sa + sMult;

    return {
      topic: 'סדר פעולות חשבון (כפל לפני חיבור)',
      prompt: 'חשב את עוצמת ההזרקה לפי סדר פעולות חשבון:',
      expression: `${a} + ${b} × ${c} = ?`,
      answer: ans,
      options: this.buildOptions(ans),
      similar: {
        title: 'פתרון תרגיל דומה בסדר פעולות חשבון',
        exampleExpr: `${sa} + ${sb} × ${sc}`,
        aiTip: 'כלל ברזל בהנדסת מרוצים: פעולת כפל (×) תמיד קודמת לפעולת חיבור (+), גם אם החיבור מופיע ראשון משמאל!',
        steps: [
          {
            label: 'שלב 1: מזהים את הכפל קודם',
            formula: `${sb} × ${sc} = ${sMult}`,
            explain: `מתחילים מתרגיל הכפל: מכפילים ${sb} ב-${sc} ומקבלים ${sMult}.`
          },
          {
            label: 'שלב 2: מחברים את המספר הראשון',
            formula: `${sa} + ${sMult} = ${sAns}`,
            explain: `כעת מוסיפים את ${sa} לתוצאת הכפל (${sMult}) ומקבלים ${sAns}.`
          },
          {
            label: 'שלב 3: מישמים על התרגיל שלך!',
            formula: `${a} + (${b} × ${c}) = ?`,
            explain: `עכשיו תורך: קודם חשב כמה זה ${b} כפול ${c}, ואז הוסף לתוצאה ${a}!`
          }
        ]
      }
    };
  }

  // 2. Linear Equation: A*x + B = C
  tplLinearEquation() {
    const a = this.randInt(2, 7);
    const x = this.randInt(3, 12);
    const b = this.randInt(4, 20);
    const c = a * x + b;

    // Similar problem
    const sa = 3;
    const sx = 6;
    const sb = 7;
    const sc = sa * sx + sb; // 25

    return {
      topic: 'משוואה בנעלם אחד (אלגברה)',
      prompt: 'מצא את ערך ה-X לכיול לחץ הטורבו:',
      expression: `${a}x + ${b} = ${c}   ⇒   x = ?`,
      answer: x,
      options: this.buildOptions(x),
      similar: {
        title: 'איך פותרים משוואה מהצורה ax + b = c?',
        exampleExpr: `${sa}x + ${sb} = ${sc}`,
        aiTip: 'כדי לבודד את x, מבצעים פעולות הפוכות: קודם מחסרים את המספר החופשי משני האגפים, ורק אז מחלקים במקדם של x.',
        steps: [
          {
            label: 'שלב 1: העברת המספר החופשי בחיסור',
            formula: `${sa}x = ${sc} - ${sb} = ${sc - sb}`,
            explain: `מחסרים ${sb} משני האגפים: ${sc} פחות ${sb} שווה ${sc - sb}.`
          },
          {
            label: 'שלב 2: חילוק במקדם של x',
            formula: `x = ${sc - sb} ÷ ${sa} = ${sx}`,
            explain: `מחלקים את ${sc - sb} במקדם ${sa} ומקבלים x = ${sx}.`
          },
          {
            label: 'שלב 3: פתור את המשוואה שלך!',
            formula: `(${c} - ${b}) ÷ ${a} = x`,
            explain: `בתרגיל שלך: חסר ${b} מתוך ${c}, ואת התוצאה חלק ב-${a}!`
          }
        ]
      }
    };
  }

  // 3. Percentages: P% of N
  tplPercentageFuel() {
    const percents = [10, 20, 25, 50, 75];
    const p = percents[Math.floor(Math.random() * percents.length)];
    const mult = this.randInt(2, 9);
    const total = p === 25 || p === 75 ? mult * 40 : mult * 20;
    const ans = (p / 100) * total;

    // Similar problem
    const sp = p;
    const sTotal = p === 25 || p === 75 ? 120 : 80;
    const sAns = (sp / 100) * sTotal;

    return {
      topic: 'חישוב אחוזים מהיר',
      prompt: `חשב כמה ליטר דלק אוקטן הם ${p}% מהמיכל:`,
      expression: `${p}% מתוך ${total} = ?`,
      answer: ans,
      options: this.buildOptions(ans),
      similar: {
        title: `איך מחשבים ${sp}% ממספר במהירות בראש?`,
        exampleExpr: `${sp}% מתוך ${sTotal}`,
        aiTip:
          sp === 25
            ? 'טריק של מקצוענים: 25% הם בדיוק רבע (1/4) מהמספר! פשוט מחלקים ב-4.'
            : sp === 50
            ? 'טריק של מקצוענים: 50% הם בדיוק חצי (1/2) מהמספר! פשוט מחלקים ב-2.'
            : sp === 75
            ? 'טריק של מקצוענים: מוצאים קודם רבע (חילוק ב-4) ואז כופלים ב-3!'
            : 'טריק של מקצוענים: 10% זה פשוט לחלק ב-10 (להוריד אפס), ואז כופלים לפי הצורך!',
        steps: [
          {
            label: 'שלב 1: הופכים את האחוז לפעולה פשוטה',
            formula: `${sp}% = ${sp} / 100`,
            explain: `אחוז פירושו חלק מתוך מאה. למשל עבור ${sTotal}:`
          },
          {
            label: 'שלב 2: מבצעים את החישוב המקוצר',
            formula: `(${sTotal} × ${sp}) ÷ 100 = ${sAns}`,
            explain: `כאשר מחשבים ${sp}% מתוך ${sTotal}, התוצאה היא ${sAns}.`
          },
          {
            label: 'שלב 3: עכשיו על המספר שלך!',
            formula: `${p}% מתוך ${total} = ?`,
            explain: `השתמש באותו קיצור דרך על המספר ${total}!`
          }
        ]
      }
    };
  }

  // 4. Smart Multiplication decomposition: e.g. 14 × 6
  tplMultiplyTwoDigit() {
    const a = this.randInt(12, 18);
    const b = this.randInt(4, 8);
    const ans = a * b;

    const sa = 15;
    const sb = 6;
    const sAns = sa * sb;

    return {
      topic: 'כפל חכם בפירוק לעשרות ויחידות',
      prompt: 'חשב את תפוקת המנוע הכוללת:',
      expression: `${a} × ${b} = ?`,
      answer: ans,
      options: this.buildOptions(ans),
      similar: {
        title: 'שיטת הפירוק לכפל דו-ספרתי בראש',
        exampleExpr: `${sa} × ${sb}`,
        aiTip: 'במקום להסתבך בכפל ארוך, מפרקים את המספר הגדול לעשרות + יחידות, כופלים כל חלק בנפרד ומחברים!',
        steps: [
          {
            label: 'שלב 1: מפרקים לעשרות ויחידות',
            formula: `${sa} = 10 + ${sa - 10}`,
            explain: `מפרקים את ${sa} ל-10 ועוד ${sa - 10}.`
          },
          {
            label: 'שלב 2: כופלים כל חלק ומחברים',
            formula: `(10 × ${sb}) + (${sa - 10} × ${sb}) = ${10 * sb} + ${(sa - 10) * sb} = ${sAns}`,
            explain: `10 כפול ${sb} זה ${10 * sb}, ועוד ${sa - 10} כפול ${sb} שזה ${(sa - 10) * sb}. ביחד: ${sAns}!`
          },
          {
            label: 'שלב 3: נסה על התרגיל שלך!',
            formula: `(10 × ${b}) + (${a - 10} × ${b}) = ?`,
            explain: `פרק את ${a} ל-10 ועוד ${a - 10}, הכפל כל אחד ב-${b} וחבר!`
          }
        ]
      }
    };
  }

  // 5. Clean Division
  tplDivisionClean() {
    const divisor = this.randInt(4, 11);
    const ans = this.randInt(6, 15);
    const dividend = divisor * ans;

    const sDivisor = 6;
    const sAns = 13;
    const sDividend = sDivisor * sAns; // 78

    return {
      topic: 'חילוק מדויק באמצעות פירוק',
      prompt: 'חלק את האנרגיה שווה בשווה בין תאי הדלק:',
      expression: `${dividend} ÷ ${divisor} = ?`,
      answer: ans,
      options: this.buildOptions(ans),
      similar: {
        title: 'איך מחלקים מספר גדול בקלות?',
        exampleExpr: `${sDividend} ÷ ${sDivisor}`,
        aiTip: 'חילוק הוא הפעולה ההפוכה לכפל! אפשר לפרק את המספר לכפולה של 10 ועוד השארית.',
        steps: [
          {
            label: 'שלב 1: מפרישים כפולה עגולה של 10',
            formula: `${sDividend} = ${sDivisor * 10} + ${sDividend - sDivisor * 10}`,
            explain: `אנחנו יודעים ש-${sDivisor} כפול 10 זה ${sDivisor * 10}. נשאר עוד ${sDividend - sDivisor * 10}.`
          },
          {
            label: 'שלב 2: מחלקים כל חלק ומחברים',
            formula: `10 + (${sDividend - sDivisor * 10} ÷ ${sDivisor}) = 10 + 3 = ${sAns}`,
            explain: `${sDividend - sDivisor * 10} לחלק ל-${sDivisor} שווה 3. יחד עם ה-10 מקבלים ${sAns}!`
          },
          {
            label: 'שלב 3: חשב בתרגיל שלך!',
            formula: `${dividend} ÷ ${divisor} = ?`,
            explain: `שאל את עצמך: ${divisor} כפול איזה מספר נותן ${dividend}?`
          }
        ]
      }
    };
  }

  // 6. Missing Factor
  tplMissingFactor() {
    const a = this.randInt(5, 12);
    const ans = this.randInt(4, 12);
    const b = this.randInt(10, 30);
    const total = a * ans + b;

    const sa = 6;
    const sAns = 5;
    const sb = 12;
    const sTotal = sa * sAns + sb; // 42

    return {
      topic: 'מציאת גורם חסר במשוואה',
      prompt: 'השלם את המספר החסר בנוסחת ההאצה:',
      expression: `${a} × [ ? ] + ${b} = ${total}`,
      answer: ans,
      options: this.buildOptions(ans),
      similar: {
        title: 'מציאת המספר החסר שלב אחר שלב',
        exampleExpr: `${sa} × [ ? ] + ${sb} = ${sTotal}`,
        aiTip: 'עובדים מהסוף להתחלה: קודם מורידים את התוספת (+), ואז מחלקים!',
        steps: [
          {
            label: 'שלב 1: מחסרים את התוספת',
            formula: `${sTotal} - ${sb} = ${sTotal - sb}`,
            explain: `קודם מחסרים ${sb} מתוך ${sTotal} ומקבלים ${sTotal - sb}.`
          },
          {
            label: 'שלב 2: מחלקים כדי למצוא את המספר החסר',
            formula: `${sTotal - sb} ÷ ${sa} = ${sAns}`,
            explain: `כעת מחלקים ${sTotal - sb} ב-${sa} ומגלים שהמספר החסר הוא ${sAns}!`
          },
          {
            label: 'שלב 3: יישם בתרגיל שלך!',
            formula: `(${total} - ${b}) ÷ ${a} = ?`,
            explain: `חסר ${b} מ-${total}, וחלק את התוצאה ב-${a}.`
          }
        ]
      }
    };
  }

  // 7. Powers & Operations: A² + B × C
  tplPowersAndOps() {
    const base = this.randInt(3, 9);
    const b = this.randInt(2, 7);
    const c = this.randInt(3, 8);
    const ans = base * base + b * c;

    const sBase = 5;
    const sb = 4;
    const sc = 3;
    const sAns = 25 + 12;

    return {
      topic: 'חזקות וסדר פעולות חשבון',
      prompt: 'חשב את דחף הסילון (זכור: חזקה קודמת לכפל ולחיבור):',
      expression: `${base}² + ${b} × ${c} = ?`,
      answer: ans,
      options: this.buildOptions(ans),
      similar: {
        title: 'איך פותרים תרגיל עם חזקה וכפל?',
        exampleExpr: `${sBase}² + ${sb} × ${sc}`,
        aiTip: 'חזקה כמו 5² פירושה שהמספר כופל את עצמו (5×5 = 25), והיא מתבצעת לפני כפל וחיבור!',
        steps: [
          {
            label: 'שלב 1: מחשבים את החזקה',
            formula: `${sBase}² = ${sBase} × ${sBase} = ${sBase * sBase}`,
            explain: `מעלים בריבוע: ${sBase} כפול עצמו שווה ${sBase * sBase}.`
          },
          {
            label: 'שלב 2: מחשבים את הכפל ומחברים',
            formula: `${sBase * sBase} + (${sb} × ${sc}) = ${sBase * sBase} + ${sb * sc} = ${sAns}`,
            explain: `כופלים ${sb} ב-${sc} (=${sb * sc}) ומחברים ל-${sBase * sBase} לקבלת ${sAns}.`
          },
          {
            label: 'שלב 3: חשב בתרגיל שלך!',
            formula: `(${base} × ${base}) + (${b} × ${c}) = ?`,
            explain: `חשב כמה זה ${base} כפול ${base}, והוסף לזה את המכפלה של ${b} ב-${c}!`
          }
        ]
      }
    };
  }

  // 8. Two-Sided Equation: A*x - B = C*x + D
  tplTwoSideEquation() {
    const c = this.randInt(2, 4);
    const diff = this.randInt(2, 4);
    const a = c + diff;
    const x = this.randInt(3, 10);
    const b = this.randInt(2, 12);
    const d = diff * x - b;

    const sa = 5;
    const sc = 2;
    const sx = 4;
    const sb = 3;
    const sd = (sa - sc) * sx - sb; // 9

    return {
      topic: 'משוואה עם נעלמים בשני האגפים',
      prompt: 'אזן את שני מנועי הפלזמה ומצא את X:',
      expression: `${a}x - ${b} = ${c}x + ${d}   ⇒   x = ?`,
      answer: x,
      options: this.buildOptions(x),
      similar: {
        title: 'פתרון משוואה עם X בשני הצדדים',
        exampleExpr: `${sa}x - ${sb} = ${sc}x + ${sd}`,
        aiTip: 'מרכזים את כל ה-X בצד אחד (על ידי חיסור) ואת כל המספרים הרגילים בצד השני!',
        steps: [
          {
            label: 'שלב 1: מעבירים את ה-X לאגף שמאל',
            formula: `(${sa} - ${sc})x - ${sb} = ${sd}  ⇒  ${sa - sc}x - ${sb} = ${sd}`,
            explain: `מחסרים ${sc}x משני האגפים ומקבלים ${sa - sc}x.`
          },
          {
            label: 'שלב 2: מעבירים מספרים לאגף ימין ומחלקים',
            formula: `${sa - sc}x = ${sd} + ${sb} = ${sd + sb}  ⇒  x = ${sd + sb} ÷ ${sa - sc} = ${sx}`,
            explain: `מוסיפים ${sb} ל-${sd} (=${sd + sb}) ומחלקים ב-${sa - sc} לקבלת x = ${sx}.`
          },
          {
            label: 'שלב 3: פתור את המשוואה שלך!',
            formula: `(${a} - ${c})x = ${d} + ${b}`,
            explain: `חבר ${d} ועוד ${b}, וחלק בהפרש המקדמים (${a} פחות ${c})!`
          }
        ]
      }
    };
  }

  // ==========================================================================
  // Interactive Animated Video Player for Similar Math Problem
  // ==========================================================================
  startVideoTutorial(similarObj, canvasEl, stepChangeCallback) {
    this.stopVideoTutorial();
    this.currentSimilar = similarObj;
    this.videoStep = 0;
    this.videoProgress = 0;
    this.isPlayingVideo = true;
    this.onStepChange = stepChangeCallback;

    this.speakCurrentStep();

    const renderLoop = () => {
      if (!canvasEl) return;
      const ctx = canvasEl.getContext('2d');
      const w = (canvasEl.width = canvasEl.clientWidth || 640);
      const h = (canvasEl.height = canvasEl.clientHeight || 220);

      if (this.isPlayingVideo) {
        this.videoProgress += 0.0055;
        if (this.videoProgress >= 1) {
          if (this.videoStep < this.currentSimilar.steps.length - 1) {
            this.videoStep++;
            this.videoProgress = 0;
            if (this.onStepChange) this.onStepChange(this.videoStep);
            this.speakCurrentStep();
          } else {
            this.videoProgress = 1;
            this.isPlayingVideo = false;
          }
        }
      }

      this.drawVideoFrame(ctx, w, h);
      this.animFrame = requestAnimationFrame(renderLoop);
    };

    this.animFrame = requestAnimationFrame(renderLoop);
  }

  setVideoStep(stepIdx) {
    if (!this.currentSimilar) return;
    this.videoStep = Math.max(0, Math.min(this.currentSimilar.steps.length - 1, stepIdx));
    this.videoProgress = 0;
    this.isPlayingVideo = true;
    if (this.onStepChange) this.onStepChange(this.videoStep);
    this.speakCurrentStep();
  }

  toggleVideoPlay() {
    this.isPlayingVideo = !this.isPlayingVideo;
    if (this.isPlayingVideo && this.videoProgress >= 1) {
      this.videoStep = 0;
      this.videoProgress = 0;
      this.speakCurrentStep();
    }
    return this.isPlayingVideo;
  }

  speakCurrentStep() {
    if (!window.speechSynthesis || !this.currentSimilar) return;
    try {
      window.speechSynthesis.cancel();
      const step = this.currentSimilar.steps[this.videoStep];
      if (!step) return;
      const utter = new SpeechSynthesisUtterance(`${step.label}. ${step.explain}`);
      utter.lang = 'he-IL';
      utter.rate = 1.02;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

  stopVideoTutorial() {
    this.isPlayingVideo = false;
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  }

  drawVideoFrame(ctx, w, h) {
    if (!this.currentSimilar) return;
    const step = this.currentSimilar.steps[this.videoStep] || this.currentSimilar.steps[0];

    // Background cyber grid
    ctx.fillStyle = '#060a18';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.lineWidth = 1;
    const gridOffset = (performance.now() * 0.02) % 28;
    for (let x = gridOffset; x < w; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Top banner inside video
    ctx.fillStyle = 'rgba(181, 55, 242, 0.22)';
    ctx.fillRect(0, 0, w, 38);
    ctx.fillStyle = '#00f0ff';
    ctx.font = '700 14px Rubik, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`🎬 הדגמת AI חיה | תרגיל דומה: ${this.currentSimilar.exampleExpr}`, w - 16, 24);

    // Step Title
    ctx.fillStyle = '#ffd700';
    ctx.font = '800 17px Rubik, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(step.label, w / 2, 68);

    // Animated Formula Box
    const revealRatio = Math.min(1, this.videoProgress * 2.2);
    const boxW = Math.min(w - 40, 460);
    const boxX = (w - boxW) / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(14, 25, 56, 0.92)';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(boxX, 82, boxW, 56, 12);
    ctx.fill();
    ctx.stroke();

    // Formula text LTR
    ctx.direction = 'ltr';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 24px Orbitron, Rubik, sans-serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.25 + 0.75 * revealRatio;
    ctx.fillText(step.formula, w / 2, 118);
    ctx.restore();

    // Subtitle explanation bar
    ctx.direction = 'rtl';
    ctx.fillStyle = '#d8e6ff';
    ctx.font = '500 15px Rubik, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(step.explain, w / 2, 172);

    // Bottom progress bar
    const totalProgress = (this.videoStep + this.videoProgress) / this.currentSimilar.steps.length;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, h - 6, w, 6);
    ctx.fillStyle = '#b537f2';
    ctx.fillRect(0, h - 6, w * totalProgress, 6);
  }
}

window.mathEngine = new MathEngine();
