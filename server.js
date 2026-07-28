const express = require('express');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static'); // <--- Required!
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const hlsDir = path.join(__dirname, 'public', 'hls');

if (!fs.existsSync(hlsDir)) {
    fs.mkdirSync(hlsDir, { recursive: true });
}

app.use('/hls', express.static(hlsDir));

app.get('/', (req, res) => {
    res.send('Cartoon Network Web Channel HLS Server is running!');
});

function startHLSStream() {
    console.log("Starting FFmpeg HLS stream generation...");

    // Spawn ffmpegPath instead of 'ffmpeg'
    const ffmpeg = spawn(ffmpegPath, [
        '-re',
        '-i', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments',
        path.join(hlsDir, 'index.m3u8')
    ]);

    ffmpeg.stderr.on('data', (data) => {
        console.log(`[FFmpeg] ${data}`);
    });

    ffmpeg.on('close', (code) => {
        console.log(`FFmpeg stream exited with code ${code}. Restarting...`);
        setTimeout(startHLSStream, 2000);
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startHLSStream();
});
