const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;
const STREAM_DIR = path.join(__dirname, 'public', 'stream');

// Enable CORS so your website frontend player can load the stream securely
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directory exists
if (!fs.existsSync(STREAM_DIR)) {
    fs.mkdirSync(STREAM_DIR, { recursive: true });
}

// FFmpeg logic to continuously loop a video file into an HLS live manifest
const startStreaming = () => {
    console.log("Starting linear channel FFmpeg encoder...");
    
    // Replace 'video.mp4' with the path to your source file or stream source link
    const ffmpegCmd = `ffmpeg -re -stream_loop -1 -i video.mp4 -c:v libx264 -preset superfast -c:a aac -f hls -hls_time 4 -hls_list_size 5 -hls_flags delete_segments ${STREAM_DIR}/channel.m3u8`;

    const ffmpegProcess = exec(ffmpegCmd, (error) => {
        if (error) {
            console.error(`FFmpeg process error: ${error.message}`);
            setTimeout(startStreaming, 5000); // Attempt auto-restart on fail
        }
    });

    ffmpegProcess.stderr.on('data', (data) => {
        // Keeps track of streaming logs in the Render console
        console.log(data.toString());
    });
};

app.listen(PORT, () => {
    console.log(`Streaming backend listening on port ${PORT}`);
    startStreaming();
});
