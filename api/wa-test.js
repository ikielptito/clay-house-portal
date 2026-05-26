// Diagnostic endpoint — tests WhatsApp config and returns the raw Meta API response.
// Only accessible with the admin password. Remove or disable once working.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body || {};
  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const phoneId      = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token        = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'clay_house_progress_update';
  const numbers      = (process.env.BUYER_WHATSAPP_NUMBERS || '').split(',').filter(Boolean);

  // Return config summary (token truncated for safety)
  const config = {
    phoneId:      phoneId || '(not set)',
    tokenPrefix:  token ? token.slice(0, 10) + '…' : '(not set)',
    templateName,
    buyerCount:   numbers.length,
    firstNumber:  numbers[0] ? numbers[0].trim().replace(/[^0-9]/g, '') : '(none)'
  };

  if (!phoneId || !token || !numbers.length) {
    return res.json({ config, error: 'Missing env vars — check above' });
  }

  // Send one real test message to the first number only
  const testPhone = numbers[0].trim().replace(/[^0-9]/g, '');
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: testPhone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: 'Test Period' },
              { type: 'text', text: '72%' },
              { type: 'text', text: '65%' }
            ]
          }]
        }
      })
    });

    const metaBody = await metaRes.json();
    return res.json({
      config,
      httpStatus: metaRes.status,
      metaResponse: metaBody
    });
  } catch (err) {
    return res.json({ config, fetchError: err.message });
  }
};
