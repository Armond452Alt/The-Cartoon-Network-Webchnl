const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
// Render automatically provides PORT, defaulting to 10000
const PORT = process.env.PORT || 10000;

// Serve static assets from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Program Schedule Configuration
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
    playlist: [
      "/Shows/twwwog_s01e01_pt1.mp4",
      "/Shows/twwwog_s01e01_pt2.mp4",
      "/Shows/twwwog_s01e01_pt3.mp4"
    ]
  },
  {
    time: "14:00", // 2:00 PM Slot
    type: "show",
    show: "The Amazing World of Gumball",
    title: "The Kids / The Fan",
    playlist: [
      "/Shows/part-0.mp4",
      "/Shows/part-1.mp4",
      "/Shows/part-2.mp4"
    ]
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
    time: "20:02", // 8:02 PM Live Adult Swim West Stream (1080p HD)
    type: "livestream",
    show: "Adult Swim West",
    title: "Live Stream (HD)",
    file: "https://turnerlive.warnermediacdn.com/hls/live/2023185/aswest/noslate/VIDEO_1_5128000.m3u8"
  }
];

// Return full schedule API
app.get('/api/schedule', (req, res) => {
  res.json(schedule);
});

// Get currently active slot based on server time
app.get('/api/now-playing', (req, res) => {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  let activeSlot = schedule.find(slot => {
    const [slotHour, slotMin] = slot.time.split(':').map(Number);
    return slotHour === currentHour && (slotMin === undefined || currentMinute >= slotMin);
  });

  if (!activeSlot) {
    activeSlot = schedule[0];
  }

  res.json(activeSlot);
});

// Fallback route with safety check for public/index.html
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('public/index.html not found. Ensure index.html exists inside the public folder.');
  }
});

// Explicitly bind to '0.0.0.0' so Render port scanner can reach the service
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
