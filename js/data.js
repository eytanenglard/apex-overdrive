// ============================================================================
// APEX OVERDRIVE 3D - Realistic International Vehicles, 3D Worlds & Economy
// ============================================================================

const VEHICLES = [
  {
    id: 'cyber_ninja',
    name: 'קאוואסאקי בלייז ZX-10R',
    enName: 'KAWASAKI BLAZE ZX-10R',
    kind: 'bike',
    kindLabel: 'אופנוע סופרבייק 1000 סמ״ק',
    price: 0,
    color: '#00e676',
    secondaryColor: '#111827',
    stats: {
      speed: 86,
      accel: 92,
      airControl: 96,
      fuelCap: 80,
      durability: 78
    },
    desc: 'אופנוע סופרבייק מקצועי עם השכבה אמיתית בסיבובים, האצה מתפרצת ושליטה מלאה בסלטות באוויר.'
  },
  {
    id: 'apex_viper',
    name: 'אפקס פורשה GT3 RS',
    enName: 'APEX GT3 RS SUPERCAR',
    kind: 'car',
    kindLabel: 'מכונית מרוץ GT3',
    price: 0,
    color: '#e11d48',
    secondaryColor: '#0f172a',
    stats: {
      speed: 90,
      accel: 87,
      airControl: 80,
      fuelCap: 92,
      durability: 90
    },
    desc: 'מכונית מסלול אווירודינמית עם כנף אחורית מסיבי פחמן, אחיזת כביש מושלמת ומיכל דלק מוגדל.'
  },
  {
    id: 'titan_buggy',
    name: 'פורד ראפטור ראלי 4X4',
    enName: 'TITAN RAPTOR RALLY 4X4',
    kind: 'truck',
    kindLabel: 'רכב שטח דקאר משוריין',
    price: 200,
    color: '#f59e0b',
    secondaryColor: '#1e293b',
    stats: {
      speed: 87,
      accel: 85,
      airControl: 84,
      fuelCap: 95,
      durability: 99
    },
    desc: 'מפלצת שטח עם גלגלי ענק, גשר תאורת LED על הגג, בולמים הידראוליים גבוהים ועמידות שיא למכשולים.'
  },
  {
    id: 'plasma_hawk',
    name: 'דוקאטי פלזמה V4R',
    enName: 'DUCATI PLASMA V4R',
    kind: 'bike',
    kindLabel: 'אופנוע היפר-טורבו',
    price: 350,
    color: '#8b5cf6',
    secondaryColor: '#00f0ff',
    stats: {
      speed: 96,
      accel: 97,
      airControl: 98,
      fuelCap: 89,
      durability: 86
    },
    desc: 'אופנוע מרוצים ברמת MotoGP עם מבערי טורבו כפולים ומהירות סיבוב אווירית שוברת שיאים.'
  },
  {
    id: 'tesla_sky_x',
    name: 'טסלה רודסטר סקיי-X מעופפת',
    enName: 'TESLA ROADSTER SKY-X',
    kind: 'tesla',
    kindLabel: 'מכונית-על מעופפת (בונוס רקיע)',
    price: 600,
    isFlyingTesla: true,
    color: '#eab308',
    secondaryColor: '#0ea5e9',
    stats: {
      speed: 100,
      accel: 100,
      airControl: 100,
      fuelCap: 100,
      durability: 100
    },
    desc: 'מכונית הטסלה המעופפת היוקרתית! פותחת כנפי סילון וממריאה ל-30 שניות למסלול הרקיע בעננים ללא שאלות חשבון!'
  }
];

