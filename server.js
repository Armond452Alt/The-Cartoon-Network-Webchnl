const express = require('express');
const fs = require('fs');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

// Working direct MP4 sample URL
const videoUrl = "https://raw.githubusercontent.com/bower/bower/master/test/fixtures/down.mp4";
const videoPath = path.join(__dirname, "video.mp4");

// 1. Bind port immediately so Render health check passes
app.get('/', (req, res) => {
    res.send('Cartoon Network Web Channel is running live!');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

// 2. Download test video if missing
if (!fs.existsSync(videoPath)) {
    console.log("video.mp4 is missing. Initiating automatic network download...");
    const file = fs.createWriteStream(videoPath);
    
    https.get(videoUrl, (response) => {
        if (response.statusCode !== 200) {
            console.error(`Download failed: Server responded with status ${response.statusCode}`);
            return;
        }
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            console.log("Download complete! video.mp4 saved successfully.");
        });
    }).on('error', (err) => {
        fs.unlink(videoPath, () => {});
        console.error(`Network download error: ${err.message}`);
    });
} else {
    console.log("video.mp4 verified locally! Starting media engine...");
}
