const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer — store in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

// ── Helper: build CSV snippet for Gemini context ─────────────────────────────
function buildCSVContext(records, maxRows = 60) {
  if (!records || records.length === 0) return 'No data available.';
  const headers = Object.keys(records[0]);
  const sample = records.slice(0, maxRows);
  const rows = sample.map(r => headers.map(h => r[h]).join(' | '));
  return `Columns: ${headers.join(', ')}\n\nData (${records.length} total rows, showing first ${sample.length}):\n${headers.join(' | ')}\n${rows.join('\n')}`;
}

// ── Helper: compute column stats ─────────────────────────────────────────────
function computeStats(records) {
  if (!records || records.length === 0) return {};
  const headers = Object.keys(records[0]);
  const stats = {};
  headers.forEach(col => {
    const values = records.map(r => r[col]).filter(v => v !== undefined && v !== '');
    const nums = values.map(v => parseFloat(v)).filter(n => !isNaN(n));
    if (nums.length > 0) {
      stats[col] = {
        type: 'numeric',
        min: Math.min(...nums), max: Math.max(...nums),
        sum: nums.reduce((a, b) => a + b, 0),
        avg: nums.reduce((a, b) => a + b, 0) / nums.length,
        count: nums.length
      };
    } else {
      const freq = {};
      values.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      stats[col] = {
        type: 'categorical',
        uniqueCount: sorted.length,
        topValues: sorted.slice(0, 10).map(([k, v]) => ({ value: k, count: v }))
      };
    }
  });
  return stats;
}

// ── Route: Upload CSV ─────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const csvText = req.file.buffer.toString('utf-8');
    const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });

    if (records.length === 0) return res.status(400).json({ error: 'CSV file is empty.' });

    const stats = computeStats(records);
    const headers = Object.keys(records[0]);

    res.json({ success: true, fileName: req.file.originalname, rowCount: records.length, columnCount: headers.length, headers, stats, preview: records.slice(0, 5), records });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: `Failed to parse CSV: ${err.message}` });
  }
});

// ── Route: Ask Question (Gemini) ──────────────────────────────────────────────
app.post('/api/query', async (req, res) => {
  try {
    const { question, records, stats, headers } = req.body;
    if (!question || !records) return res.status(400).json({ error: 'Missing question or data.' });

    // Support session API key from frontend header
    const sessionKey = req.headers['x-api-key'];
    const effectiveKey = sessionKey || process.env.GEMINI_API_KEY;

    if (!effectiveKey || effectiveKey === 'your_gemini_api_key_here') {
      return res.json({
        answer: `[Demo Mode] You asked: "${question}". To get real AI answers, add your Gemini API key in the app (click the API badge). Your data has ${records.length} rows and ${headers.length} columns: ${headers.join(', ')}.`,
        chartSuggestion: null,
        isDemo: true
      });
    }

    const genAI = new GoogleGenerativeAI(effectiveKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const csvContext = buildCSVContext(records);
    const statsStr = JSON.stringify(stats, null, 2);

    const prompt = `You are Talking Rabbitt, an intelligent AI data analyst assistant. You help business users understand their data through natural conversation.

You have access to the following dataset:
${csvContext}

Column Statistics:
${statsStr}

The user asks: "${question}"

Your job:
1. Answer the question accurately based on the data.
2. Provide a clear, concise, business-friendly answer.
3. Suggest the best chart to visualize the answer.

IMPORTANT: Respond ONLY with valid JSON in this exact format (no markdown, no code fences, just raw JSON):
{"answer":"Your clear human-readable answer here. Use \\n for line breaks and - for bullet points.","chartSuggestion":{"type":"bar","title":"Chart title","xColumn":"column name for labels","yColumn":"column name for values"}}

If no chart is needed, set chartSuggestion to null.
Chart type must be one of: bar, line, pie, doughnut`;

    const result = await model.generateContent(prompt);
    let responseText = result.response.text().trim();

    // Strip markdown code fences if Gemini adds them
    responseText = responseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = { answer: responseText, chartSuggestion: null };
    }

    res.json({ answer: parsed.answer || responseText, chartSuggestion: parsed.chartSuggestion || null, isDemo: false });

  } catch (err) {
    console.error('Query error:', err);
    if (err.message && err.message.includes('API_KEY_INVALID')) {
      return res.status(401).json({ error: 'Invalid Gemini API key. Please check the key you entered.' });
    }
    res.status(500).json({ error: `AI query failed: ${err.message}` });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🐇 Talking Rabbitt running at http://localhost:${PORT}\n`);
});