const TRACKS = [
  {
    id: 'neo_tokyo',
    name: 'כביש החוף והרי האלפים (שקיעה)',
    enName: 'ALPINE COASTAL HIGHWAY',
    price: 0,
    length: 11500,
    targetTimeSec: 72,
    envType: 'alpine',
    theme: {
      skyTop: 0x0b1d3a,
      skyBottom: 0xd97736,
      fogColor: 0xc27849,
      sunColor: 0xffd180,
      groundColor: 0x243b24,
      mountainColor: 0x3b4d5e,
      roadColor: 0x22262e,
      curbColorA: 0xdc2626,
      curbColorB: 0xf8fafc
    },
    difficulty: 'מסלול בינלאומי • פתוח',
    desc: 'כביש אספלט הררי מציאותי בשקיעה זהובה, יערות אורנים, גשרים, מקפצות ענק, חישוקי אש ותחנות שירות.'
  },
  {
    id: 'volcano_inferno',
    name: 'אוטוסטרדת טוקיו בחצות',
    enName: 'TOKYO MIDNIGHT EXPRESSWAY',
    price: 200,
    length: 12800,
    targetTimeSec: 76,
    envType: 'city',
    theme: {
      skyTop: 0x040714,
      skyBottom: 0x101c3d,
      fogColor: 0x0c152e,
      sunColor: 0x60a5fa,
      groundColor: 0x0b101e,
      mountainColor: 0x111827,
      roadColor: 0x181c26,
      curbColorA: 0x00f0ff,
      curbColorB: 0x1e293b
    },
    difficulty: 'מרוץ לילה מהיר',
    desc: 'מרוץ רחובות לילי בין גורדי שחקים מוארים, אספלט רטוב ומבריק, פנסי רחוב, לופים וחישוקי אש.'
  },
  {
    id: 'arctic_zero',
    name: 'קניון נבאדה והר הגעש',
    enName: 'GRAND CANYON VOLCANO RIDGE',
    price: 350,
    length: 13600,
    targetTimeSec: 80,
    envType: 'canyon',
    theme: {
      skyTop: 0x2a0f12,
      skyBottom: 0x9a3412,
      fogColor: 0x7c2d12,
      sunColor: 0xfbbf24,
      groundColor: 0x6b2e1a,
      mountainColor: 0x853920,
      roadColor: 0x292220,
      curbColorA: 0xf97316,
      curbColorB: 0xfef3c7
    },
    difficulty: 'אתגר אקסטרים',
    desc: 'מצוקי סלע אדומים אדירים, נהרות לבה רותחים מתחת לגשרים, חישוקי אש כפולים ומקפצות תהום.'
  },
  {
    id: 'cyber_rooftops',
    name: 'פסגות הקרח בשווייץ',
    enName: 'SWISS ALPS GLACIER CIRCUIT',
    price: 450,
    length: 14500,
    targetTimeSec: 85,
    envType: 'snow',
    theme: {
      skyTop: 0x08203e,
      skyBottom: 0x557c93,
      fogColor: 0x476a82,
      sunColor: 0xe0f2fe,
      groundColor: 0xdbeafe,
      mountainColor: 0x94a3b8,
      roadColor: 0x263242,
      curbColorA: 0x0284c7,
      curbColorB: 0xffffff
    },
    difficulty: 'אליפות העולם',
    desc: 'מסלול שלג וקרח בגובה רב בין פסגות מושלגות, סיבובים מהירים, שערי לייזר ומקפצות ענק.'
  }
];

const ACCESSORIES = [
  {
    id: 'neon_cyan_glow',
    name: 'תאורת LED תחתית למרכב (Underglow)',
    category: 'תאורת מרכב',
    price: 100,
    effectText: '+5% מהירות טורבו + הקרנת אור ניאון אמיתית על האספלט מתחת לרכב',
    color: '#00f0ff',
    statBonus: { speed: 4 }
  },
  {
    id: 'plasma_flame',
    name: 'מערכת פליטה אקרופוביץ׳ (Backfire Flames)',
    category: 'מערכת פליטה',
    price: 150,
    effectText: '+10% עוצמת ניטרו ולהבות אש כחולות-סגולות מהאגזוזים',
    color: '#b537f2',
    statBonus: { accel: 6 }
  },
  {
    id: 'gold_rims',
    name: 'ג׳אנטים מגנזיום מוזהבים (BBS Gold)',
    category: 'גלגלים וצמיגים',
    price: 150,
    effectText: '+8% אחיזת כביש בסיבובים ויציבות בנחיתה ממקפצות',
    color: '#ffd700',
    statBonus: { airControl: 6, durability: 5 }
  },
  {
    id: 'extra_fuel_cell',
    name: 'מיכל דלק מרוצים מוגדל (Endurance Tank)',
    category: 'מערכת דלק',
    price: 200,
    effectText: '+25% קיבולת דלק בכל מרוץ (פחות עצירות תדלוק!)',
    color: '#00ff66',
    statBonus: { fuelCap: 20 }
  },
  {
    id: 'tesla_sky_pass',
    name: 'ערת המראה: טסלה רודסטר סקיי-X (30 שניות)',
    category: 'בונוס על',
    price: 600,
    isTeslaUnlock: true,
    effectText: 'פותח את הטסלה המעופפת + כפתור המראה ל-30 שניות למסלול הרקיע בעננים ללא שאלות!',
    color: '#ffd700',
    statBonus: { speed: 12, accel: 12 }
  }
];

