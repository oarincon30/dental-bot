// utils/datetime.js
import * as Recognizers from '@microsoft/recognizers-text-date-time';

export function normalizeService(text) {
  const t = (text || '').toString().toLowerCase();
  if (t.includes('limpieza') || t.includes('profilaxis')) return 'LIMPIEZA';
  if (t.includes('valor')) return 'VALORACION';
  if (t.includes('endodon')) return 'ENDODONCIA';
  if (t.includes('orto') || t.includes('control')) return 'ORTODONCIA';
  if (t.includes('urgenc')) return 'URGENCIA';
  return text?.toString().toUpperCase() || 'LIMPIEZA';
}

export function recognizeDateTimeES(text) {
  const culture = Recognizers.Culture.Spanish; // 'es-es'
  const results = Recognizers.recognizeDateTime(text, culture);

  // Reglas mínimas para MVP:
  // - Si dice "mañana/tarde/noche" → usa rangos fijos
  // - Si dice "después de las 2" → 14:00–18:00 del día detectado (o próximo día hábil)
  // - Si hay una hora puntual → usa [hora, hora+1h]
  const now = new Date();
  const baseDate = nextFridayIfSaysFriday(text, now) || now;

  // Heurística rápida de rango por palabras
  const lower = (text || '').toLowerCase();
  if (lower.includes('después de las 2')) {
    const from = setLocalDateTime(baseDate, 14, 0);
    const to   = setLocalDateTime(baseDate, 18, 0);
    return { fromISO: toISO(from), toISO: toISO(to) };
  }
  if (lower.includes('en la tarde')) {
    const from = setLocalDateTime(baseDate, 14, 0);
    const to   = setLocalDateTime(baseDate, 18, 0);
    return { fromISO: toISO(from), toISO: toISO(to) };
  }

  // Si recognizers detecta una hora, construct [time, time+1h]
  if (results?.length) {
    const v = results[0].resolution?.values?.[0] || {};
    if (v.time) {
      const [h, m] = v.time.split(':').map(Number);
      const from = setLocalDateTime(baseDate, h, m || 0);
      const to   = new Date(from.getTime() + 60*60*1000);
      return { fromISO: toISO(from), toISO: toISO(to) };
    }
  }
  // Sin nada claro: devuelve null y el diálogo pedirá más info
  return null;
}

// Helpers
function toISO(d) {
  // Retorna ISO con offset local (ej. -05:00). Simplificado para MVP.
  const tzOffsetMin = d.getTimezoneOffset(); // minutos desde UTC
  const sign = tzOffsetMin > 0 ? '-' : '+';
  const abs = Math.abs(tzOffsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return d.toISOString().replace('Z', `${sign}${hh}:${mm}`);
}
function setLocalDateTime(base, hour, min) {
  const d = new Date(base);
  d.setHours(hour, min, 0, 0);
  return d;
}
function nextFridayIfSaysFriday(text, now) {
  if (!text?.toLowerCase().includes('viernes')) return null;
  const d = new Date(now);
  const day = d.getDay(); // 0=Dom ... 5=Vie
  const delta = day <= 5 ? 5 - day : 5 + (7 - day);
  d.setDate(d.getDate() + delta);
  return d;
}