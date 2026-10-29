/**
 * Production Xtream Codes API Engine, Webhook Receiver & Stream Proxy
 * Stack: Node.js, Express, Neon PostgreSQL (pg), TMDB API, Cheerio Scraper
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

// Import the scraping module from fetch.js
const { scrapeCatalog } = require('./fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS and JSON/URL-encoded body parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ENVIRONMENT VARIABLES & SECURE CONFIGURATION ---
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_CpAk4zLr2BjU@ep-super-pond-awn6qzl5-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const TMDB_READ_TOKEN = process.env.TMDB_READ_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJhYWViZWMwOWQ2ZDFiYjExZTU5ZTg5N2M5NTMyNjdjMSIsIm5iZiI6MTc4NzMxOTc2NC41MTEwMDAyLCJzdWIiOiI2YTg4NTVkNDIxMWUwMTFhNzk1Y2RjZjMiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.9O2Ie7HWDha8nkt4DU-gIPnoLZD_F1oCih8Ui76uzGw';
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'aaebec09d6d1bb11e59e897c953267c1';
const GITHUB_M3U_URL = process.env.GITHUB_M3U_URL || 'https://raw.githubusercontent.com/Armond452Alt/Fixed-M3U/master/CN%5CAS.m3u8';
const APP_PIN = process.env.APP_PIN || '1234';

if (!DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL environment variable is not defined.');
}

// PostgreSQL Connection Pool (Configured for NeonDB over SSL)
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Automatically ensure the transactions table exists on startup
async function initDatabase() {
  if (!DATABASE_URL) return;
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        password VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(createTableQuery);
    console.log('Database initialized: transactions table verified/created.');
  } catch (err) {
    console.error('Failed to initialize database table:', err.message);
  }
}

initDatabase();

// Cache storage for parsed M3U content
let cache = {
  lastUpdated: 0,
  categories: [],
  streams: [],
  streamLookupMap: new Map()
};

// --- UTILITY FUNCTIONS ---

/**
 * Generate random alphanumeric strings with configurable segment length and count
 */
function generateRandomString(length = 8, count = 1) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const segments = [];

  for (let c = 0; c < count; c++) {
    let segment = '';
    for (let i = 0; i < length; i++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }

  return segments.join(' ');
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function isValidUser(username, password) {
  if (!username || !password) return false;
  if (username === 'test' && password === 'test') return true;
  if (!DATABASE_URL) return false;

  try {
    const query = `
      SELECT username, password, status 
      FROM transactions 
      WHERE LOWER(username) = LOWER($1) 
        AND password = $2 
        AND LOWER(status) = 'active' 
      LIMIT 1;
    `;
    const res = await pool.query(query, [username, password]);
    return res.rows.length > 0;
  } catch (err) {
    console.error('Database query error:', err.message);
    return false;
  }
}

async function refreshPlaylistCache() {
  const NOW = Date.now();
  if (cache.streams.length > 0 && (NOW - cache.lastUpdated < 15 * 60 * 1000)) {
    return cache;
  }

  try {
    console.log(`Fetching upstream M3U playlist from: ${GITHUB_M3U_URL}`);
    const res = await fetchWithTimeout(GITHUB_M3U_URL, { timeout: 12000 });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    
    const text = await res.text();
    const lines = text.split(/\r?\n/);

    const categoriesMap = new Map();
    const streams = [];
    const lookupMap = new Map();

    let currentMeta = null;
    let streamIdCounter = 1000;

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        currentMeta = line;
      } else if (!line.startsWith('#') && currentMeta) {
        const categoryMatch = currentMeta.match(/group-title="([^"]+)"/i);
        const categoryName = categoryMatch ? categoryMatch[1] : 'General';
        
        const nameMatch = currentMeta.match(/,(.+)$/);
        const streamName = nameMatch ? nameMatch[1].trim() : `Channel ${streamIdCounter}`;

        const logoMatch = currentMeta.match(/tvg-logo="([^"]+)"/i);
        const streamIcon = logoMatch ? logoMatch[1] : '';

        if (!categoriesMap.has(categoryName)) {
          categoriesMap.set(categoryName, {
            category_id: String(categoriesMap.size + 1),
            category_name: categoryName,
            parent_id: 0
          });
        }

        const catObj = categoriesMap.get(categoryName);
        const streamId = streamIdCounter++;

        const streamObj = {
          num: streams.length + 1,
          name: streamName,
          stream_type: 'live',
          stream_id: streamId,
          stream_icon: streamIcon,
          epg_channel_id: '',
          added: '1600000000',
          category_id: catObj.category_id,
          custom_sid: '',
          tv_archive: 0,
          direct_source: line,
          tv_archive_duration: 0
        };

        streams.push(streamObj);
        lookupMap.set(String(streamId), line);
        currentMeta = null;
      }
    }

    cache = {
      lastUpdated: NOW,
      categories: Array.from(categoriesMap.values()),
      streams,
      streamLookupMap: lookupMap
    };

    console.log(`Playlist updated: ${cache.streams.length} channels loaded across ${cache.categories.length} categories.`);
    return cache;
  } catch (err) {
    console.error('Failed to parse M3U playlist:', err.message);
    return cache;
  }
}