const PIT_STOP_PARTS = [
  {
    id: 'tires',
    name: 'החלפת 4 גלגלים',
    icon: '🛞',
    desc: 'הצוות מחליף את כל הגלגלים: מתקן פנצ׳ר מקוצים ונותן מהירות מרבית גבוהה יותר',
    bonusType: 'speed'
  },
  {
    id: 'turbo',
    name: 'מגדש טורבו כפול',
    icon: '🚀',
    desc: 'ממלא 100% ניטרו ונותן דחיפה חזקה ביציאה מהמוסך',
    bonusType: 'nitro'
  },
  {
    id: 'suspension',
    name: 'בולמי זעזועים חדשים',
    icon: '🔩',
    desc: 'מתקנים את כל נזקי הרכב (שלדה 100%) ומרככים נחיתות מקפיצות',
    bonusType: 'health'
  },
  {
    id: 'shield',
    name: 'מגן אנרגיה',
    icon: '🛡️',
    desc: 'מגן על הרכב מהמכשול או מהקוצים הבאים בדרך!',
    bonusType: 'shield'
  }
];

// Placement rewards as strictly specified:
// 1st: 200, 2nd: 150, 3rd: 100, 4th+ (non-winners): 50
const PLACEMENT_REWARDS = {
  1: 200,
  2: 150,
  3: 100,
  default: 50
};

// Points economy (kid-friendly): a wrong answer costs points, a right one earns a little,
// three right answers in a row earn a bonus.
const ECONOMY = {
  wrongPenalty: 10,
  correctBonus: 10,
  streakEvery: 3,
  streakBonus: 25,
  startPoints: 250,
  spikeHealthLoss: 14
};

class PlayerStore {
  constructor() {
    this.storageKey = 'apex_overdrive_save_v1';
    this.state = this.load();
  }

