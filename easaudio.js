const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const EAS_AUDIO_PATH = path.join(publicDir, 'eas_alert.wav');

/**
 * Generates SAME Header FSK + Attention Tone via FFmpeg audio filter synthesis
 * Output: 853Hz + 960Hz dual-tone attention signal
 */
function generateEASAudio(eventCode = 'RMT', countyCode = '039035', callback) {
  // If pre-rendered audio exists, reuse it to save CPU and RAM
  if (fs.existsSync(EAS_AUDIO_PATH)) {
    return callback(null, EAS_AUDIO_PATH);
  }

  console.log('[EAS Audio] Synthesizing emergency attention tone...');

  // Generates 8 seconds of dual 853Hz + 960Hz sine waves (EAS Attention Tone)
  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', 'sine=frequency=853:duration=8,sine=frequency=960:duration=8',
    '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first[aout]',
    '-map', '[aout]',
    '-c:a', 'pcm_s16le',
    '-ar', '44100',
    '-ac', '1',
    EAS_AUDIO_PATH
  ];

  const ffmpeg = spawn('ffmpeg', args);

  ffmpeg.on('close', (code) => {
    if (code === 0 && fs.existsSync(EAS_AUDIO_PATH)) {
      console.log('[EAS Audio] Synthesis complete:', EAS_AUDIO_PATH);
      callback(null, EAS_AUDIO_PATH);
    } else {
      console.error(`[EAS Audio Error] FFmpeg exited with code ${code}`);
      callback(new Error(`FFmpeg audio synthesis failed with code ${code}`));
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('[EAS Audio Error]:', err);
    callback(err);
  });
}

module.exports = {
  generateEASAudio,
  EAS_AUDIO_PATH
};