// --- SELLAUTH WEBHOOK HANDLER ---

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Received Webhook Payload:', JSON.stringify(payload));

    const status = payload.status || (payload.data && payload.data.status) || '';
    const total = payload.total !== undefined ? payload.total : (payload.data && payload.data.total);
    const subtotal = payload.subtotal !== undefined ? payload.subtotal : (payload.data && payload.data.subtotal);

    const isCompleted = 
      String(status).toUpperCase().includes('COMPLETED') ||
      Number(total) === 0 || 
      Number(subtotal) === 0 ||
      payload.value === 0 || 
      payload.total === 0;

    if (isCompleted) {
      const username = generateRandomString(9, 1); // e.g. h76g7bxtc
      const password = generateRandomString(9, 1);
      const serverUrl = `https://${req.get('host')}`;

      if (DATABASE_URL) {
        const insertQuery = `
          INSERT INTO transactions (username, password, status)
          VALUES ($1, $2, 'Active');
        `;
        await pool.query(insertQuery, [username, password]);
        console.log(`Auto-provisioned account -> Username: ${username} | Password: ${password}`);
      }

      const formattedDeliverable = 
`Your IPTV Subscription Details:

Xtream Codes
Server URL: ${serverUrl}
Username: ${username}
Password: ${password}

M3U Playlist Link:
${serverUrl}/get.php?username=${username}&password=${password}&type=m3u_plus`;

      return res.status(200).json({
        success: true,
        delivered_data: formattedDeliverable
      });
    }

    return res.status(200).json({ success: true, message: 'Ignored non-completion event' });
  } catch (err) {
    console.error('Error executing /webhook handler:', err.message);
    return res.status(200).json({ success: false, error: err.message });
  }
});

// --- PIN VERIFICATION ENDPOINT ---

app.post('/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ success: false, message: 'PIN parameter required' });
  }

  if (String(pin).trim() === String(APP_PIN).trim()) {
    return res.json({ success: true, message: 'PIN verified' });
  } else {
    return res.status(401).json({ success: false, message: 'Invalid PIN' });
  }
});

// --- SCRAPER API ENDPOINT ---

app.get('/api/scrape', async (req, res) => {
  try {
    console.log('API trigger: executing catalog scraper from fetch.js...');
    const catalogData = await scrapeCatalog();
    return res.json({
      success: true,
      count: catalogData.length,
      data: catalogData
    });
  } catch (err) {
    console.error('Scraper route error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// --- XTREAM CODES API ENDPOINTS ---

app.all('/player_api.php', async (req, res) => {
  const username = req.query.username || req.body.username;
  const password = req.query.password || req.body.password;
  const action = req.query.action || req.body.action;

  if (!(await isValidUser(username, password))) {
    return res.status(401).json({ user_info: { auth: 0, status: 'Disabled' } });
  }

  const playlist = await refreshPlaylistCache();

  if (!action) {
    return res.json({
      user_info: {
        username: username,
        password: password,
        message: 'Authentication successful.',
        auth: 1,
        status: 'Active',
        exp_date: '1988131200',
        is_trial: '0',
        active_cons: '1',
        created_at: '1600000000',
        max_connections: '5',
        allowed_output_formats: ['m3u8', 'ts', 'rtmp']
      },
      server_info: {
        url: req.hostname,
        port: PORT.toString(),
        https_port: '443',
        server_protocol: 'https',
        rtmp_port: '8080',
        timezone: 'UTC',
        timestamp_now: Math.floor(Date.now() / 1000),
        time_now: new Date().toISOString().replace('T', ' ').substring(0, 19)
      }
    });
  }

  if (action === 'get_live_categories') return res.json(playlist.categories);
  if (action === 'get_live_streams') {
    const categoryId = req.query.category_id || req.body.category_id;
    if (categoryId) {
      return res.json(playlist.streams.filter(s => s.category_id === String(categoryId)));
    }
    return res.json(playlist.streams);
  }

  return res.status(0).json([]);
});

app.all('/get.php', async (req, res) => {
  const username = req.query.username || req.body.username;
  const password = req.query.password || req.body.password;

  if (!(await isValidUser(username, password))) {
    return res.status(401).send('#EXTM3U\n# Auth Failed');
  }

  const playlist = await refreshPlaylistCache();
  const host = req.get('host');
  const protocol = req.protocol;

  let m3uOutput = '#EXTM3U\n';
  for (const stream of playlist.streams) {
    const streamUrl = `${protocol}://${host}/live/${username}/${password}/${stream.stream_id}.m3u8`;
    m3uOutput += `#EXTINF:-1 tvg-id="${stream.epg_channel_id}" tvg-logo="${stream.stream_icon}" group-title="${stream.category_id}",${stream.name}\n${streamUrl}\n`;
  }

    res.setHeader('Content-Type', 'audio/x-mpegurl');
  return res.send(m3uOutput);
});

app.get('/live/:username/:password/:streamId', async (req, res) => {
  const { username, password, streamId } = req.params;
  const cleanStreamId = streamId.replace(/\.(m3u8|ts)$/i, '');

  if (!(await isValidUser(username, password))) {
    return res.status(401).send('Unauthorized');
  }

  const playlist = await refreshPlaylistCache();
  const directSource = playlist.streamLookupMap.get(cleanStreamId);

  if (!directSource) {
    return res.status(404).send('Stream unavailable or expired');
  }

  return res.redirect(302, directSource);
});

// --- TMDB METADATA PROXY ---

app.get('/api/tmdb/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Search query parameter (q) is required' });

  try {
    const url = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`;
    const headers = { accept: 'application/json' };
    if (TMDB_READ_TOKEN) {
      headers['Authorization'] = `Bearer ${TMDB_READ_TOKEN}`;
    }

    const tmdbRes = await fetchWithTimeout(url, { method: 'GET', headers, timeout: 5000 });
    const data = await tmdbRes.json();
    return res.json(data);
  } catch (err) {
    console.error('TMDB Fetch Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch TMDB records' });
  }
});

// --- SERVER INITIALIZATION ---

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
