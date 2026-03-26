import express from 'express';
import { createServer } from 'http';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const app = express();
const server = createServer(app);

const API_KEY = process.env.GOOGLE_API_KEY;
const genAI = new GoogleGenAI({ apiKey: API_KEY });

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- API Routes (mirrors Vercel serverless functions for local dev) ---

// GET /api/config — return API key
app.get('/api/config', (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY not configured' });
  }
  res.json({ apiKey: API_KEY });
});

// POST /api/generate-image — generate image via Gemini
app.post('/api/generate-image', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    const response = await genAI.models.generateContent({
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
      return res.json({ success: true, data: imageData.data, mimeType: imageData.mimeType });
    } else {
      return res.json({ success: false, error: 'No image generated' });
    }
  } catch (err) {
    console.error('Image generation error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  🚀 Gemini Live App running at http://localhost:${PORT}\n`);
});