  getDefaultState() {
    return {
      version: 2,
      playerName: 'נהג אפקס',
      points: ECONOMY.startPoints,
      selectedVehicle: 'apex_viper',
      selectedTrack: 'neo_tokyo',
      selectedMode: 'multi_ai',
      mathGrade: 'junior',
      ownedVehicles: ['cyber_ninja', 'apex_viper'],
      ownedTracks: ['neo_tokyo'],
      ownedAccessories: [],
      equippedAccessories: [],
      racesPlayed: 0,
      wins: 0,
      correctMathCount: 0,
      wrongMathCount: 0,
      seenIntro: false
    };
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return this.getDefaultState();
      const merged = { ...this.getDefaultState(), ...JSON.parse(raw) };
      // Old saves (before version 2) get the new, friendlier starting wallet if they never raced.
      if (!JSON.parse(raw).version && !merged.racesPlayed) {
        merged.points = Math.max(merged.points, ECONOMY.startPoints);
        merged.mathGrade = 'junior';
      }
      merged.version = 2;
      return merged;
    } catch (e) {
      return this.getDefaultState();
    }
  }

  // A wrong answer takes points away (never below zero). Returns the points actually removed.
  penalizeWrongAnswer() {
    const before = this.state.points || 0;
    this.state.points = Math.max(0, before - ECONOMY.wrongPenalty);
    this.state.wrongMathCount = (this.state.wrongMathCount || 0) + 1;
    this.save();
    return before - this.state.points;
  }

  rewardCorrectAnswer(streak) {
    this.state.correctMathCount = (this.state.correctMathCount || 0) + 1;
    let gained = ECONOMY.correctBonus;
    if (streak > 0 && streak % ECONOMY.streakEvery === 0) gained += ECONOMY.streakBonus;
    this.state.points = (this.state.points || 0) + gained;
    this.save();
    return gained;
  }

  canAfford(price) {
    return (this.state.points || 0) >= price;
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch (e) {}
  }

  addPoints(amount) {
    this.state.points = Math.max(0, (this.state.points || 0) + amount);
    this.save();
    return this.state.points;
  }

  hasTeslaUnlocked() {
    return (
      this.state.ownedVehicles.includes('tesla_sky_x') ||
      this.state.ownedAccessories.includes('tesla_sky_pass')
    );
  }

  buyVehicle(vehId) {
    const v = VEHICLES.find(x => x.id === vehId);
    if (!v) return { ok: false, msg: 'רכב לא נמצא' };
    if (this.state.ownedVehicles.includes(vehId)) {
      this.state.selectedVehicle = vehId;
      this.save();
      return { ok: true, msg: 'הרכב נבחר!' };
    }
    if (this.state.points < v.price) {
      return { ok: false, msg: `חסרות לך ${v.price - this.state.points} נקודות לרכישת ${v.name}` };
    }
    this.state.points -= v.price;
    this.state.ownedVehicles.push(vehId);
    if (v.isFlyingTesla && !this.state.ownedAccessories.includes('tesla_sky_pass')) {
      this.state.ownedAccessories.push('tesla_sky_pass');
    }
    this.state.selectedVehicle = vehId;
    this.save();
    return { ok: true, msg: `תתחדש! רכשת את ${v.name}!` };
  }

  buyTrack(trackId) {
    const t = TRACKS.find(x => x.id === trackId);
    if (!t) return { ok: false, msg: 'מסלול לא נמצא' };
    if (this.state.ownedTracks.includes(trackId)) {
      this.state.selectedTrack = trackId;
      this.save();
      return { ok: true, msg: 'המסלול נבחר!' };
    }
    if (this.state.points < t.price) {
      return { ok: false, msg: `חסרות לך ${t.price - this.state.points} נקודות לפתיחת ${t.name}` };
    }
    this.state.points -= t.price;
    this.state.ownedTracks.push(trackId);
    this.state.selectedTrack = trackId;
    this.save();
    return { ok: true, msg: `פתחת את המסלול ${t.name}!` };
  }

  buyAccessory(accId) {
    const acc = ACCESSORIES.find(x => x.id === accId);
    if (!acc) return { ok: false, msg: 'אביזר לא נמצא' };
    if (this.state.ownedAccessories.includes(accId)) {
      if (this.state.equippedAccessories.includes(accId)) {
        this.state.equippedAccessories = this.state.equippedAccessories.filter(id => id !== accId);
      } else {
        this.state.equippedAccessories.push(accId);
      }
      this.save();
      return { ok: true, msg: 'סטטוס האביזר עודכן על הרכב!' };
    }
    if (this.state.points < acc.price) {
      return { ok: false, msg: `חסרות לך ${acc.price - this.state.points} נקודות לרכישת ${acc.name}` };
    }
    this.state.points -= acc.price;
    this.state.ownedAccessories.push(accId);
    this.state.equippedAccessories.push(accId);
    if (acc.isTeslaUnlock && !this.state.ownedVehicles.includes('tesla_sky_x')) {
      this.state.ownedVehicles.push('tesla_sky_x');
    }
    this.save();
    return { ok: true, msg: `רכשת והתקנת את ${acc.name}!` };
  }
}

window.VEHICLES = VEHICLES;
window.TRACKS = TRACKS;
window.ACCESSORIES = ACCESSORIES;
window.PIT_STOP_PARTS = PIT_STOP_PARTS;
window.PLACEMENT_REWARDS = PLACEMENT_REWARDS;
window.ECONOMY = ECONOMY;
window.playerStore = new PlayerStore();
