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

// Serve static assets and HLS directory
app.use('/public', express.static(publicDir));
app.use(express.static(publicDir));

// Fallback Video, Bug, & Rating Assets Configuration
const FALLBACK_VIDEO = path.join(__dirname, 'public/offair.mp4');
const TECH_DIFFICULTIES_VIDEO = path.join(__dirname, 'public/technical_difficulties.mp4');
const SCREENBUG_IMAGE = path.join(__dirname, 'public/screenbug.png');
const HLS_OUTPUT_FILE = path.join(hlsOutputDir, 'index.m3u8');

// Default Live Stream Fallback (Outside daytime schedule)
const ADULT_SWIM_STREAM = process.env.STREAM_URL || "https://turnerlive.warnermediacdn.com/hls/live/2023185/aswest/noslate/VIDEO_1_5128000.m3u8";

// Schedule with TV Ratings (11 AM - 8 PM ET)
const SHOW_SCHEDULE = {
  11: { title: 'Cartoon Network Morning Block', rating: 'TV-G', ratingImg: 'tv_g.png', files: ['cn_sign_on.mp4'] },
  12: { title: 'Regular Show: The Lost Tapes', rating: 'TV-PG', ratingImg: 'tv_pg.png', files: ['rs_lost_tapes_pt1.mp4', 'rs_lost_tapes_pt2.mp4'] },
  13: { title: 'The Wonderfully Weird World of Gumball', rating: 'TV-Y7', ratingImg: 'tv_y7.png', files: ['twwwog_s01e01_pt1.mp4', 'twwwog_s01e01_pt2.mp4', 'twwwog_s01e01_pt3.mp4'] },
  14: { title: 'The Amazing World of Gumball', rating: 'TV-Y7', ratingImg: 'tv_y7.png', files: ['part-0.mp4', 'part-1.mp4', 'part-2.mp4'] },
  15: { title: 'Uncle Grandpa', rating: 'TV-Y7', ratingImg: 'tv_y7.png', files: ['uncle_grandpa.mp4'] },
  16: { title: 'Regular Show (Original)', rating: 'TV-PG', ratingImg: 'tv_pg.png', files: ['regular_show.mp4'] },
  17: { title: 'Adventure Time', rating: 'TV-PG', ratingImg: 'tv_pg.png', files: ['adventure_time.mp4'] },
  20: { title: 'Adult Swim West', rating: 'TV-MA', ratingImg: 'tv_ma.png', isLive: true, url: ADULT_SWIM_STREAM }
};

let ffmpegProcess = null;
let currentSlot = null;

// Reliable Eastern Time (America/New_York) hour retriever (0 - 23)
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

  if (SHOW_SCHEDULE[hour]) {
    const show = SHOW_SCHEDULE[hour];

    // Live network stream slot (e.g. Adult Swim at 8:00 PM ET)
    if (show.isLive) {
      currentSlot = `show_${hour}`;
      console.log(`[Schedule] ${hour}:00 ET - Airing Live Stream: ${show.title}`);
      return { source: show.url, ratingImg: show.ratingImg, isConcat: false, isLooping: false };
    }

    const existingFiles = show.files
      .map(file => path.join(showsDir, file))
      .filter(filePath => fs.existsSync(filePath));

    currentSlot = `show_${hour}`;
    console.log(`[Schedule] ${hour}:00 ET - Airing: ${show.title}`);

    if (existingFiles.length > 0) {
      // Build FFmpeg concat list if multiple files exist
      if (existingFiles.length > 1) {
        const concatListPath = path.join(showsDir, `concat_${hour}.txt`);
        const fileContent = existingFiles.map(f => `file '${f}'`).join('\n');
        fs.writeFileSync(concatListPath, fileContent);
        
        return { source: concatListPath, ratingImg: show.ratingImg, isConcat: true, isLooping: true };
      }
      return { source: existingFiles[0], ratingImg: show.ratingImg, isConcat: false, isLooping: true };
    } else {
      console.log(`[Schedule Warning] Files missing for "${show.title}". Playing technical difficulties.`);
      const fallback = fs.existsSync(TECH_DIFFICULTIES_VIDEO) ? TECH_DIFFICULTIES_VIDEO : FALLBACK_VIDEO;
      return { source: fallback, ratingImg: null, isConcat: false, isLooping: true };
    }
  }

  // Outside scheduled hours: Default to Adult Swim live stream
  currentSlot = 'off_block';
  console.log(`[Schedule] ${hour}:00 ET - Outside primary daytime block. Airing live stream feed.`);
  return { source: ADULT_SWIM_STREAM, ratingImg: 'tv_ma.png', isConcat: false, isLooping: false };
}

