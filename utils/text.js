export function normalizeText(value) {
  return (value || '').toString().trim().toLowerCase();
}

export function stripAccents(value) {
  return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeLoose(value) {
  return stripAccents(normalizeText(value))
    .replace(/[“”"'`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGreeting(text) {
  return /^(hola|buenas|buenos dias|buen día|buen dia|buenas tardes|buenas noches|hey|hola bot)\b/.test(normalizeLoose(text));
}

export function isGreetingOnly(text) {
  const t = normalizeLoose(text);
  return isGreeting(t) && !/\b(cita|citas|agendar|agendo|agenda|consultar|consulta|cancelar|cancelacion|ver|mostrar|tengo|quiero|necesito|reservar|reprogramar|reagendar|mover|cambiar)\b/.test(t.replace(/^(hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hey|hola bot)\b/, '').trim());
}

export function isHelp(text) {
  return /^(ayuda|menu|menú|opciones|empezar|inicio|soporte)\b/.test(normalizeLoose(text));
}

export function isAffirmative(text) {
  return /^(si|sí|s|yes|ok|dale|confirmo|confirmar|correcto|de acuerdo|claro)$/i.test(normalizeText(text));
}

export function isNegative(text) {
  return /^(no|n|negativo)$/i.test(normalizeText(text));
}

export function normalizePersonName(text) {
  return normalizeLoose(text)
    .replace(/\b(doctora|doctor|dra|dr|doc|odontologa|odontologo|odontóloga|odontólogo)\b/g, ' ')
    .replace(/\b(el|la)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function maybeExitFlow(text) {
  return /^(cancelar|cancela|salir|volver|menu|menú|ayuda|hola)$/i.test(normalizeText(text));
}

export function extractDentistHint(text) {
  const raw = (text || '').toString();
  const stopWords = '(?:para|el|la|este|esta|mañana|manana|pasado|hoy|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|a\\s+las|\\d{1,2}(:\\d{2})?\\s*(?:am|pm)?\\b)';
  const regex = new RegExp(`\\bcon\\s+(.+?)(?=\\s+${stopWords}|[.?!,;:]|$)`, 'gi');
  const candidates = [];

  for (const match of raw.matchAll(regex)) {
    let s = match[1]
      .replace(/^[,:\-\s]+/, '')
      .replace(/\b(hoy|mañana|manana|pasado mañana|el\s+\d{1,2}\s+de\s+[a-záéíóúñ]+|\d{4}-\d{2}-\d{2}|\d{1,2}(:\d{2})?\s*(am|pm)?|a las\s+\d{1,2}(:\d{2})?\s*(am|pm)?|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo).*$/i, '')
      .trim();
    s = s.replace(/^(la|el)\s+/i, '').trim();

    const normalized = normalizeLoose(s);
    if (!normalized) continue;
    if (/\b(cita|citas|consulta|consultas|turno|agenda|agendamiento)\b/.test(normalized)) continue;
    candidates.push(s);
  }

  return candidates.length ? candidates[candidates.length - 1] : null;
}
