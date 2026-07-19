const fs = require('fs');
const http = require('https'); // or 'http' depending on your URL

// A public direct-download link to a video file to test with
const videoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"; 
const videoPath = "./video.mp4";

// Automatically downloads the video if it doesn't exist on the server
if (!fs.existsSync(videoPath)) {
    console.log("video.mp4 missing. Downloading a video file automatically...");
    const file = fs.createWriteStream(videoPath);
    http.get(videoUrl, function(response) {
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            console.log("Download complete! video.mp4 is ready to loop.");
        });
    });
} else {
    console.log("video.mp4 found! Starting loop engine...");
}
