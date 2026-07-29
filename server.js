const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS so GitHub Pages and other sites can fetch the stream
app.use(cors());

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

function startFFmpeg(inputSource, isLooping = false) {
  console.log(`[Node] Spawning FFmpeg process. Source: ${inputSource}`);

  const args = [
    '-y',
    '-loglevel', 'warning'
  ];

  // Loop the local file infinitely if using fallback video
  if (isLooping) {
    args.push('-stream_loop', '-1');
  }

  args.push(
    '-i', inputSource,
    
    // RAM and CPU optimizations for Render's 512 MB limit
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

  // Spawn system-installed FFmpeg directly
  ffmpegProcess = spawn('ffmpeg', args);

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[FFmpeg LOG]: ${data.toString().trim()}`);
  });

  ffmpegProcess.on('close', (code, signal) => {
    console.log(`[FFmpeg EXIT] Code: ${code}, Signal: ${signal}`);

    // If primary stream fails/dies, switch to the local offair.mp4 fallback
    if (!isLooping) {
      console.log('[Node] Primary stream stopped. Switching to Off-Air Bumper in 3 seconds...');
      setTimeout(() => {
        if (fs.existsSync(FALLBACK_VIDEO)) {
          startFFmpeg(FALLBACK_VIDEO, true);
        } else {
          console.error(`[Node ERROR] Fallback file missing at ${FALLBACK_VIDEO}`);
        }
      }, 3000);
    }
  });
}

// Check startup conditions
if (PRIMARY_STREAM && PRIMARY_STREAM.startsWith('http')) {
  startFFmpeg(PRIMARY_STREAM, false);
} else if (fs.existsSync(FALLBACK_VIDEO)) {
  console.log('[Node] No valid STREAM_URL found. Starting Off-Air stream.');
  startFFmpeg(FALLBACK_VIDEO, true);
} else {
  console.error('[Node ERROR] No STREAM_URL set and public/offair.mp4 was not found.');
}

// Health check endpoint for Render
app.get('/', (req, res) => {
  res.send('Cartoon Network Webchannel Stream Server is Running.');
});

app.listen(PORT, () => {
  console.log(`[Node] Server is listening on port ${PORT}`);
});
