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

// Stream assets configuration
const PRIMARY_STREAM = process.env.STREAM_URL;
const FALLBACK_VIDEO = path.join(__dirname, 'public/offair.mp4');
const TECH_DIFFICULTIES_VIDEO = path.join(__dirname, 'public/technical_difficulties.mp4');
const SCREENBUG_IMAGE = path.join(__dirname, 'public/screenbug.png');
const HLS_OUTPUT_FILE = path.join(hlsOutputDir, 'index.m3u8');

let ffmpegProcess = null;
let currentBlock = null; // 'day' or 'night'

// Helper function to get current Eastern Time hour (0 - 23)
function getETHour() {
  const now = new Date();
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(etString).getHours();
}

// Determine source file/stream based on schedule
function getScheduleSource() {
  const hour = getETHour();
  
  // 6:00 AM (6) up to 6:00 PM (18) = Cartoon Network
  if (hour >= 6 && hour < 18) {
    currentBlock = 'day';
    console.log(`[Schedule] ${hour}:00 ET - Daytime: Playing Cartoon Network`);
    
    // Fall back to technical_difficulties.mp4 or offair.mp4 if primary stream URL is unset
    const fallback = fs.existsSync(TECH_DIFFICULTIES_VIDEO) ? TECH_DIFFICULTIES_VIDEO : FALLBACK_VIDEO;
    return { 
      source: PRIMARY_STREAM || fallback, 
      isLooping: !PRIMARY_STREAM 
    };
  } else {
    currentBlock = 'night';
    console.log(`[Schedule] ${hour}:00 ET - Nighttime: Playing Sign-Off / Off-Air Bumper`);
    return { 
      source: FALLBACK_VIDEO, 
      isLooping: true 
    };
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

  const args = ['-y', '-loglevel', 'warning'];

  if (isLooping) {
    args.push('-stream_loop', '-1');
  }

  // Input 0: Video stream or file
  args.push('-i', inputSource);

  const hasBug = fs.existsSync(SCREENBUG_IMAGE);

  // Input 1: Screenbug overlay image (if file exists)
  if (hasBug) {
    args.push('-i', SCREENBUG_IMAGE);
  }

  // Filter configuration for screenbug positioning
  if (hasBug) {
    // Scales screenbug width to 110px and overlays in bottom-right corner
    args.push(
      '-filter_complex', '[1:v]scale=110:-1[bug];[0:v][bug]overlay=main_w-overlay_w-20:main_h-overlay_h-20'
    );
  }

  args.push(
    // Optimized video encoding parameters
    '-threads', '1',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '28',
    
    // Audio encoding parameters
    '-c:a', 'aac',
    '-b:a', '96k',
    
    // HLS segmenting settings
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
    
    // Auto-restart stream if it unexpectedly drops
    setTimeout(() => {
      const active = getScheduleSource();
      startFFmpeg(active.source, active.isLooping);
    }, 3000);
  });
}

// Start stream on initial boot
const initial = getScheduleSource();
startFFmpeg(initial.source, initial.isLooping);

// Schedule watcher (runs every minute)
setInterval(() => {
  const hour = getETHour();
  const targetBlock = (hour >= 6 && hour < 18) ? 'day' : 'night';

  if (targetBlock !== currentBlock) {
    console.log(`[Schedule Alert] Time is now ${hour}:00 ET. Switching block to ${targetBlock.toUpperCase()}...`);
    const active = getScheduleSource();
    startFFmpeg(active.source, active.isLooping);
  }
}, 60 * 1000);

// Health check route
app.get('/', (req, res) => {
  res.send('Cartoon Network Webchannel Stream Server is Running.');
});

app.listen(PORT, () => {
  console.log(`[Node] Server listening on port ${PORT}`);
});
