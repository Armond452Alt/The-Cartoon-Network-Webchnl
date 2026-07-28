const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Executes an FFmpeg streaming/conversion process with error capturing and memory constraints.
 * 
 * @param {string} inputSource - Direct stream URL, M3U8, or local file path.
 * @param {string} outputDirName - Name of the folder to store output files (e.g., 'hls_out').
 */
function runFFmpegProcess(inputSource, outputDirName = 'hls_output') {
  // 1. Ensure output directory exists before FFmpeg starts
  const outputDir = path.join(__dirname, outputDirName);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const playlistPath = path.join(outputDir, 'index.m3u8');

  // 2. Build FFmpeg arguments
  // Optimized for Render 512MB RAM limits: 1 thread, ultrafast preset, low memory buffering
  const ffmpegArgs = [
    '-y',                         // Overwrite output files without asking
    '-re',                        // Read input at native frame rate (useful for live streams)
    '-i', inputSource,            // Input stream or file
    
    // Video codec & Memory optimizations
    '-c:v', 'libx264',
    '-preset', 'ultrafast',       // Minimizes CPU and RAM usage
    '-tune', 'zerolatency',
    '-threads', '1',              // Keeps Render from OOM-killing (SIGKILL) the process
    '-crf', '26',                 // Reasonable balance between quality and encoding load
    
    // Audio codec
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '128k',
    
    // HLS Output settings
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '5',
    '-hls_flags', 'delete_segments',
    playlistPath
  ];

  console.log(`[Node] Spawning FFmpeg...`);
  console.log(`[Node] Target Output: ${playlistPath}`);

  // 3. Spawn child process
  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  // 4. Stream real-time output (FFmpeg sends logs to stderr, not stdout)
  ffmpeg.stderr.on('data', (chunk) => {
    const logLine = chunk.toString().trim();
    // Filter out redundant frame logs to keep stdout clean, or log everything for debugging
    if (logLine.length > 0) {
      console.log(`[FFmpeg LOG]: ${logLine}`);
    }
  });

  // 5. Catch spawn failure (e.g., 'ffmpeg' binary not found or path error)
  ffmpeg.on('error', (err) => {
    console.error(`[FFmpeg ERROR] Failed to start process:`, err.message);
  });

  // 6. Handle process termination
  ffmpeg.on('close', (code, signal) => {
    if (signal) {
      console.error(`[FFmpeg EXIT] Process was killed by signal: ${signal}`);
      if (signal === 'SIGKILL') {
        console.error(`[FFmpeg DIAGNOSTIC] SIGKILL usually indicates Render out-of-memory (OOM) killer.`);
      }
    } else {
      console.log(`[FFmpeg EXIT] Process exited with code: ${code}`);
    }
  });

  // 7. Cleanup handling on Node server shutdown
  process.on('SIGINT', () => {
    console.log('[Node] Shutting down... Terminating FFmpeg.');
    ffmpeg.kill('SIGTERM');
    process.exit();
  });

  return ffmpeg;
}

// --- Example Execution ---
// Replace with your input URL (RTSP, M3U8, HTTP stream) or local file path
const INPUT_STREAM_URL = 'http://example.com/live/stream.m3u8'; 

const streamProcess = runFFmpegProcess(INPUT_STREAM_URL, 'public/hls');
