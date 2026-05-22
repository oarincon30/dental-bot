// utils/datetime.js
import { DateTime } from 'luxon';

const TZ = process.env.TZ || 'America/Bogota';
const MONTH_MAP = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12
};
const WEEKDAY_MAP = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
  domingo: 7
};

function cleanText(text) {
  return (text || '')
    .toString()
    .trim()
    .replace(/[“”"'`´]/g, '')
    .replace(/\s+/g, ' ');
}

function applyMeridiem(hour, minute, indicator) {
  const meridiem = (indicator || '').toLowerCase();

  if (meridiem === 'pm' || meridiem === 'tarde' || meridiem === 'noche') {
    if (hour < 12) hour += 12;
  } else if (meridiem === 'am' || meridiem === 'mañana' || meridiem === 'manana') {
    if (hour === 12) hour = 0;
  } else if (hour >= 1 && hour <= 6) {
    // En el contexto de una clínica, "a las 2" normalmente significa 14:00.
    hour += 12;
  }

  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function parseTimeParts(text) {
  const patterns = [
    {
      regex: /a\s+las\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|de\s+la\s+mañana|de\s+la\s+manana|de\s+la\s+tarde|de\s+la\s+noche)?\b/gi,
      map: (m) => ({ hour: parseInt(m[1], 10), minute: m[2] ? parseInt(m[2], 10) : 0, indicator: normalizeMeridiem(m[3]) })
    },
    {
      regex: /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi,
      map: (m) => ({ hour: parseInt(m[1], 10), minute: parseInt(m[2], 10), indicator: normalizeMeridiem(m[3]) })
    },
    {
      regex: /\b(\d{1,2})\s*(am|pm)\b/gi,
      map: (m) => ({ hour: parseInt(m[1], 10), minute: 0, indicator: normalizeMeridiem(m[2]) })
    },
    {
      regex: /\b(\d{1,2})(?::(\d{2}))?\s+de\s+la\s+(mañana|manana|tarde|noche)\b/gi,
      map: (m) => ({ hour: parseInt(m[1], 10), minute: m[2] ? parseInt(m[2], 10) : 0, indicator: normalizeMeridiem(m[3]) })
    }
  ];

  let parts = null;
  for (const { regex, map } of patterns) {
    const found = Array.from(text.matchAll(regex));
    if (found.length) {
      parts = map(found[found.length - 1]);
      break;
    }
  }

  if (!parts) return null;
  return applyMeridiem(parts.hour, parts.minute, parts.indicator);
}

function normalizeMeridiem(value) {
  const v = (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!v) return null;
  if (v === 'am' || v.includes('mañana') || v.includes('manana')) return 'mañana';
  if (v === 'pm') return 'pm';
  if (v.includes('tarde')) return 'tarde';
  if (v.includes('noche')) return 'noche';
  return v;
}

function buildDateTime({ year, month, day, hour, minute }) {
  return DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone: TZ }
  );
}

function nextWeekday(base, weekday) {
  const start = base.startOf('day');
  let delta = weekday - start.weekday;
  if (delta <= 0) delta += 7;
  return start.plus({ days: delta });
}

function timeOrDefault(lower, defaultDateTime) {
  const explicit = parseTimeParts(lower);
  if (explicit) return explicit;
  if (defaultDateTime && /\b(misma hora|igual hora|a la misma hora|sin cambiar la hora)\b/i.test(lower)) {
    return { hour: defaultDateTime.hour, minute: defaultDateTime.minute };
  }
  if (defaultDateTime) return { hour: defaultDateTime.hour, minute: defaultDateTime.minute };
  return null;
}

