const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS using native Express middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Ensure required public directories exist
const publicDir = path.join(__dirname, 'public');
const showsDir = path.join(__dirname, 'public/Shows');
const hlsOutputDir = path.join(__dirname, 'public/hls');

[publicDir, showsDir, hlsOutputDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Serve static HLS files and public assets
app.use('/public', express.static(publicDir));
app.use(express.static(publicDir));

// Fallback & Overlay Configuration
const FALLBACK_VIDEO = path.join(__dirname, 'public/offair.mp4');
const TECH_DIFFICULTIES_VIDEO = path.join(__dirname, 'public/technical_difficulties.mp4');
const SCREENBUG_IMAGE = path.join(__dirname, 'public/screenbug.png');
const HLS_OUTPUT_FILE = path.join(hlsOutputDir, 'index.m3u8');

// Default Live Stream Fallback (Outside daytime schedule)
const ADULT_SWIM_STREAM = process.env.STREAM_URL || "https://turnerlive.warnermediacdn.com/hls/live/2023185/aswest/noslate/VIDEO_1_5128000.m3u8";

// Custom Daytime Show Schedule (12 PM - 8 PM ET)
const SHOW_SCHEDULE = {
  12: { title: 'Regular Show: The Lost Tapes', files: ['rs_lost_tapes_pt1.mp4', 'rs_lost_tapes_pt2.mp4'] },
  13: { title: 'The Wonderfully Weird World of Gumball', files: ['twwwog_s01e01_pt1.mp4', 'twwwog_s01e01_pt2.mp4', 'twwwog_s01e01_pt3.mp4'] },
  14: { title: 'The Amazing World of Gumball', files: ['part-0.mp4', 'part-1.mp4', 'part-2.mp4'] },
  15: { title: 'Uncle Grandpa', files: ['uncle_grandpa.mp4'] },
  16: { title: 'Regular Show (Original)', files: ['regular_show.mp4'] },
  17: { title: 'Adventure Time', files: ['adventure_time.mp4'] },
  20: { title: 'Adult Swim West', files: [], isLive: true, url: ADULT_SWIM_STREAM }
};

let ffmpegProcess = null;
let currentSlot = null;

// Reliable Eastern Time hour retriever (0 - 23)
function getETHour() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false
  });
  const hour = parseInt(formatter.format(new Date()), 10);
  return hour === 24 ? 0 : hour;
}

// Get video source based on current Eastern Time schedule
function getScheduleSource() {
  const hour = getETHour();

  // Check if current hour falls within schedule
  if (SHOW_SCHEDULE[hour]) {
    const show = SHOW_SCHEDULE[hour];

    // Check if slot is a live network stream (e.g., Adult Swim at 8 PM ET)
    if (show.isLive) {
      currentSlot = `show_${hour}`;
      console.log(`[Schedule] ${hour}:00 ET - Airing Live Stream: ${show.title}`);
      return { source: show.url, isConcat: false, isLooping: false };
    }

    const existingFiles = show.files
      .map(file => path.join(showsDir, file))
      .filter(filePath => fs.existsSync(filePath));

    currentSlot = `show_${hour}`;
    console.log(`[Schedule] ${hour}:00 ET - Airing: ${show.title}`);

    if (existingFiles.length > 0) {
      // Multiple parts: build an FFmpeg concat list text file
      if (existingFiles.length > 1) {
        const concatListPath = path.join(showsDir, `concat_${hour}.txt`);
        const fileContent = existingFiles.map(f => `file '${f}'`).join('\n');
        fs.writeFileSync(concatListPath, fileContent);
        
        return { source: concatListPath, isConcat: true, isLooping: true };
      }
      return { source: existingFiles[0], isConcat: false, isLooping: true };
    } else {
      console.log(`[Schedule Warning] Files missing for "${show.title}". Playing technical difficulties.`);
      const fallback = fs.existsSync(TECH_DIFFICULTIES_VIDEO) ? TECH_DIFFICULTIES_VIDEO : FALLBACK_VIDEO;
      return { source: fallback, isConcat: false, isLooping: true };
    }
  }

  // Outside scheduled hours: Fall back to default primary live stream
  currentSlot = 'off_block';
  console.log(`[Schedule] ${hour}:00 ET - Outside primary daytime block. Airing live stream feed.`);
  return { source: ADULT_SWIM_STREAM, isConcat: false, isLooping: false };
}

function stopFFmpeg() {
  if (ffmpegProcess) {
    ffmpegProcess.removeAllListeners('close');
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
  }
}

function startFFmpeg(inputSource, isLooping = false, isConcat = false) {
  stopFFmpeg();

  console.log(`[Node] Starting FFmpeg process. Source: ${inputSource}`);

  const args = ['-y', '-loglevel', 'warning'];

  if (isLooping) {
    args.push('-stream_loop', '-1');
  }

  // If input is a multi-part concat list, add format flags
  if (isConcat) {
    args.push('-f', 'concat', '-safe', '0');
  }

  // Input 0: Main video content
  args.push('-i', inputSource);

  const hasBug = fs.existsSync(SCREENBUG_IMAGE);

  // Input 1: Screenbug overlay image (if present)
  if (hasBug) {
    args.push('-i', SCREENBUG_IMAGE);
  }

  // Overlay screenbug bottom-right if available
  if (hasBug) {
    args.push(
      '-filter_complex', '[1:v]scale=110:-1[bug];[0:v][bug]overlay=main_w-overlay_w-20:main_h-overlay_h-20'
    );
  }

  args.push(
    // Video encoding settings
    '-threads', '1',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '28',
    
    // Audio encoding settings
    '-c:a', 'aac',
    '-b:a', '96k',
    
    // HLS segmenting flags
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
    
    // Auto-restart stream on accidental crash or source finish
    setTimeout(() => {
      const active = getScheduleSource();
      startFFmpeg(active.source, active.isLooping, active.isConcat);
    }, 3000);
  });
}

// Initial boot initialization
const initial = getScheduleSource();
startFFmpeg(initial.source, initial.isLooping, initial.isConcat);

// Schedule watcher: Checks every minute to trigger hourly transitions
setInterval(() => {
  const hour = getETHour();
  const expectedSlot = SHOW_SCHEDULE[hour] ? `show_${hour}` : 'off_block';

  if (expectedSlot !== currentSlot) {
    console.log(`[Schedule Alert] Time is now ${hour}:00 ET. Switching block...`);
    const active = getScheduleSource();
    startFFmpeg(active.source, active.isLooping, active.isConcat);
  }
}, 60 * 1000);

// API: Schedule Endpoint
app.get('/api/schedule', (req, res) => {
  res.json(SHOW_SCHEDULE);
});

// API: Currently active program
app.get('/api/now-playing', (req, res) => {
  const hour = getETHour();
  const currentShow = SHOW_SCHEDULE[hour] || { title: 'Adult Swim West Live', files: [] };
  res.json({
    time: `${hour}:00 ET`,
    ...currentShow
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('Cartoon Network Webchannel Stream Server is Running.');
});

// Fallback route to serve index.html or HLS player
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.redirect('/public/hls/index.m3u8');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Node] Server listening on port ${PORT}`);
});
