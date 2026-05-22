export function normalizeWhatsapp(raw) {
  const normalized = (raw || '')
    .replace(/^whatsapp:/i, '')
    .replace(/\D/g, '');

  if (process.env.DEBUG_WA === '1') {
    console.log('[WA][normalizeWhatsapp] raw =', raw);
    console.log('[WA][normalizeWhatsapp] normalized =', normalized);
  }

  return normalized;
}

export function getWhatsappFromStep(step) {
  const activity = step?.context?.activity;
  const rawFrom = activity?.from?.id || '';
  const channelId = activity?.channelId || '';
  const emulatorFallback = normalizeWhatsapp(process.env.EMULATOR_WHATSAPP || '');

  if (process.env.DEBUG_WA === '1') {
    console.log('[WA][getWhatsappFromStep] channelId =', channelId);
    console.log('[WA][getWhatsappFromStep] from.id =', rawFrom);
    console.log('[WA][getWhatsappFromStep] activity =', JSON.stringify({
      channelId: activity?.channelId,
      from: activity?.from,
      conversation: activity?.conversation,
      recipient: activity?.recipient,
      text: activity?.text
    }, null, 2));
  }

  // En Bot Framework Emulator, from.id suele ser un UUID. Convertirlo a dígitos produce
  // un número falso que no coincide con pacientes reales; por eso preferimos EMULATOR_WHATSAPP.
  if (channelId === 'emulator' && emulatorFallback) {
    if (process.env.DEBUG_WA === '1') console.log('[WA][getWhatsappFromStep] using emulator fallback =', emulatorFallback);
    return emulatorFallback;
  }

  const normalized = normalizeWhatsapp(rawFrom);
  if (normalized) {
    if (process.env.DEBUG_WA === '1') console.log('[WA][getWhatsappFromStep] using detected number =', normalized);
    return normalized;
  }

  if (process.env.DEBUG_WA === '1') console.log('[WA][getWhatsappFromStep] using fallback =', emulatorFallback);
  return emulatorFallback;
}
