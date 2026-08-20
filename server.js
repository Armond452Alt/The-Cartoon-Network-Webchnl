const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const NodeMediaServer = require('node-media-server');

const app = express();
const PORT = process.env.PORT || 10000;
const RTMP_PORT = process.env.RTMP_PORT || 1935;

// Enable CORS for all web players, Xbox Edge, and external players
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// Directory layout setup
const publicDir = path.join(__dirname, 'public');
const showsDir = path.join(__dirname, 'public/Shows');
const bumpersDir = path.join(__dirname, 'public/bumpers');
const hlsOutputDir = path.join(__dirname, 'public/hls');

[publicDir, showsDir, bumpersDir, hlsOutputDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Serve public directory explicitly with static CORS
app.use('/public', express.static(publicDir));
app.use(express.static(publicDir));

// Asset Configuration
const FALLBACK_VIDEO = path.join(__dirname, 'public/offair.mp4');
const TECH_DIFFICULTIES_VIDEO = path.join(__dirname, 'public/technical_difficulties.mp4');
const DEFAULT_BUMPER = path.join(bumpersDir, 'next_bumper.mp4');
const SCREENBUG_IMAGE = path.join(__dirname, 'public/logo.png');
const HLS_OUTPUT_FILE = path.join(hlsOutputDir, 'index.m3u8');

const ADULT_SWIM_STREAM = process.env.STREAM_URL || "https://turnerlive.warnermediacdn.com/hls/live/2023185/aswest/noslate/VIDEO_1_5128000.m3u8";

// Schedule mapping
const SHOW_SCHEDULE = {
  9:  { title: 'Cartoon Network Sign-On', rating: 'TV-G', ratingImg: 'tv_g.png', bumper: 'next_cn.mp4', files: ['cn_sign_on.mp4'] },
  10: { 
    title: "Foster's Home for Imaginary Friends (S06E08 & S06E09)", 
    rating: 'TV-Y7', 
    ratingImg: 'tv_y7.png', 
    bumper: 'fhoif.mp4', 
    isMultiUrl: true,
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
        if (activeBumper && idx > 0) {
          concatLines.push(`file '${activeBumper}'`);
        }
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
          if (activeBumper && idx > 0) {
            concatLines.push(`file '${activeBumper}'`);
          }
          concatLines.push(`file '${file}'`);
        });

        fs.writeFileSync(concatListPath, concatLines.join('\n'));
        return { source: concatListPath, ratingImg: show.ratingImg, isConcat: true, isLooping: true };
      }

      return { source: existingFiles[0], ratingImg: show.ratingImg, isConcat: false, isLooping: true };
    } else {
      const fallback = fs.existsSync(TECH_DIFFICULTIES_VIDEO) ? TECH_DIFFICULTIES_VIDEO : FALLBACK_VIDEO;
      return { source: fallback, ratingImg: null, isConcat: false, isLooping: true };
    }
  }

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

  console.log(`[FFmpeg] Starting web-compatible HLS & RTMP stream. Source: ${inputSource}`);

  const args = [
    '-y',
    '-loglevel', 'warning',
    '-fflags', '+genpts'
  ];

  if (isLooping) args.push('-stream_loop', '-1');
  if (isConcat) args.push('-f', 'concat', '-safe', '0');

  args.push('-i', inputSource);

  const ratingPath = ratingImgName ? path.join(__dirname, 'public', ratingImgName) : null;
  const hasRating = ratingPath && fs.existsSync(ratingPath);
  const hasBug = fs.existsSync(SCREENBUG_IMAGE);

  if (hasRating) args.push('-i', ratingPath);
  if (hasBug) args.push('-i', SCREENBUG_IMAGE);

  const scaleBaseVideo = '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[bg];';
  const cnArabicBug = '[bug_raw]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[bug];';
  
  let filterComplex = '';

  if (hasRating && hasBug) {
    filterComplex = scaleBaseVideo + 
      '[1:v]scale=200:-1[rating];' + 
      '[2:v]' + cnArabicBug + 
      '[bg][rating]overlay=60:60:enable=\'between(t,0,5)\'[tmp];' + 
      '[tmp][bug]overlay=main_w-overlay_w-60:60';
  } else if (hasRating) {
    filterComplex = scaleBaseVideo + '[1:v]scale=200:-1[rating];[bg][rating]overlay=60:60:enable=\'between(t,0,5)\'';
  } else if (hasBug) {
    filterComplex = scaleBaseVideo + 
      '[1:v]' + cnArabicBug + 
      '[bg][bug]overlay=main_w-overlay_w-60:60';
  } else {
    filterComplex = '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2';
  }

  args.push('-filter_complex', filterComplex);

  // Common encoding flags
  args.push(
    '-threads', '2',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'main',
    '-level:v', '4.1',
    '-pix_fmt', 'yuv420p',
    '-b:v', '3500k',
    '-maxrate', '4500k',
    '-bufsize', '7000k',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-af', 'aresample=async=1'
  );

  // Dual output setup: HLS (.m3u8) + Local RTMP
  args.push(
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+omit_endlist',
    '-hls_segment_type', 'mpegts',
    HLS_OUTPUT_FILE,
    '-f', 'flv',
    `rtmp://127.0.0.1:${RTMP_PORT}/live/cnwebchannel`
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

// ----------------------------------------------------
// RTMP Server Setup
// ----------------------------------------------------
const nmsConfig = {
  rtmp: {
    port: RTMP_PORT,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  }
};
const nms = new NodeMediaServer(nmsConfig);
nms.run();

// ----------------------------------------------------
// Xtream Codes Emulation API
// ----------------------------------------------------
app.get(['/player_api.php', '/get.php'], (req, res) => {
  const username = req.query.username || 'user';
  const password = req.query.password || 'pass';
  const action = req.query.action;
  const hostUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  const logoUrl = process.env.LOGO_URL || `${hostUrl}/public/logo.png`;

  if (action === 'get_live_categories') {
    return res.json([{ category_id: "1", category_name: "Animation", parent_id: 0 }]);
  }

  if (action === 'get_live_streams') {
    return res.json([{
      num: 1,
      name: process.env.CHANNEL_NAME || "Cartoon Network Webchnl",
      stream_type: "live",
      stream_id: 1001,
      stream_icon: logoUrl,
      epg_channel_id: process.env.TVG_ID || "CartoonNetworkOnWebchnl.us",
      category_id: "1",
      custom_sid: "",
      direct_source: ""
    }]);
  }

  // Base Auth Info
  res.json({
    user_info: {
      username: username,
      password: password,
      message: "Active",
      auth: 1,
      status: "Active",
      exp_date: "1988117600",
      is_trial: "0",
      active_cons: "0",
      created_at: "1600000000",
      max_connections: "10",
      allowed_output_formats: ["m3u8", "ts"]
    },
    server_info: {
      url: hostUrl.replace(/^https?:\/\//, ''),
      port: PORT,
      https_port: "443",
      server_protocol: "https",
      rtmp_port: RTMP_PORT,
      timezone: "America/New_York"
    }
  });
});

// Xtream Stream Direct Endpoint: /live/:username/:password/:stream_id.:ext
app.get('/live/:username/:password/:stream_id', (req, res) => {
  res.redirect('/public/hls/index.m3u8');
});

// ----------------------------------------------------
// Standard Endpoints
// ----------------------------------------------------
app.get('/playlist.m3u', (req, res) => {
  const hour = getETHour();
  const currentShow = SHOW_SCHEDULE[hour] || { title: 'Adult Swim West Live' };

  const tvgId = process.env.TVG_ID || 'CartoonNetworkOnWebchnl.us';
  const tvgName = process.env.TVG_NAME || 'Cartoon Network Webchnl';
  const channelName = process.env.CHANNEL_NAME || 'Cartoon Network Webchnl';
  const groupTitle = process.env.GROUP_TITLE || 'Webchnl';
  const hostUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  const logoUrl = process.env.LOGO_URL || `${hostUrl}/public/logo.png`;

  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Content-Disposition', 'inline; filename="playlist.m3u"');

  const m3uContent = `#EXTM3U
#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${tvgName}" tvg-logo="${logoUrl}" group-title="${groupTitle}",${channelName} - ${currentShow.title}
${hostUrl}/public/hls/index.m3u8
`;

  res.send(m3uContent);
});

app.get('/api/schedule', (req, res) => res.json(SHOW_SCHEDULE));

app.get('/api/now-playing', (req, res) => {
  const hour = getETHour();
  const currentShow = SHOW_SCHEDULE[hour] || { title: 'Adult Swim West Live', rating: 'TV-MA', files: [] };
  const fileList = (currentShow.files && currentShow.files.length > 0)
    ? currentShow.files.map(f => `/Shows/${f}`)
    : (currentShow.urls || ['/hls/index.m3u8']);

  res.json({
    show: currentShow.title || 'Cartoon Network',
    rating: currentShow.rating || 'TV-G',
    title: `Airing at ${hour}:00 ET`,
    file: fileList[0],
    m3u8Url: '/hls/index.m3u8'
  });
});

app.get('/health', (req, res) => res.send('Cartoon Network Webchannel Stream Server is Running.'));

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.redirect('/hls/index.m3u8');
  }
});

const initial = getScheduleSource();
startFFmpeg(initial.source, initial.isLooping, initial.isConcat, initial.ratingImg);

setInterval(() => {
  const hour = getETHour();
  const expectedSlot = SHOW_SCHEDULE[hour] ? `show_${hour}` : 'off_block';

  if (expectedSlot !== currentSlot) {
    const active = getScheduleSource();
    startFFmpeg(active.source, active.isLooping, active.isConcat, active.ratingImg);
  }
}, 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Node] Server listening on port ${PORT}`);
  const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://the-cartoon-network-webchnl.onrender.com';

  setInterval(async () => {
    try {
      await fetch(`${RENDER_EXTERNAL_URL}/health`);
    } catch (err) {
      console.error(`[Self-Ping Error]:`, err.message);
    }
  }, 10 * 60 * 1000);
});