function stopFFmpeg() {
  if (ffmpegProcess) {
    ffmpegProcess.removeAllListeners('close');
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
  }
}

function startFFmpeg(inputSource, isLooping = false, isConcat = false, ratingImgName = null) {
  stopFFmpeg();

  console.log(`[Node] Starting FFmpeg process. Source: ${inputSource}`);

  const args = ['-y', '-loglevel', 'warning'];

  if (isLooping) args.push('-stream_loop', '-1');
  if (isConcat) args.push('-f', 'concat', '-safe', '0');

  // Input 0: Main Video Stream/File
  args.push('-i', inputSource);

  const ratingPath = ratingImgName ? path.join(__dirname, 'public', ratingImgName) : null;
  const hasRating = ratingPath && fs.existsSync(ratingPath);
  const hasBug = fs.existsSync(SCREENBUG_IMAGE);

  // Input 1 & 2: Overlays
  if (hasRating) args.push('-i', ratingPath);
  if (hasBug) args.push('-i', SCREENBUG_IMAGE);

  // Build filter complex for Rating (top-left) and Screenbug (bottom-right)
  let filterComplex = '';

  if (hasRating && hasBug) {
    filterComplex = '[1:v]scale=90:-1[rating];[2:v]scale=110:-1[bug];[0:v][rating]overlay=30:30[tmp];[tmp][bug]overlay=main_w-overlay_w-20:main_h-overlay_h-20';
  } else if (hasRating) {
    filterComplex = '[1:v]scale=90:-1[rating];[0:v][rating]overlay=30:30';
  } else if (hasBug) {
    filterComplex = '[1:v]scale=110:-1[bug];[0:v][bug]overlay=main_w-overlay_w-20:main_h-overlay_h-20';
  }

  if (filterComplex) {
    args.push('-filter_complex', filterComplex);
  }

  args.push(
    '-threads', '1',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '28',
    '-c:a', 'aac',
    '-b:a', '96k',
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
    setTimeout(() => {
      const active = getScheduleSource();
      startFFmpeg(active.source, active.isLooping, active.isConcat, active.ratingImg);
    }, 3000);
  });
}

// Initial Boot Engine Initialization
const initial = getScheduleSource();
startFFmpeg(initial.source, initial.isLooping, initial.isConcat, initial.ratingImg);

// Schedule watcher: Checks every minute for hourly block transitions
setInterval(() => {
  const hour = getETHour();
  const expectedSlot = SHOW_SCHEDULE[hour] ? `show_${hour}` : 'off_block';

  if (expectedSlot !== currentSlot) {
    console.log(`[Schedule Alert] Time is now ${hour}:00 ET. Switching block...`);
    const active = getScheduleSource();
    startFFmpeg(active.source, active.isLooping, active.isConcat, active.ratingImg);
  }
}, 60 * 1000);

// API: Complete Schedule Endpoint
app.get('/api/schedule', (req, res) => {
  res.json(SHOW_SCHEDULE);
});

// API: Current Show and Rating Information (for index.html and EPGs)
app.get('/api/now-playing', (req, res) => {
  const hour = getETHour();
  const currentShow = SHOW_SCHEDULE[hour] || { 
    title: 'Adult Swim West Live', 
    rating: 'TV-MA', 
    files: [] 
  };

  const fileList = (currentShow.files && currentShow.files.length > 0)
    ? currentShow.files.map(f => `/Shows/${f}`)
    : ['/public/hls/index.m3u8'];

  res.json({
    show: currentShow.title || 'Cartoon Network',
    rating: currentShow.rating || 'TV-G',
    title: `Airing at ${hour}:00 ET`,
    file: fileList[0],
    playlist: fileList
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('Cartoon Network Webchannel Stream Server is Running.');
});

// Fallback Route: Serve index.html or redirect to live stream
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
      
