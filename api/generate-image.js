// Vercel serverless function — generates images via Gemini API
import { GoogleGenAI } from '@google/genai';

async function tryGenerateImage(ai, prompt, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
          {
            role: 'user',
            parts: [{ text: `Generate this image: ${prompt}` }]
          }
        ],
        config: {
          responseModalities: ['IMAGE', 'TEXT']
        }
      });

      if (response.candidates && response.candidates[0]) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            return {
              success: true,
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType
            };
          }
        }
      }
      return { success: false, error: 'No image data in response' };
    } catch (err) {
      const isRateLimit = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED');
      if (isRateLimit && attempt < retries) {
        // Wait and retry on rate limit
        const waitMs = (attempt + 1) * 5000;
        console.log(`Rate limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_API_KEY not configured' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await tryGenerateImage(ai, prompt);
    return res.status(200).json(result);
  } catch (err) {
    console.error('Image generation error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
