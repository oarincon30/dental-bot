// recognizers/cluRecognizer.js
// ESM, Node 18+: usa fetch nativa
function sanitizeId(raw, fallback = 'user') {
  const s = (raw || fallback) + '';
  // Acepta solo a-zA-Z0-9_- y recorta a 64 chars
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export async function recognizeCLU(textRaw, context) {
  try {
    if (process.env.USE_CLU !== '1') {
      return { topIntent: null, topScore: 0, entities: [] };
    }

    const endpoint   = process.env.CLU_PREDICTION_URL;
    const key        = process.env.CLU_KEY;
    const project    = process.env.CLU_PROJECT;
    const deployment = process.env.CLU_DEPLOYMENT;
    const lang       = process.env.CLU_LANGUAGE || 'es';

    if (!endpoint || !key || !project || !deployment) {
      if (process.env.DEBUG_CLU === '1') console.warn('[CLU] Missing env config');
      return { topIntent: null, topScore: 0, entities: [] };
    }

    const text = (textRaw || '').toString();
    const rawFrom = context?.activity?.from?.id || context?.activity?.recipient?.id || 'user';
    const rawMsgId = context?.activity?.id || Date.now().toString();

    // 🔧 FIX: WhatsApp viene como "whatsapp:+57..." → CLU lo rechaza. Saneamos.
    const participantId = sanitizeId(rawFrom);        // ej: "whatsapp__57xxxxxxxxx"
    const messageId     = sanitizeId(rawMsgId, 'm1'); // id del item

    const body = {
      kind: 'Conversation',
      analysisInput: {
        conversationItem: {
          id: messageId,
          participantId,
          text,
          modality: 'text',
          language: lang
        }
      },
      parameters: {
        projectName: project,
        deploymentName: deployment,
        stringIndexType: 'TextElement_V8',
        verbose: true
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const json = await res.json();
    if (process.env.DEBUG_CLU === '1') {
      console.log('--- CLU RAW ---\n', JSON.stringify(json, null, 2));
    }
    if (!res.ok) {
      if (process.env.DEBUG_CLU === '1') console.error('[CLU] HTTP', res.status);
      return { topIntent: null, topScore: 0, entities: [] };
    }

    // Estructura típica: json.result.prediction.
    // Azure CLU devuelve confidenceScore; dejamos fallback a confidence por compatibilidad.
    const pred = json.result?.prediction || {};
    const intents = Array.isArray(pred.intents) ? pred.intents : [];
    const topIntent = pred.topIntent || intents[0]?.category || null;
    const topIntentItem = intents.find(i => i.category === topIntent) || intents[0] || null;
    const topScore = Number(
      topIntentItem?.confidenceScore
      ?? topIntentItem?.confidence
      ?? pred.confidenceScore
      ?? pred.confidence
      ?? 0
    );

    const entities = (pred.entities || []).map(e => ({
      category: e.category,
      text: e.text,
      offset: e.offset,
      length: e.length,
      confidence: Number(e.confidenceScore ?? e.confidence ?? 0),
      confidenceScore: Number(e.confidenceScore ?? e.confidence ?? 0),
      extraInformation: e.extraInformation || []
    }));

    if (process.env.DEBUG_CLU === '1') {
      console.log('--- CLU TOP ---', { topIntent, topScore });
    }
    return { topIntent, topScore, entities, raw: json };
  } catch (err) {
    if (process.env.DEBUG_CLU === '1') console.error('[CLU] error', err);
    return { topIntent: null, topScore: 0, entities: [] };
  }
}

