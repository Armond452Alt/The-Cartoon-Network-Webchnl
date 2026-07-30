const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Program Schedule with Multi-Part Array Playlists
const schedule = [
  {
    time: "13:00", // 1:00 PM Slot
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
    show: "The Amazing World of Gumball",
    title: "The Kids / The Fan",
    playlist: [
      "/Shows/part-0.mp4",
      "/Shows/part-1.mp4",
      "/Shows/part-2.mp4"
    ]
  }
];

// Return full schedule
app.get('/api/schedule', (req, res) => {
  res.json(schedule);
});

// Get currently active slot based on server hour
app.get('/api/now-playing', (req, res) => {
  const currentHour = new Date().getHours();
  
  let activeSlot = schedule.find(slot => {
    const slotHour = parseInt(slot.time.split(':')[0], 10);
    return slotHour === currentHour;
  });

  if (!activeSlot) {
    activeSlot = schedule[0];
  }

  res.json(activeSlot);
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
