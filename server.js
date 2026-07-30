const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

// Adult Swim West Live M3U8 Stream URL
const ADULT_SWIM_M3U8 = "https://turnerlive.warnermediacdn.com/hls/live/2023185/aswest/noslate/VIDEO_1_5128000.m3u8";

// Program Schedule
const schedule = [
  {
    time: "06:00", // 6:00 AM Sign-On
    type: "bumper",
    show: "Cartoon Network Sign-On",
    title: "Good Morning",
    file: path.join(__dirname, 'public', 'Shows', 'cn_sign_on.mp4')
  },
  {
    time: "13:00", // 1:00 PM Slot
    type: "show",
    show: "The Wonderfully Weird World of Gumball",
    title: "The Burger",
    file: path.join(__dirname, 'public', 'Shows', 'twwwog_s01e01.mp4')
  },
  {
    time: "14:00", // 2:00 PM Slot
    type: "show",
    show: "The Amazing World of Gumball",
    title: "The Kids / The Fan",
    file: path.join(__dirname, 'public', 'Shows', 'tawog_s03e01.mp4')
  },
  {
    time: "20:00", // 8:00 PM CN Sign-Off
    type: "bumper",
    show: "Cartoon Network Sign-Off",
    title: "Good Night",
    file: path.join(__dirname, 'public', 'Shows', 'cn_sign_off.mp4')
  },
  {
    time: "20:01", // 8:01 PM Adult Swim Sign-On
    type: "bumper",
    show: "Adult Swim Sign-On",
    title: "All Kids Out of the Pool",
    file: path.join(__dirname, 'public', 'Shows', 'as_sign_on.mp4')
  },
  {
    time: "20:02", // Live Adult Swim West Stream
    type: "livestream",
    show: "Adult Swim West",
    title: "Live Stream (HD)",
    file: ADULT_SWIM_M3U8
  }
];

// Helper: Calculate active schedule slot based on current time
function getActiveSlot() {
  const now = new Date();
  const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();

  const sortedSchedule = schedule.map(slot => {
    const [h, m] = slot.time.split(':').map(Number);
    return { ...slot, totalMinutes: h * 60 + (m || 0) };
  }).sort((a, b) => a.totalMinutes - b.totalMinutes);

  let activeSlot = null;
  for (let i = sortedSchedule.length - 1; i >= 0; i--) {
    if (currentTotalMinutes >= sortedSchedule[i].totalMinutes) {
      activeSlot = sortedSchedule[i];
      break;
    }
  }

  // Overnight fallback to Adult Swim West
  return activeSlot || sortedSchedule[sortedSchedule.length - 1];
}

// 1. Direct Live Video Stream Endpoint (Root URL)
app.get('/', (req, res) => {
  const activeSlot = getActiveSlot();

  res.contentType('video/mp4');

  let ffmpegArgs = [];

  if (activeSlot.type === "livestream") {
    // Pipe remote live .m3u8 stream through ffmpeg
    ffmpegArgs = [
      '-re',
      '-i', activeSlot.file,
      '-c', 'copy',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1'
    ];
  } else {
    // Pipe local .mp4 video file through ffmpeg
    if (!fs.existsSync(activeSlot.file)) {
      return res.status(404).send(`Video file not found: ${activeSlot.file}`);
    }

    ffmpegArgs = [
      '-re',
      '-i', activeSlot.file,
      '-c', 'copy',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov',
      'pipe:1'
    ];
  }

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  // Pipe ffmpeg output directly to the HTTP response stream
  ffmpeg.stdout.pipe(res);

  // Prevent memory leaks when client disconnects
  req.on('close', () => {
    ffmpeg.kill('SIGKILL');
  });
});

// 2. Schedule JSON API (For IPTV EPGs or debugging)
app.get('/api/schedule', (req, res) => {
  res.json(schedule);
});

// 3. Now Playing JSON API
app.get('/api/now-playing', (req, res) => {
  res.json(getActiveSlot());
});

// Bind explicitly to 0.0.0.0 for Render host detection
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Direct stream engine running on port ${PORT}`);
});
