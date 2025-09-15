// recognizers/cluRecognizer.js
const MIN_SCORE = Number(process.env.CLU_MIN_SCORE || 0.25);

export async function recognizeCLU(text) {
  const res = await fetch(process.env.CLU_PREDICTION_URL, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': process.env.CLU_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      kind: 'Conversation',
      analysisInput: {
        conversationItem: {
          id: '1',
          participantId: 'user-1',   // ✅ OBLIGATORIO: un string no vacío
          modality: 'text',
          language: 'es',            // 'es' o 'es-es' funcionan
          text
        }
      },
      parameters: {
        projectName: process.env.CLU_PROJECT,
        deploymentName: process.env.CLU_DEPLOYMENT,
        verbose: true
      }
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CLU ${res.status} ${res.statusText} – ${body}`);
  }

  const json = await res.json();
  const pred = json?.result?.prediction || {};
  const intentsRaw = Array.isArray(pred.intents) ? pred.intents : [];
  const intents = intentsRaw.map(i => ({
    category: i.category,
    score: i.confidenceScore ?? i.confidence ?? i.score ?? 0
  }));

  const best = intents
    .filter(i => (i.category || '').toLowerCase() !== 'none')
    .sort((a, b) => b.score - a.score)[0];

  let topIntent = pred.topIntent;
  if (!topIntent || topIntent.toLowerCase() === 'none') {
    topIntent = best && best.score >= MIN_SCORE ? best.category : 'None';
  }

  if (process.env.DEBUG_CLU === '1') {
    console.log('--- CLU RAW ---');
    console.log(JSON.stringify(json, null, 2));
    console.log('--- CLU INTENTS ---', intents);
    console.log('--- CLU CHOSEN ---', topIntent);
  }

  return {
    topIntent: topIntent || 'None',
    intents,
    entities: pred.entities || []
  };
}