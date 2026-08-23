const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const NodeMediaServer = require('node-media-server');
const { generateEASAudio, EAS_AUDIO_PATH } = require('./easAudio');

const app = express();
const PORT = process.env.PORT || 10000;
const RTMP_PORT = process.env.RTMP_PORT || 1935;

// Direct directory declarations
const publicDir = path.join(__dirname, 'public');
const showsDir = path.join(__dirname, 'public/Shows');
const bumpersDir = path.join(__dirname, 'public/bumpers');
const hlsOutputDir = path.join(__dirname, 'public/hls');
const fontsDir = path.join(__dirname, 'public/fonts');

[publicDir, showsDir, bumpersDir, hlsOutputDir, fontsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// File Constants defined BEFORE route registration
const HLS_OUTPUT_FILE = path.join(hlsOutputDir, 'index.m3u8');
const FALLBACK_VIDEO = path.join(publicDir, 'offair.mp4');
const TECH_DIFFICULTIES_VIDEO = path.join(publicDir, 'technical_difficulties.mp4');
const DEFAULT_BUMPER = path.join(bumpersDir, 'next_bumper.mp4');
const SCREENBUG_IMAGE = path.join(publicDir, 'logo.png');
const EASYPLUS_FONT = path.join(fontsDir, 'easyplus.otf');

const ADULT_SWIM_STREAM = process.env.STREAM_URL || "https://turnerlive.warnermediacdn.com/hls/live/2023185/aswest/noslate/VIDEO_1_5128000.m3u8";

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// Serve HLS directory explicitly with strict no-cache and MIME types
app.use('/public/hls', express.static(hlsOutputDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/x-mpegURL');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/MP2T');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

app.use('/public', express.static(publicDir));
app.use(express.static(publicDir));

// Stream delivery endpoint
app.get(['/hls/index.m3u8', '/public/hls/index.m3u8'], (req, res) => {
  if (fs.existsSync(HLS_OUTPUT_FILE)) {
    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(HLS_OUTPUT_FILE);
  }
  res.status(503).setHeader('Content-Type', 'text/plain').send('Stream segment initializing...');
});

let easActive = false;
let easDetails = null;

const SHOW_SCHEDULE = {
  9:  { title: 'Cartoon Network Sign-On', rating: 'TV-G', ratingImg: 'tv_g.png', bumper: 'next_cn.mp4', files: ['cn_sign_on.mp4'] },
  10: { 
    title: "Foster's Home for Imaginary Friends (S06E08 & S06E09)", 
    rating: 'TV-Y7', ratingImg: 'tv_y7.png', bumper: 'fhoif.mp4', isMultiUrl: true,
    urls: [
      'https://ia802900.us.archive.org/34/items/fosters-home-for-imaginary-friends-the-complete-series_202507/Foster_s_Home_For_Imaginary_Friends_S06E08.mp4',
      'https://ia902900.us.archive.org/34/items/fosters-home-for-imaginary-friends-the-complete-series_202507/Foster_s_Home_For_Imaginary_Friends_S06E09.mp4'
    ]
  },
  11: { title: 'Regular Show: The Lost Tapes', rating: 'TV-PG', ratingImg: 'tv_pg.png', bumper: 'next_regular_show.mp4', files: ['rs_lost_tapes_pt1.mp4', 'rs_lost_tapes_pt2.mp4'] },
  12: { title: 'The Wonderfully Weird World of Gumball', rating: 'TV-Y7-FV', ratingImg: 'tv_y7_fv.png', bumper: 'twwwog.mp4', files: ['twwwog_s01e01_pt1.mp4', 'twwwog_s01e01_pt3.mp4', 'twwwog_s01e01_pt2.mp4'] },
  13: { title: 'The Amazing World of Gumball', rating: 'TV-Y7', ratingImg: 'tv_y7.png', bumper: 'tawog.mp4', files: ['part-0.mp4', 'part-1.mp4', 'part-2.mp4'] },
  14: { title: 'Uncle Grandpa', rating: 'TV-Y7', ratingImg: 'tv_y7.png', bumper: 'UG.mp4', files: ['uncle_grandpa.mp4'] },
  15: { title: 'Clarence', rating: 'TV-PG', ratingImg: 'tv_pg.png', bumper: 'next_clarence.mp4', files: ['part_01.mp4', 'part_02.mp4', 'part_03.mp4'] },
  16: { title: 'Regular Show (Original)', rating: 'TV-PG', ratingImg: 'tv_pg.png', bumper: 'next_regular_show.mp4', files: ['regular_show.mp4'] },
  17: { title: 'Adventure Time', rating: 'TV-PG', ratingImg: 'tv_pg.png', bumper: 'adv.mp4', files: ['adventure_time.mp4'] },
  20: { title: 'Adult Swim West', rating: 'TV-MA', ratingImg: 'tv_ma.png', isLive: true, url: ADULT_SWIM_STREAM }
};

let ffmpegProcess = null;
let currentSlot = null;

function getETHour() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false
  });
  const hour = parseInt(formatter.format(new Date()), 10);
  return hour === 24 ? 0 : hour;
}

