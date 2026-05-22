// utils/clu.js
export function pick(entities, category) {
  return entities?.find(e => (e.category || '').toLowerCase() === category.toLowerCase())?.text || null;
}

export function normalizeStatus(input) {
  if (!input) return null;
  const s = input.toString().trim().toUpperCase();
  if (['CONFIRMADA','CONFIRMADO','CONFIRMAR'].includes(s)) return 'CONFIRMED';
  if (['CANCELADA','CANCELADO','ANULAR'].includes(s)) return 'CANCELLED';
  if (['COMPLETADA','COMPLETADO','FINALIZADA'].includes(s)) return 'COMPLETED';
  if (['NO SHOW','NOSHOW','NO_ASISTIO','NOASISTIO','NO-ASISTIO'].includes(s)) return 'NO_SHOW';
  if (['SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW'].includes(s)) return s;
  return null;
}
