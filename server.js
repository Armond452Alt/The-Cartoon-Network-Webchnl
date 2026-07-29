const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS using native Express middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Ensure public directories exist
const publicDir = path.join(__dirname, 'public');
const hlsOutputDir = path.join(__dirname, 'public/hls');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
if (!fs.existsSync(hlsOutputDir)) {
  fs.mkdirSync(hlsOutputDir, { recursive: true });
}

// Serve static HLS files
app.use('/public', express.static(publicDir));

// Stream configuration
const PRIMARY_STREAM = process.env.STREAM_URL;
const FALLBACK_VIDEO = path.join(__dirname, 'public/offair.mp4');
const HLS_OUTPUT_FILE = path.join(hlsOutputDir, 'index.m3u8');

let ffmpegProcess = null;
let currentBlock = null; // 'day' or 'night'

// Helper function to get current Eastern Time hour (0 - 23)
function getETHour() {
  const now = new Date();
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(etString).getHours();
}

// Determine if we should stream CN or Off-Air based on 6:00 AM / 6:00 PM sign-off
function getScheduleSource() {
  const hour = getETHour();
  // 6:00 AM (6) up to 6:00 PM (18) = Cartoon Network
  if (hour >= 6 && hour < 18) {
    currentBlock = 'day';
    console.log(`[Schedule] ${hour}:00 ET - Daytime: Playing Cartoon Network`);
    return { source: PRIMARY_STREAM || FALLBACK_VIDEO, isLooping: !PRIMARY_STREAM };
  } else {
    currentBlock = 'night';
    console.log(`[Schedule] ${hour}:00 ET - Nighttime: Playing Sign-Off / Off-Air Bumper`);
    return { source: FALLBACK_VIDEO, isLooping: true };
  }
}

function stopFFmpeg() {
  if (ffmpegProcess) {
    ffmpegProcess.removeAllListeners('close');
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
  }
}

function startFFmpeg(inputSource, isLooping = false) {
  stopFFmpeg();

  console.log(`[Node] Starting FFmpeg process. Source: ${inputSource}`);

  const args = [
    '-y',
    '-loglevel', 'warning'
  ];

  // Loop the file endlessly if playing local bumper
  if (isLooping) {
    args.push('-stream_loop', '-1');
  }

  args.push(
    '-i', inputSource,
    
    // RAM and CPU optimizations for Render (512 MB limit)
    '-threads', '1',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '28',
    
    // Audio encoding
    '-c:a', 'aac',
    '-b:a', '96k',
    
    // HLS output configuration
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '5',
    '-hls_flags', 'delete_segments',
    HLS_OUTPUT_FILE
  );

  ffmpegProcess = spawn('ffmpeg', args);

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[FFmpeg LOG]: ${data.toString().trim()}`);
  });

  ffmpegProcess.on('close', (code, signal) => {
    console.log(`[FFmpeg EXIT] Code: ${code}, Signal: ${signal}`);
    
    // Auto-restart stream if it unexpectedly stops
    setTimeout(() => {
      const active = getScheduleSource();
      startFFmpeg(active.source, active.isLooping);
    }, 3000);
  });
}

// Initial Stream Startup
const initial = getScheduleSource();
startFFmpeg(initial.source, initial.isLooping);

// Check schedule every 1 minute for automatic sign-on / sign-off switching
setInterval(() => {
  const hour = getETHour();
  const targetBlock = (hour >= 6 && hour < 18) ? 'day' : 'night';

  if (targetBlock !== currentBlock) {
    console.log(`[Schedule Alert] Time is now ${hour}:00 ET. Switching programming block to ${targetBlock.toUpperCase()}...`);
    const active = getScheduleSource();
    startFFmpeg(active.source, active.isLooping);
  }
}, 60 * 1000);

// Health check endpoint for Render
app.get('/', (req, res) => {
  res.send('Cartoon Network Webchannel Stream Server is Running.');
});

app.listen(PORT, () => {
  console.log(`[Node] Server listening on port ${PORT}`);
});