export function parseNaturalDateTime(text, base = DateTime.now().setZone(TZ), defaultTime = null) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;

  const defaultLocal = defaultTime
    ? (DateTime.isDateTime(defaultTime) ? defaultTime.setZone(TZ) : DateTime.fromISO(defaultTime).setZone(TZ))
    : null;

  const isoLike = cleaned.replace(/\//g, '-');
  const isoTry = DateTime.fromISO(isoLike, { zone: TZ });
  if (isoTry.isValid && cleaned.match(/\d/) && parseTimeParts(cleaned.toLowerCase())) return isoTry;

  const lower = cleaned.toLowerCase();
  const time = timeOrDefault(lower, defaultLocal);
  if (!time) return null;

  const ymd = lower.match(/\b(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (ymd) {
    return buildDateTime({
      year: parseInt(ymd[1], 10),
      month: parseInt(ymd[2], 10),
      day: parseInt(ymd[3], 10),
      hour: time.hour,
      minute: time.minute
    });
  }

  const dmy = lower.match(/\b(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\b/);
  if (dmy) {
    return buildDateTime({
      year: parseInt(dmy[3], 10),
      month: parseInt(dmy[2], 10),
      day: parseInt(dmy[1], 10),
      hour: time.hour,
      minute: time.minute
    });
  }

  const explicitDate = lower.match(/(?:el\s+|para\s+el\s+|para\s+)?(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(\d{4}))?/i);
  if (explicitDate) {
    const day = parseInt(explicitDate[1], 10);
    const month = MONTH_MAP[explicitDate[2]];
    const year = explicitDate[3] ? parseInt(explicitDate[3], 10) : base.year;
    if (month) {
      let candidate = buildDateTime({ year, month, day, hour: time.hour, minute: time.minute });
      if (!explicitDate[3] && candidate < base) candidate = candidate.plus({ years: 1 });
      return candidate;
    }
  }

  const monthFirst = lower.match(/\b([a-záéíóúñ]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
  if (monthFirst) {
    const month = MONTH_MAP[monthFirst[1]];
    const day = parseInt(monthFirst[2], 10);
    const year = monthFirst[3] ? parseInt(monthFirst[3], 10) : base.year;
    if (month) {
      let candidate = buildDateTime({ year, month, day, hour: time.hour, minute: time.minute });
      if (!monthFirst[3] && candidate < base) candidate = candidate.plus({ years: 1 });
      return candidate;
    }
  }

  if (lower.includes('pasado mañana')) {
    const day = base.plus({ days: 2 }).startOf('day');
    return day.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  }

  if (lower.includes('mañana')) {
    const day = base.plus({ days: 1 }).startOf('day');
    return day.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  }

  if (lower.includes('hoy')) {
    const day = base.startOf('day');
    return day.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  }

  const weekdayMatch = lower.match(/\b(?:(?:el|este|esta|proximo|próximo)\s+)?(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i);
  if (weekdayMatch) {
    const weekday = WEEKDAY_MAP[weekdayMatch[1].toLowerCase()];
    if (weekday) {
      const day = nextWeekday(base, weekday);
      return day.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
    }
  }

  return null;
}

export function toISO(dt) {
  return dt.setZone('utc').toISO();
}

export function clampToSlots(start) {
  const mm = start.minute;
  const rounded = start
    .set({ minute: mm < 15 ? 0 : (mm < 45 ? 30 : 0) })
    .set({ second: 0, millisecond: 0 });

  return mm >= 45 ? rounded.plus({ hours: 1 }) : rounded;
}

export function isWithinWorkingHours(start, end) {
  const s = start.set({ second: 0, millisecond: 0 });
  const e = end.set({ second: 0, millisecond: 0 });
  if (!s.isValid || !e.isValid || e <= s) return false;

  const mk = (h, m = 0) => s.set({ hour: h, minute: m });
  const w1s = mk(7, 0);
  const w1e = mk(11, 0);
  const w2s = mk(13, 0);
  const w2e = mk(17, 0);

  const inW1 = s >= w1s && e <= w1e;
  const inW2 = s >= w2s && e <= w2e;
  return s.toISODate() === e.toISODate() && (inW1 || inW2);
}

export function isMultipleOf30(start, end) {
  const dur = end.diff(start, 'minutes').minutes;
  return Number.isInteger(dur) && dur > 0 && dur % 30 === 0;
}
