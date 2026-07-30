const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, 'public')));

// Adult Swim West Live Stream Endpoint
const ADULT_SWIM_M3U8 = "https://turnerlive.warnermediacdn.com/hls/live/2023185/aswest/noslate/VIDEO_1_5128000.m3u8";

// Program Schedule
const schedule = [
  {
    time: "06:00", // 6:00 AM Sign-On
    type: "bumper",
    show: "Cartoon Network Sign-On",
    title: "Good Morning",
    file: "/Shows/cn_sign_on.mp4"
  },
  {
    time: "13:00", // 1:00 PM Slot
    type: "show",
    show: "The Wonderfully Weird World of Gumball",
    title: "The Burger",
    file: "/Shows/twwwog_s01e01.mp4"
  },
  {
    time: "14:00", // 2:00 PM Slot
    type: "show",
    show: "The Amazing World of Gumball",
    title: "The Kids / The Fan",
    file: "/Shows/tawog_s03e01.mp4"
  },
  {
    time: "20:00", // 8:00 PM CN Sign-Off
    type: "bumper",
    show: "Cartoon Network Sign-Off",
    title: "Good Night",
    file: "/Shows/cn_sign_off.mp4"
  },
  {
    time: "20:01", // 8:01 PM Adult Swim Sign-On
    type: "bumper",
    show: "Adult Swim Sign-On",
    title: "All Kids Out of the Pool",
    file: "/Shows/as_sign_on.mp4"
  },
  {
    time: "20:02", // Live Adult Swim West Stream (Routed via ffmpeg stream route)
    type: "livestream",
    show: "Adult Swim West",
    title: "Live Stream (HD)",
    file: "/stream/aswest"
  }
];

// Direct FFmpeg Live Stream Endpoint
app.get('/stream/aswest', (req, res) => {
  res.contentType('video/mp4');

  // Spawn ffmpeg to read the live M3U8 feed and remux it directly into fragmented MP4
  const ffmpeg = spawn('ffmpeg', [
    '-re',
    '-i', ADULT_SWIM_M3U8,
    '-c', 'copy',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov',
    'pipe:1'
  ]);

  ffmpeg.stdout.pipe(res);

  ffmpeg.stderr.on('data', (data) => {
    // Log ffmpeg output silently or for debugging
  });

  req.on('close', () => {
    ffmpeg.kill('SIGKILL');
  });
});

app.get('/api/schedule', (req, res) => {
  res.json(schedule);
});

// Accurate time-matching API (handles late night / overnight correctly)
app.get('/api/now-playing', (req, res) => {
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
  if (!activeSlot) {
    activeSlot = sortedSchedule[sortedSchedule.length - 1];
  }

  res.json(activeSlot);
});

// Catch-all route to serve public/index.html
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('public/index.html not found.');
  }
});

// Bind explicitly to 0.0.0.0 for Render port detection
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
