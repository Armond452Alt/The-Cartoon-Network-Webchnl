const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

const hlsDir = path.join(__dirname, 'public', 'hls');

// Ensure HLS output directory exists
if (!fs.existsSync(hlsDir)) {
    fs.mkdirSync(hlsDir, { recursive: true });
}

// Serve the HLS directory publicly
app.use('/hls', express.static(hlsDir));

app.get('/', (req, res) => {
    res.send('Cartoon Network Web Channel HLS Server is running!');
});

// Function to start generating the HLS stream from your media/playlist
function startHLSStream() {
    console.log("Starting FFmpeg HLS stream generation...");

    const ffmpeg = spawn('ffmpeg', [
        '-re',
        '-i', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', // or -f concat -i playlist.txt
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-f', 'hls',
        '-hls_time', '4',                  // 4-second segment duration
        '-hls_list_size', '5',              // Keep last 5 segments in index.m3u8
        '-hls_flags', 'delete_segments',   // Clean up old segments automatically
        path.join(hlsDir, 'index.m3u8')
    ]);

    ffmpeg.stderr.on('data', (data) => {
        // Uncomment for FFmpeg debugging logs:
        // console.log(`[FFmpeg] ${data}`);
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
