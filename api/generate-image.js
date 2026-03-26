// Vercel serverless function — generates images via Gemini API
import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY not configured' });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
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

    let imageData = null;
    if (response.candidates && response.candidates[0]) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageData = {
            mimeType: part.inlineData.mimeType,
            data: part.inlineData.data
          };
          break;
        }
      }
    }

    if (imageData) {
      return res.status(200).json({
        success: true,
        data: imageData.data,
        mimeType: imageData.mimeType
      });
    } else {
      return res.status(200).json({
        success: false,
        error: 'No image generated'
      });
    }
  } catch (err) {
    console.error('Image generation error:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
