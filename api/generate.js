const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password, period, rawNotes, estimatedCompletion, workPackages, photos } = req.body || {};

  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!period || !rawNotes) {
    return res.status(400).json({ error: 'period and rawNotes are required' });
  }

  const wpSummary = Object.entries(workPackages || {})
    .map(([k, v]) => `  - ${k}: ${v}%`)
    .join('\n');

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You write weekly construction progress reports for buyers of The Clay House Cepaka, a luxury villa in Bali. Transform the contractor's raw notes into a polished, professional update — warm, clear, and reassuring in tone.

Return ONLY valid JSON, no other text, in exactly this structure:
{
  "generalComments": "A 2–3 sentence narrative paragraph summarising the week's progress.",
  "sections": [
    { "title": "Completed This Week", "bullets": ["concise item", "concise item"] },
    { "title": "Currently In Progress", "bullets": ["concise item", "concise item"] },
    { "title": "Planned Next Week", "bullets": ["concise item", "concise item"] }
  ]
}

Guidelines:
- Write for a non-technical buyer audience — no jargon.
- Be positive but accurate; do not invent facts.
- Bullets should be concise (one line each).
- Omit a section's array entry if there is nothing genuine to put in it.`,
      messages: [{
        role: 'user',
        content: `Report period: ${period}
Estimated completion: ${estimatedCompletion || 'not specified'}
Work package completion:\n${wpSummary}
Contractor notes: ${rawNotes}`
      }]
    });
  } catch (err) {
    console.error('Anthropic API error:', err);
    return res.status(502).json({ error: 'Failed to contact AI service: ' + (err.message || 'Unknown error') });
  }

  const text = message.content[0].text.trim();
  let synthesized;
  try {
    synthesized = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        synthesized = JSON.parse(match[0]);
      } catch {
        return res.status(500).json({ error: 'Failed to parse Claude response' });
      }
    } else {
      return res.status(500).json({ error: 'Failed to parse Claude response' });
    }
  }

  const id = `report_${Date.now()}`;
  const report = {
    id,
    period,
    estimatedCompletion: estimatedCompletion || null,
    workPackages: workPackages || {},
    photos: photos || [],
    synthesized,
    generatedAt: new Date().toISOString()
  };

  return res.json(report);
};
