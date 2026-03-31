require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// =======================
// DATABASE SETUP
// =======================
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new Database(dbPath);

console.log('Connected to SQLite database.');

db.prepare(`
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    mood TEXT
  )
`).run();

// =======================
// HELPER FUNCTION
// =======================
const getTodayString = () => {
  return new Date().toISOString().split('T')[0];
};

// =======================
// API ENDPOINT
// =======================
app.get('/quote', async (req, res) => {
  try {
    const requestedMood = (req.query.mood || 'general').toLowerCase().trim();
    const today = getTodayString();

    console.log("Mood:", requestedMood);

    // =======================
    // CHECK CACHE
    // =======================
    const row = db.prepare(`
      SELECT * FROM quotes
      WHERE mood = ?
      ORDER BY createdAt DESC
      LIMIT 1
    `).get(requestedMood);

    if (row && row.createdAt.startsWith(today)) {
      console.log("Returning cached quote");
      return res.json({
        quote: row.quote,
        createdAt: row.createdAt,
        mood: row.mood,
        cached: true
      });
    }

    // =======================
    // GENERATE NEW QUOTE
    // =======================
    console.log("Generating new quote...");

    const groqApiKey = process.env.GROQ_API_KEY;

    if (!groqApiKey) {
      return res.json({
        quote: "Keep going, you’re doing great 💪",
        fallback: true
      });
    }

    const tones = ["poetic", "modern", "deep"];
    const randomTone = tones[Math.floor(Math.random() * tones.length)];

    const prompt = `
      Generate a short, ${randomTone}, powerful quote 
      for someone feeling ${requestedMood}.
      Make it emotional and non-religious.
      Output only the quote.
    `;

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You generate aesthetic quotes.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9,
      },
      {
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const generatedQuote =
      response.data.choices[0].message.content
        .trim()
        .replace(/^"|"$/g, '');

    // =======================
    // SAVE TO DB
    // =======================
    db.prepare(`
      INSERT INTO quotes (quote, mood)
      VALUES (?, ?)
    `).run(generatedQuote, requestedMood);

    return res.json({
      quote: generatedQuote,
      createdAt: new Date().toISOString(),
      mood: requestedMood,
      cached: false
    });

  } catch (error) {
    console.error("Groq error:", error.response?.data || error.message);

    return res.json({
      quote: "Stay strong, better days are coming 🌟",
      fallback: true
    });
  }
});

// =======================
// START SERVER
// =======================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});