function getBumperPath(bumperFilename) {
  if (bumperFilename) {
    const customBumper = path.join(bumpersDir, bumperFilename);
    if (fs.existsSync(customBumper)) return customBumper;
  }
  return fs.existsSync(DEFAULT_BUMPER) ? DEFAULT_BUMPER : null;
}

function getScheduleSource() {
  const hour = getETHour();

  if (SHOW_SCHEDULE[hour]) {
    const show = SHOW_SCHEDULE[hour];

    if (show.isMultiUrl && Array.isArray(show.urls)) {
      currentSlot = `show_${hour}`;
      const concatListPath = path.join(showsDir, `concat_${hour}.txt`);
      const activeBumper = getBumperPath(show.bumper);
      let concatLines = [];

      show.urls.forEach((url, idx) => {
        if (activeBumper && idx > 0) concatLines.push(`file '${activeBumper}'`);
        concatLines.push(`file '${url}'`);
      });

      fs.writeFileSync(concatListPath, concatLines.join('\n'));
      return { source: concatListPath, ratingImg: show.ratingImg, isConcat: true, isLooping: true };
    }

    if (show.isLive) {
      currentSlot = `show_${hour}`;
      return { source: show.url, ratingImg: show.ratingImg, isConcat: false, isLooping: false };
    }

    const existingFiles = (show.files || [])
      .map(file => path.join(showsDir, file))
      .filter(filePath => fs.existsSync(filePath));

    currentSlot = `show_${hour}`;

    if (existingFiles.length > 0) {
      const activeBumper = getBumperPath(show.bumper);

      if (existingFiles.length > 1 || activeBumper) {
        const concatListPath = path.join(showsDir, `concat_${hour}.txt`);
        let concatLines = [];

        existingFiles.forEach((file, idx) => {
          if (activeBumper && idx > 0) concatLines.push(`file '${activeBumper}'`);
          concatLines.push(`file '${file}'`);
        });

        fs.writeFileSync(concatListPath, concatLines.join('\n'));
        return { source: concatListPath, ratingImg: show.ratingImg, isConcat: true, isLooping: true };
      }

      return { source: existingFiles[0], ratingImg: show.ratingImg, isConcat: false, isLooping: true };
    }
  }

  // Fallback to live stream if file block is empty or out-of-schedule
  currentSlot = 'off_block';
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

  console.log(`[FFmpeg] Starting encoding process for: ${inputSource}`);

  const args = [
    '-y',
    '-loglevel', 'info',
    '-fflags', '+genpts'
  ];

  // Inject browser headers when connecting to remote HTTP/HLS live streams
  if (inputSource.startsWith('http://') || inputSource.startsWith('https://')) {
    const customHeaders = [
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0',
      'Referer: https://www.adultswim.com/',
      'Origin: https://www.adultswim.com'
    ].join('\r\n') + '\r\n';

    args.push('-headers', customHeaders);
  }

  if (isLooping) args.push('-stream_loop', '-1');
  if (isConcat) args.push('-f', 'concat', '-safe', '0');

  args.push('-i', inputSource);

  const ratingPath = ratingImgName ? path.join(publicDir, ratingImgName) : null;
  const hasRating = ratingPath && fs.existsSync(ratingPath);
  const hasBug = fs.existsSync(SCREENBUG_IMAGE);
  const hasEasAudio = easActive && fs.existsSync(EAS_AUDIO_PATH);

  if (hasRating) args.push('-i', ratingPath);
  if (hasBug) args.push('-i', SCREENBUG_IMAGE);
  if (hasEasAudio) args.push('-i', EAS_AUDIO_PATH);

  let nextInputIndex = 1;
  const ratingInputIdx = hasRating ? nextInputIndex++ : null;
  const bugInputIdx = hasBug ? nextInputIndex++ : null;
  const easAudioInputIdx = hasEasAudio ? nextInputIndex++ : null;

  let filterComplex = '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-ih)/2:(oh-ih)/2[bg];';
  let lastVideoPad = '[bg]';

  if (hasRating && hasBug) {
    filterComplex += `[${ratingInputIdx}:v]scale=130:-1[rating];` +
      `[${bugInputIdx}:v]scale=100:-1,format=rgba,colorchannelmixer=aa=0.85[bug];` +
      `[bg][rating]overlay=40:40:enable='between(t,0,5)'[tmp];` +
      `[tmp][bug]overlay=main_w-overlay_w-40:40[voverlay];`;
    lastVideoPad = '[voverlay]';
  } else if (hasRating) {
    filterComplex += `[${ratingInputIdx}:v]scale=130:-1[rating];[bg][rating]overlay=40:40:enable='between(t,0,5)'[voverlay];`;
    lastVideoPad = '[voverlay]';
  } else if (hasBug) {
    filterComplex += `[${bugInputIdx}:v]scale=100:-1,format=rgba,colorchannelmixer=aa=0.85[bug];` +
      `[bg][bug]overlay=main_w-overlay_w-40:40[voverlay];`;
    lastVideoPad = '[voverlay]';
  }

  if (easActive && easDetails) {
    const safeText = easDetails.text.replace(/'/g, '').replace(/:/g, '\\:');
    const fontOpt = fs.existsSync(EASYPLUS_FONT) ? `:fontfile='${EASYPLUS_FONT.replace(/\\/g, '/')}'` : '';
    filterComplex += `${lastVideoPad}drawtext=text='${safeText}'${fontOpt}:fontcolor=white:fontsize=28:box=1:boxcolor=red@0.85:boxborderw=8:x=w-mod(max(t-2\\,0)*180\\,w+tw):y=40[vout];`;
  } else {
    filterComplex += `${lastVideoPad}null[vout];`;
  }
  if (hasEasAudio) {
    filterComplex += `[${easAudioInputIdx}:a]volume=1.0[outa]`;
  } else {
    filterComplex += `[0:a]volume=1.0[outa]`;
  }

  args.push('-filter_complex', filterComplex);
  args.push('-map', '[vout]', '-map', '[outa]');

  args.push(
    '-threads', '1',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level:v', '3.1',
    '-pix_fmt', 'yuv420p',
    '-b:v', '1500k',
    '-maxrate', '1800k',
    '-bufsize', '2000k',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', '44100',
    '-ac', '2',
    '-af', 'aresample=async=1'
  );

  args.push(
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '4',
    '-hls_flags', 'delete_segments+omit_endlist',
    '-hls_segment_type', 'mpegts',
    HLS_OUTPUT_FILE
  );

  ffmpegProcess = spawn('ffmpeg', args);

  // Full error logging to identify any unexpected exit cause
  ffmpegProcess.stderr.on('data', (data) => {
    console.error(`[FFmpeg STDERR]: ${data.toString().trim()}`);
  });

  ffmpegProcess.on('close', (code, signal) => {
    console.log(`[FFmpeg EXIT] Process ended with code ${code}. Restarting stream engine in 3s...`);
    setTimeout(() => {
      const active = getScheduleSource();
      startFFmpeg(active.source, active.isLooping, active.isConcat, active.ratingImg);
    }, 3000);
  });
}

// Disable GOP caching in NodeMediaServer
const nms = new NodeMediaServer({
  rtmp: { port: RTMP_PORT, chunk_size: 4096, gop_cache: false, ping: 30, ping_timeout: 60 }
});
nms.run();

// Xtream Codes Emulation API
app.get(['/player_api.php', '/get.php'], (req, res) => {
  const hostUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  const action = req.query.action;

  if (action === 'get_live_categories') {
    return res.json([{ category_id: "1", category_name: "Animation", parent_id: 0 }]);
  }

  if (action === 'get_live_streams') {
    return res.json([{
      num: 1,
      name: process.env.CHANNEL_NAME || "Cartoon Network Webchnl",
      stream_type: "live",
      stream_id: 1001,
      stream_icon: `${hostUrl}/public/logo.png`,
      epg_channel_id: process.env.TVG_ID || "CartoonNetworkOnWebchnl.us",
      category_id: "1"
    }]);
  }

  res.json({
    user_info: { status: "Active", allowed_output_formats: ["m3u8", "ts"] },
    server_info: { url: hostUrl.replace(/^https?:\/\//, ''), port: PORT, rtmp_port: RTMP_PORT }
  });
});

app.get('/live/:username/:password/:stream_id', (req, res) => {
  res.redirect('/public/hls/index.m3u8');
});

// Playlist endpoint
app.get('/playlist.m3u', (req, res) => {
  const hour = getETHour();
  const currentShow = SHOW_SCHEDULE[hour] || { title: 'Adult Swim West Live' };
  const hostUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;

  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Content-Disposition', 'inline; filename="playlist.m3u"');

  const m3uContent = `#EXTM3U
#EXTINF:-1 tvg-id="CartoonNetworkOnWebchnl.us" tvg-name="Cartoon Network Webchnl" tvg-logo="${hostUrl}/public/logo.png" group-title="Webchnl",Cartoon Network - ${currentShow.title}
${hostUrl}/public/hls/index.m3u8
`;

  res.send(m3uContent);
});

app.get('/health', (req, res) => res.send('OK'));

// Catch-all SPA route
app.get('*', (req, res) => {
  if (req.path.endsWith('.m3u8') || req.path.endsWith('.ts')) {
    return res.status(404).setHeader('Content-Type', 'text/plain').send('Segment Not Found');
  }
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.redirect('/hls/index.m3u8');
});

// Launch server & initial FFmpeg instance
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Running on port ${PORT}`);
  const initial = getScheduleSource();
  startFFmpeg(initial.source, initial.isLooping, initial.isConcat, initial.ratingImg);
});
