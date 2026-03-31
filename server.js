require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`
      CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quote TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        mood TEXT
      )
    `);

    // Safely add column if it was created before this change
    db.run(`ALTER TABLE quotes ADD COLUMN mood TEXT`, (err) => {
      // Ignore error if column already exists
    });
  }
});

// Helper to get today's date in YYYY-MM-DD format
const getTodayString = () => {
  return new Date().toISOString().split('T')[0];
};

// GET /quote Endpoint
app.get('/quote', async (req, res) => {
  try {
    console.log("Mood received:", req.query.mood);
    const requestedMood = (req.query.mood || 'general').toLowerCase().trim();

    // 1. Check if we already have a quote for today FOR THIS MOOD
    const query = `
      SELECT * FROM quotes 
      WHERE mood = ? 
      ORDER BY createdAt DESC 
      LIMIT 1
    `;

    db.get(query, [requestedMood], async (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({
          quote: "Stay strong, better days are coming \uD83C\uDF1F",
          fallback: true
        });
      }

      const today = getTodayString();

      // If we have a quote, it matches the mood, and it was created today, return it
      if (row && row.createdAt.startsWith(today)) {
        console.log(`Returning cached quote from database for mood: ${requestedMood}`);
        return res.json({ quote: row.quote, createdAt: row.createdAt, mood: row.mood });
      }

      // 2. Otherwise, generate a new quote using Groq API
      console.log(`Generating new quote from Groq API for mood: ${requestedMood}...`);

      const groqApiKey = process.env.GROQ_API_KEY;
      if (!groqApiKey) {
        throw new Error('GROQ_API_KEY is not set in environment variables');
      }

      // Add variation in tone for the response
      const tones = ["poetic", "modern", "deep"];
      const randomTone = tones[Math.floor(Math.random() * tones.length)];

      const prompt = `Generate a short, deep, modern motivational quote for someone feeling ${requestedMood}. Keep it non-religious.`;

      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.1-8b-instant',
          messages: [
            {
              role: 'system',
              content: 'You are an inspirational quote generator. Output only the quote text.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.8,
        },
        {
          headers: {
            'Authorization': `Bearer ${groqApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const generatedQuote = response.data.choices[0].message.content.trim().replace(/^"|"$/g, '');

      // 3. Save the new quote to SQLite
      const insertQuery = `INSERT INTO quotes (quote, mood) VALUES (?, ?)`;
      db.run(insertQuery, [generatedQuote, requestedMood], function (insertErr) {
        if (insertErr) {
          console.error('Error saving quote to database:', insertErr);
          // Return the generated quote anyway even if DB save fails
          return res.json({ quote: generatedQuote, createdAt: new Date().toISOString(), mood: requestedMood });
        }

        // Return the newly generated and saved quote
        res.json({ quote: generatedQuote, createdAt: new Date().toISOString(), mood: requestedMood });
      });
    });

  } catch (error) {
    console.error("Groq API error:", error.response?.data || error.message);
    return res.json({
      quote: "Stay strong, better days are coming \uD83C\uDF1F",
      fallback: true
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
