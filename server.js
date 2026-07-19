const fs = require('fs');
const https = require('https');
const path = require('path');

const videoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"; 
const videoPath = path.join(__dirname, "video.mp4");

// Safe, streaming download block
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
            console.log("Download complete! video.mp4 is saved locally and ready to loop.");
        });
    }).on('error', (err) => {
        fs.unlink(videoPath, () => {}); // Clear partial file on error
        console.error(`Network download error: ${err.message}`);
    });
} else {
    console.log("video.mp4 verified locally! Starting media engine...");
}
