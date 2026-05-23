// iOS Keyboard Morph - Application Logic

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Element References ---
  const textInput = document.getElementById('text-input');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const startBtn = document.getElementById('start-btn');
  const exportImgBtn = document.getElementById('export-img-btn');
  const resetBtn = document.getElementById('reset-btn');
  const layoutModeBtns = document.querySelectorAll('#layout-mode-group .toggle-btn');
  const themeModeBtns = document.querySelectorAll('#theme-mode-group .toggle-btn');
  const demoSpeedInput = document.getElementById('demo-speed');
  const demoSpeedVal = document.getElementById('demo-speed-val');
  const soundToggle = document.getElementById('sound-toggle');
  const recordToggle = document.getElementById('record-toggle');
  
  const typedTextSpan = document.getElementById('typed-text');
  const currentDateDiv = document.getElementById('current-date');
  
  const keyboard = document.getElementById('ios-keyboard');
  const row1 = document.getElementById('row-1');
  const row2 = document.getElementById('row-2');
  const row3 = document.getElementById('row-3');
  const row3Letters = document.getElementById('row-3-letters');
  const row4 = document.getElementById('row-4');
  
  const keyShift = document.getElementById('key-shift');
  const keyBackspace = document.getElementById('key-backspace');
  const keySpace = document.getElementById('key-space');
  const keyReturn = document.getElementById('key-return');
  
  // --- State Variables ---
  let soundEnabled = soundToggle.checked;
  let layoutMode = 'row-shrink'; // 'row-shrink', 'single-row', or 'square-pack'
  let themeMode = 'light';
  const getDelayFromCps = (val) => {
    if (val === 31) return 0;
    return Math.round(1000 / val);
  };
  let fadeSpeed = getDelayFromCps(parseInt(demoSpeedInput.value));
  let typeSpeed = getDelayFromCps(parseInt(demoSpeedInput.value));
  let isAnimating = false;
  let animationTimeoutIds = [];
  
  // Video Recording States
  let isRecording = false;
  let recordedFrames = [];
  
  // Web Audio Context for iOS sound synthesis
  let audioCtx = null;

  // --- Store Original Keyboard DOM Structure ---
  const letterKeys = Array.from(document.querySelectorAll('.letter-key'));
  const row1Original = Array.from(row1.children);
  const row2Original = Array.from(row2.children);
  const row3Original = Array.from(row3.children);
  const row3LettersOriginal = Array.from(row3Letters.children);
  const row4Original = Array.from(row4.children);

  // Pre-calculated static QWERTY ordered keys to support direct container queries in Square Pack mode
  const allKeysQWERTY = [
    ...Array.from(row1.querySelectorAll('.letter-key')),
    ...Array.from(row2.querySelectorAll('.letter-key')),
    keyShift,
    ...Array.from(row3Letters.querySelectorAll('.letter-key')),
    keyBackspace,
    document.getElementById('key-123'),
    document.getElementById('key-globe'),
    keySpace,
    keyReturn
  ].filter(Boolean);

  // --- Initialize Audio Context on first interaction ---
  const initAudio = () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  };

  // --- Dynamic CSS Transition Speed Scaler ---
  const updateTransitionSpeeds = (ms) => {
    const keySec = ms === 0 ? '0s' : `${ms * 0.85}ms`;
    const layoutSec = ms === 0 ? '0s' : `${ms}ms`;
    document.documentElement.style.setProperty('--transition-speed-key', keySec);
    document.documentElement.style.setProperty('--transition-speed-layout', layoutSec);
  };

  // --- View Transitions API helper ---
  const runTransition = (callback) => {
    if (document.startViewTransition && fadeSpeed > 0) {
      keyboard.classList.add('no-transitions');
      const transition = document.startViewTransition(() => {
        callback();
      });
      transition.finished.finally(() => {
        keyboard.classList.remove('no-transitions');
      });
    } else {
      callback();
    }
  };

  // --- Dynamic Keyboard Sound Synthesis ---
  const playKeySound = (type = 'standard', destinationNode = null) => {
    if (!soundEnabled) return;
    try {
      initAudio();
      
      const now = audioCtx.currentTime;
      
      // We will combine a quick filtered noise burst with a sine/triangle wave for realism
      // iOS click has a woodblock-like tap sound: rapid decay, high pitch
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      let frequency = 1600;
      let decay = 0.015;
      let vol = 0.12;
      
      if (type === 'space') {
        frequency = 750;
        decay = 0.03;
        vol = 0.18;
      } else if (type === 'backspace') {
        frequency = 1200;
        decay = 0.02;
        vol = 0.15;
      } else if (type === 'return') {
        frequency = 900;
        decay = 0.025;
        vol = 0.16;
      }
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, now);
      // Fast pitch drop to mimic impact transient
      osc.frequency.exponentialRampToValueAtTime(120, now + decay);
      
      gainNode.gain.setValueAtTime(vol, now);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      
      const dest = destinationNode || audioCtx.destination;
      
      osc.connect(gainNode);
      gainNode.connect(dest);
      
      // If we are recording to a custom destination, also connect to the main hardware destination
      // with 0 gain to ensure the AudioContext rendering loop stays active and actually outputs data.
      if (destinationNode) {
        const silentGain = audioCtx.createGain();
        silentGain.gain.setValueAtTime(0, now);
        gainNode.connect(silentGain);
        silentGain.connect(audioCtx.destination);
      }
      
      osc.start(now);
      osc.stop(now + decay + 0.05);

      // Add a tiny bit of high frequency noise burst for key impact crack
      const bufferSize = audioCtx.sampleRate * 0.005; // 5ms of noise
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      
      const noiseFilter = audioCtx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = type === 'space' ? 2000 : 4000;
      noiseFilter.Q.value = 2;
      
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(type === 'space' ? 0.02 : 0.04, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.005);
      
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(dest);
      
      if (destinationNode) {
        const silentNoiseGain = audioCtx.createGain();
        silentNoiseGain.gain.setValueAtTime(0, now);
        noiseGain.connect(silentNoiseGain);
        silentNoiseGain.connect(audioCtx.destination);
      }
      
      noise.start(now);
      noise.stop(now + 0.01);
      
    } catch (e) {
      console.warn('Audio Context error (usual if browser blocks autoplay):', e);
    }
  };

  // --- Generate Key Popup Previews ---
  const generateKeyPopups = () => {
    letterKeys.forEach(key => {
      // Create a popup bubble if it doesn't exist
      if (!key.querySelector('.key-popup')) {
        const popup = document.createElement('div');
        popup.className = 'key-popup';
        popup.textContent = key.getAttribute('data-char');
        key.appendChild(popup);
      }
    });
  };

  // --- Update casing on the keyboard labels ---
  const setKeyboardCasing = (isUppercase) => {
    if (isUppercase) {
      keyboard.classList.add('uppercase-state');
      keyShift.classList.add('active-shift');
    } else {
      keyboard.classList.remove('uppercase-state');
      keyShift.classList.remove('active-shift');
    }
  };

  // --- Reset Keyboard layout and styles ---
  const resetKeyboard = () => {
    // Clear any pending animation timers
    animationTimeoutIds.forEach(id => clearTimeout(id));
    animationTimeoutIds = [];
    isAnimating = false;
    
    // Reset recording state
    isRecording = false;
    recordedFrames = [];
    const timeDisplay = document.querySelector('.status-bar .time');
    if (timeDisplay) timeDisplay.classList.remove('recording');
    const videoOverlay = document.getElementById('video-overlay');
    if (videoOverlay) videoOverlay.style.display = 'none';
    
    // Enable inputs and buttons
    startBtn.disabled = false;
    textInput.disabled = false;
    exportImgBtn.disabled = false;
    presetBtns.forEach(btn => btn.disabled = false);
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('disabled'));
    
    // Reset keys visual states
    letterKeys.forEach(key => {
      key.classList.remove('key-hidden', 'key-gone', 'pressed');
      const popup = key.querySelector('.key-popup');
      if (popup) popup.textContent = key.getAttribute('data-char');
    });
    
    // Reset control keys
    keyShift.classList.remove('active-shift', 'pressed');
    keyBackspace.classList.remove('pressed');
    keySpace.classList.remove('pressed');
    keyReturn.classList.remove('pressed');
    keyboard.classList.remove('uppercase-state', 'single-row-merged', 'square-pack-merged');
    
    // Reset keyboard width
    keyboard.style.width = '';
    
    // Restore original positions in rows by moving children back in sequence
    row1Original.forEach(child => row1.appendChild(child));
    row2Original.forEach(child => row2.appendChild(child));
    row3LettersOriginal.forEach(child => row3Letters.appendChild(child));
    row3Original.forEach(child => row3.appendChild(child));
    if (row4) {
      row4Original.forEach(child => row4.appendChild(child));
      row4.style.display = '';
    }
    
    // Show hidden row wrappers
    row1.style.display = '';
    row2.style.display = '';
    row3.style.display = '';
    row3Letters.style.display = '';
    
    // Clear screen text
    typedTextSpan.textContent = '';
  };

  // --- Extract lowercase unique letters from a string ---
  const getUniqueLetters = (text) => {
    const letters = new Set();
    const cleanText = text.toLowerCase();
    for (let char of cleanText) {
      if (char >= 'a' && char <= 'z') {
        letters.add(char);
      }
    }
    return letters;
  };

  // --- Sleep Helper (Promise based) ---
  const sleep = (ms) => new Promise(resolve => {
    const id = setTimeout(resolve, ms);
    animationTimeoutIds.push(id);
  });

  // --- Video Capturing Frame ---
  const captureFrame = async (soundType = null) => {
    if (!isRecording) return;
    try {
      const bezel = document.querySelector('.iphone-bezel');
      const canvas = await html2canvas(bezel, {
        scale: 1.5, // Crisp resolution
        logging: false,
        useCORS: true,
        backgroundColor: null
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.8); // 80% quality JPEG is faster & smaller
      recordedFrames.push({ img: imgData, sound: soundType });
    } catch (err) {
      console.error('Frame capture failed:', err);
    }
  };

  // --- Video Export and Compilation ---
  const stopRecordingAndExport = async () => {
    isRecording = false;
    const timeDisplay = document.querySelector('.status-bar .time');
    if (timeDisplay) timeDisplay.classList.remove('recording');
    
    if (recordedFrames.length === 0) {
      alert('录制帧为空！');
      return;
    }
    
    // Show progress overlay
    const videoOverlay = document.getElementById('video-overlay');
    const videoProgressBar = document.getElementById('video-progress-bar');
    const videoProgressVal = document.getElementById('video-progress-val');
    
    if (videoOverlay) videoOverlay.style.display = 'flex';
    if (videoProgressBar) videoProgressBar.style.width = '0%';
    if (videoProgressVal) videoProgressVal.textContent = '0';
    
    try {
      const width = 290 * 1.5;
      const height = 600 * 1.5;
      const recordCanvas = document.createElement('canvas');
      recordCanvas.width = width;
      recordCanvas.height = height;
      const ctx = recordCanvas.getContext('2d');
      
      // Check for browser support of various video MIME types
      const mimeTypes = [
        'video/mp4;codecs=avc1,mp4a.40.2', // Standard H.264 + AAC (Highly compatible with QuickTime/Safari/iOS)
        'video/mp4;codecs=avc1,opus',      // Chrome H.264 + Opus (Compatible with Chrome/VLC, but not QuickTime)
        'video/mp4;codecs=h264,mp4a.40.2',
        'video/mp4;codecs=h264,opus',
        'video/mp4',
        'video/webm;codecs=vp9,opus',      // WebM VP9 + Opus (High quality WebM)
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ];
      
      let selectedType = '';
      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedType = type;
          break;
        }
      }
      
      if (!selectedType) {
        alert('当前浏览器不支持 MediaRecorder 录制视频！');
        if (videoOverlay) videoOverlay.style.display = 'none';
        return;
      }
      
      const extension = selectedType.includes('mp4') ? 'mp4' : 'webm';
      
      // Capture at a steady rate, say 10 fps
      const fps = 10;
      const canvasStream = recordCanvas.captureStream(fps);
      
      // Set up combined audio-video stream if sound is enabled
      let recordStream = canvasStream;
      let audioDest = null;
      if (soundEnabled) {
        initAudio();
        audioDest = audioCtx.createMediaStreamDestination();
        const combinedStream = new MediaStream();
        canvasStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));
        audioDest.stream.getAudioTracks().forEach(track => combinedStream.addTrack(track));
        recordStream = combinedStream;
      }
      
      const recorder = new MediaRecorder(recordStream, {
        mimeType: selectedType,
        videoBitsPerSecond: 2500000 // 2.5 Mbps
      });
      
      const chunks = [];
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      const recorderPromise = new Promise((resolve, reject) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: selectedType });
          resolve(blob);
        };
        recorder.onerror = err => reject(err);
      });
      
      recorder.start();
      
      const totalFrames = recordedFrames.length;
      
      // Load all frames and draw them one by one
      for (let i = 0; i < totalFrames; i++) {
        const frame = recordedFrames[i];
        const dataUrl = frame.img;
        const img = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = err => reject(err);
          image.src = dataUrl;
        });
        
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        // Play sound if associated with this frame and sound is enabled
        if (frame.sound && soundEnabled && audioDest) {
          playKeySound(frame.sound, audioDest);
        }
        
        // Update progress bar
        const progress = Math.round(((i + 1) / totalFrames) * 100);
        if (videoProgressBar) videoProgressBar.style.width = `${progress}%`;
        if (videoProgressVal) videoProgressVal.textContent = progress;
        
        // Wait 100ms per frame to match 10fps
        await new Promise(r => setTimeout(r, 1000 / fps));
      }
      
      // Add a small extra delay at the end so the video doesn't cut off instantly
      await new Promise(r => setTimeout(r, 200));
      
      recorder.stop();
      
      const blob = await recorderPromise;
      window.lastGeneratedBlob = blob;
      const url = URL.createObjectURL(blob);
      
      if (videoOverlay) videoOverlay.style.display = 'none';
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `ios-keyboard-morph-${Date.now()}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      
    } catch (err) {
      console.error('Video compilation failed:', err);
      if (videoOverlay) videoOverlay.style.display = 'none';
      alert('视频合成失败，请重试！');
    }
  };

  // --- Start Morph & Type Animation ---
  const startAnimation = async () => {
    if (isAnimating) return;
    isAnimating = true;
    
    // Reset keyboard layout and states first
    resetKeyboard();
    isAnimating = true;
    
    // Disable inputs and buttons during demo
    startBtn.disabled = true;
    textInput.disabled = true;
    exportImgBtn.disabled = true;
    presetBtns.forEach(btn => btn.disabled = true);
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.add('disabled'));
    
    // Wait a brief moment to show full keyboard before starting morph (respecting speed setting)
    const initialDelay = fadeSpeed === 0 ? 0 : 300;
    if (initialDelay > 0) {
      await sleep(initialDelay);
    }
    
    initAudio();
    
    // Enable recording if checkbox is checked
    const recordToggle = document.getElementById('record-toggle');
    isRecording = recordToggle ? recordToggle.checked : false;
    recordedFrames = [];
    
    if (isRecording) {
      const timeDisplay = document.querySelector('.status-bar .time');
      if (timeDisplay) timeDisplay.classList.add('recording');
    }
    
    // Clear typing screen
    typedTextSpan.textContent = '';
    
    // Step 1: Analyze Sentence
    const sentence = textInput.value;
    if (!sentence.trim()) {
      alert("请输入一句英文来进行演示！");
      resetKeyboard();
      return;
    }
    
    const usedLetters = getUniqueLetters(sentence);
    const unusedLetters = letterKeys.filter(key => !usedLetters.has(key.getAttribute('data-char')));
    
    // Step 2: Shuffle unused letters so they disappear randomly for natural feel
    const shuffledUnused = [...unusedLetters].sort(() => Math.random() - 0.5);
    
    // Initial capture (Standard QWERTY layout)
    if (isRecording) {
      await captureFrame();
    }
    
    // Step 3: Gradually fade out and shrink unused letters
    if (layoutMode === 'square-pack') {
      runTransition(() => {
        morphToSquarePackInitial();
      });
      if (isRecording) {
        await captureFrame();
      }
    }
    
    // Pre-calculate target final width for square pack layout mode
    let startWidth = 260;
    let finalOptimalWidth = 260;
    if (layoutMode === 'square-pack') {
      const finalActiveKeys = allKeysQWERTY.filter(key => {
        if (key.classList.contains('letter-key')) {
          return usedLetters.has(key.getAttribute('data-char'));
        }
        return true; // Keep control keys
      });
      finalOptimalWidth = calculateOptimalSquareWidth(finalActiveKeys);
    }
    
    const totalSteps = shuffledUnused.length;
    for (let index = 0; index < totalSteps; index++) {
      const key = shuffledUnused[index];
      
      runTransition(() => {
        key.classList.add('key-hidden');
        
        // Gradually adjust width in square pack mode as keys disappear
        if (layoutMode === 'square-pack') {
          const progress = (index + 1) / totalSteps;
          const currentWidth = startWidth - (startWidth - finalOptimalWidth) * progress;
          keyboard.style.width = currentWidth + 'px';
        }
      });
      
      playKeySound('backspace');
      
      // Add key-gone to the hidden key after transition time
      const goneDelay = fadeSpeed === 0 ? 0 : Math.round(fadeSpeed * 0.85);
      const timeoutId = setTimeout(() => {
        runTransition(() => {
          key.classList.add('key-gone');
        });
      }, goneDelay);
      animationTimeoutIds.push(timeoutId);
      
      if (isRecording) {
        await captureFrame('backspace');
      }
      
      await sleep(fadeSpeed);
    }
    
    // Step 4: After keys finish disappearing, apply layout morphing / settle transitions
    await sleep(fadeSpeed === 0 ? 0 : Math.round(fadeSpeed * 0.85)); // Wait for key transitions to finish
    
    if (layoutMode === 'single-row') {
      runTransition(() => {
        morphToSingleRow(usedLetters);
      });
      if (isRecording) {
        await captureFrame();
      }
      await sleep(fadeSpeed); // Wait for single row transition to finish
      if (isRecording) {
        await captureFrame();
      }
    } else if (layoutMode === 'square-pack') {
      // In square pack, we already morphed gradually, but we wait for width transition to settle
      await sleep(fadeSpeed);
      if (isRecording) {
        await captureFrame();
      }
    } else {
      // row-shrink: just set container width to fit content
      runTransition(() => {
        keyboard.style.width = 'fit-content';
      });
      if (isRecording) {
        await captureFrame();
      }
      await sleep(fadeSpeed);
      if (isRecording) {
        await captureFrame();
      }
    }
    
    // Step 5: Start Typing
    await playTypingDemo(sentence);
  };

  // --- Helpers for Square Pack Layout ---
  const getActiveKeysInOrder = () => {
    return allKeysQWERTY.filter(key => key && !key.classList.contains('key-hidden'));
  };

  const simulateLayout = (keyWidths, containerWidth, gap = 4) => {
    let rows = 0;
    let currentRowWidth = 0;
    let maxRowWidth = 0;
    
    for (let w of keyWidths) {
      if (currentRowWidth === 0) {
        currentRowWidth = w;
        rows++;
      } else if (currentRowWidth + gap + w <= containerWidth) {
        currentRowWidth += gap + w;
      } else {
        currentRowWidth = w;
        rows++;
      }
      maxRowWidth = Math.max(maxRowWidth, currentRowWidth);
    }
    
    const height = rows * 34 + (rows - 1) * gap;
    return { rows, width: maxRowWidth, height };
  };

  const calculateOptimalSquareWidth = (activeKeys) => {
    const keyWidths = activeKeys.map(k => {
      if (k === keySpace) return 106;
      if (k === keyReturn) return 58;
      if (k === document.getElementById('key-123')) return 52;
      if (k === keyShift || k === keyBackspace || k === document.getElementById('key-globe')) return 30;
      return 22; // letters
    });
    
    let bestWidth = 260; // Max allowed width inside simulated screen
    let bestDiff = Infinity;
    
    // Candidate container widths from 106px (Space key width) + 24px padding = 130px to 260px
    for (let w = 130; w <= 260; w += 2) {
      // Available width for keys is w - 24px (left/right padding is 12px each)
      const availableWidth = w - 24;
      const layout = simulateLayout(keyWidths, availableWidth, 4);
      const ratio = layout.width / layout.height;
      const diff = Math.abs(ratio - 1.0);
      
      if (diff < bestDiff) {
        bestDiff = diff;
        bestWidth = w;
      }
    }
    
    return bestWidth;
  };

  // --- Morph Keyboard into Square Pack Layout (Initial State) ---
  const morphToSquarePackInitial = () => {
    keyboard.classList.add('square-pack-merged');
    
    // Move all keys directly to keyboard container (active and inactive, in order)
    allKeysQWERTY.forEach(key => {
      if (key) {
        keyboard.appendChild(key);
      }
    });
    
    // Hide all row wrappers
    row1.style.display = 'none';
    row2.style.display = 'none';
    row3.style.display = 'none';
    const row4Div = document.getElementById('row-4');
    if (row4Div) row4Div.style.display = 'none';
    
    // Set initial width to 260px (full standard width)
    keyboard.style.width = '260px';
  };

  // --- Morph Keyboard into Single Row Merge Layout ---
  const morphToSingleRow = (usedLetters) => {
    keyboard.classList.add('single-row-merged');
    
    // Query visible letter keys (which are the used letters)
    const visibleLetters = letterKeys.filter(key => !key.classList.contains('key-hidden'));
    
    // Move Shift to Row 2
    row2.insertBefore(keyShift, row2.firstChild);
    
    // Move all visible letters to Row 2
    visibleLetters.forEach(key => {
      row2.appendChild(key);
    });
    
    // Move Backspace to Row 2
    row2.appendChild(keyBackspace);
    
    // Hide row 1 and row 3
    row1.style.display = 'none';
    row3.style.display = 'none';
    
    // Apply fit-content to shrink width
    keyboard.style.width = 'fit-content';
  };

  // --- Auto Typing Demo Queue ---
  const playTypingDemo = async (sentence) => {
    for (let index = 0; index < sentence.length; index++) {
      const char = sentence[index];
      const lowerChar = char.toLowerCase();
      
      let matchedKey = null;
      let isLetter = lowerChar >= 'a' && lowerChar <= 'z';
      
      if (isLetter) {
        matchedKey = letterKeys.find(key => key.getAttribute('data-char') === lowerChar);
      } else if (char === ' ') {
        matchedKey = keySpace;
      } else if (char === '\n') {
        matchedKey = keyReturn;
      }
      
      // Casing Management
      const isUpper = char >= 'A' && char <= 'Z';
      setKeyboardCasing(isUpper);
      
      // Update popups to display the correct casing
      if (isLetter && matchedKey) {
        const popup = matchedKey.querySelector('.key-popup');
        if (popup) popup.textContent = char;
      }
      
      // Execute Key Press visual effect and sound
      if (matchedKey) {
        matchedKey.classList.add('pressed');
        
        let clickType = 'standard';
        if (matchedKey === keySpace) clickType = 'space';
        else if (matchedKey === keyBackspace) clickType = 'backspace';
        else if (matchedKey === keyReturn) clickType = 'return';
        
        playKeySound(clickType);
        
        // Wait a short duration (half of visual click press duration)
        const pressDelay = typeSpeed === 0 ? 0 : Math.min(60, Math.round(typeSpeed * 0.25));
        if (pressDelay > 0) {
          await sleep(pressDelay);
        }
        
        // Capture frame showing keypressed popup preview!
        if (isRecording) {
          await captureFrame(clickType);
        }
        
        if (pressDelay > 0) {
          await sleep(pressDelay);
        }
        matchedKey.classList.remove('pressed');
      } else {
        playKeySound('standard');
        if (isRecording) {
          await captureFrame('standard');
        }
      }
      
      // Type into screen
      typedTextSpan.textContent += char;
      
      // Scroll Notes body down if overflowed
      const notesBody = document.querySelector('.notes-body');
      if (notesBody) {
        notesBody.scrollTop = notesBody.scrollHeight;
      }
      
      // Queue next character
      await sleep(typeSpeed);
    }
    
    // Typing completed!
    if (isRecording) {
      // Capture a final frame showing the finished text
      await captureFrame();
      await stopRecordingAndExport();
    }
    
    isAnimating = false;
    startBtn.disabled = false;
    textInput.disabled = false;
    exportImgBtn.disabled = false;
    presetBtns.forEach(btn => btn.disabled = false);
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('disabled'));
  };

  // --- Manual Keyboard Tapping Event Listeners ---
  const setupManualTyping = () => {
    // Letter keys
    letterKeys.forEach(key => {
      key.addEventListener('mousedown', (e) => {
        if (isAnimating) return;
        initAudio();
        
        const isUpper = keyboard.classList.contains('uppercase-state');
        const char = key.getAttribute('data-char');
        const typedChar = isUpper ? char.toUpperCase() : char.toLowerCase();
        
        key.classList.add('pressed');
        
        // Update popup label casing
        const popup = key.querySelector('.key-popup');
        if (popup) popup.textContent = typedChar;
        
        playKeySound('standard');
        
        typedTextSpan.textContent += typedChar;
        
        // Turn off shift after manual type of single letter
        if (isUpper) {
          setKeyboardCasing(false);
        }
      });
      
      key.addEventListener('mouseup', () => {
        key.classList.remove('pressed');
      });
      key.addEventListener('mouseleave', () => {
        key.classList.remove('pressed');
      });
      
      // Touch support
      key.addEventListener('touchstart', (e) => {
        e.preventDefault();
        key.dispatchEvent(new Event('mousedown'));
      });
      key.addEventListener('touchend', (e) => {
        e.preventDefault();
        key.dispatchEvent(new Event('mouseup'));
      });
    });
    
    // Shift Key
    keyShift.addEventListener('mousedown', (e) => {
      if (isAnimating) return;
      initAudio();
      keyShift.classList.add('pressed');
      playKeySound('standard');
      
      const isCurrentlyUpper = keyboard.classList.contains('uppercase-state');
      setKeyboardCasing(!isCurrentlyUpper);
    });
    keyShift.addEventListener('mouseup', () => {
      keyShift.classList.remove('pressed');
    });
    keyShift.addEventListener('touchstart', (e) => {
      e.preventDefault();
      keyShift.dispatchEvent(new Event('mousedown'));
    });
    keyShift.addEventListener('touchend', (e) => {
      e.preventDefault();
      keyShift.dispatchEvent(new Event('mouseup'));
    });

    // Backspace Key
    keyBackspace.addEventListener('mousedown', (e) => {
      if (isAnimating) return;
      initAudio();
      keyBackspace.classList.add('pressed');
      playKeySound('backspace');
      
      const text = typedTextSpan.textContent;
      if (text.length > 0) {
        typedTextSpan.textContent = text.substring(0, text.length - 1);
      }
    });
    keyBackspace.addEventListener('mouseup', () => {
      keyBackspace.classList.remove('pressed');
    });
    keyBackspace.addEventListener('touchstart', (e) => {
      e.preventDefault();
      keyBackspace.dispatchEvent(new Event('mousedown'));
    });
    keyBackspace.addEventListener('touchend', (e) => {
      e.preventDefault();
      keyBackspace.dispatchEvent(new Event('mouseup'));
    });

    // Space Key
    keySpace.addEventListener('mousedown', (e) => {
      if (isAnimating) return;
      initAudio();
      keySpace.classList.add('pressed');
      playKeySound('space');
      typedTextSpan.textContent += ' ';
    });
    keySpace.addEventListener('mouseup', () => {
      keySpace.classList.remove('pressed');
    });
    keySpace.addEventListener('touchstart', (e) => {
      e.preventDefault();
      keySpace.dispatchEvent(new Event('mousedown'));
    });
    keySpace.addEventListener('touchend', (e) => {
      e.preventDefault();
      keySpace.dispatchEvent(new Event('mouseup'));
    });

    // Return Key
    keyReturn.addEventListener('mousedown', (e) => {
      if (isAnimating) return;
      initAudio();
      keyReturn.classList.add('pressed');
      playKeySound('return');
      typedTextSpan.textContent += '\n';
    });
    keyReturn.addEventListener('mouseup', () => {
      keyReturn.classList.remove('pressed');
    });
    keyReturn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      keyReturn.dispatchEvent(new Event('mousedown'));
    });
    keyReturn.addEventListener('touchend', (e) => {
      e.preventDefault();
      keyReturn.dispatchEvent(new Event('mouseup'));
    });
  };

  // --- Setting Current Date & Time in Notes App ---
  const updateNotesDate = () => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const dateStr = new Date().toLocaleDateString('zh-CN', options);
    currentDateDiv.textContent = dateStr;
  };

  // --- Export final screenshot of the simulator ---
  const exportFinalImage = async () => {
    try {
      exportImgBtn.disabled = true;
      const originalText = exportImgBtn.textContent;
      exportImgBtn.textContent = '正在导出...';
      
      const bezel = document.querySelector('.iphone-bezel');
      const canvas = await html2canvas(bezel, {
        scale: 2, // High resolution
        logging: false,
        useCORS: true,
        backgroundColor: null
      });
      
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      link.download = `ios-keyboard-snapshot-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      exportImgBtn.textContent = originalText;
    } catch (err) {
      console.error('Image export failed:', err);
      alert('图片导出失败，请重试！');
      exportImgBtn.textContent = '导出最终图片';
    } finally {
      exportImgBtn.disabled = false;
    }
  };

  // --- Control Panel Listeners ---
  const setupControls = () => {
    // Action buttons
    startBtn.addEventListener('click', startAnimation);
    exportImgBtn.addEventListener('click', exportFinalImage);
    resetBtn.addEventListener('click', resetKeyboard);
    
    // Preset English sentences
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        textInput.value = btn.getAttribute('data-text');
        resetKeyboard();
      });
    });
    
    // Layout Mode (Row Shrink vs Single Row Merge)
    layoutModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (isAnimating) return;
        layoutModeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        layoutMode = btn.getAttribute('data-value');
        resetKeyboard();
      });
    });
    
    // Theme Switcher (Light vs Dark)
    themeModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        themeModeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        themeMode = btn.getAttribute('data-value');
        if (themeMode === 'dark') {
          document.body.classList.remove('light-mode');
          document.body.classList.add('dark-mode');
        } else {
          document.body.classList.remove('dark-mode');
          document.body.classList.add('light-mode');
        }
      });
    });
    
    // Unified Speed Slider (CPS - Characters Per Second)
    demoSpeedInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      if (val === 31) {
        fadeSpeed = 0;
        typeSpeed = 0;
        demoSpeedVal.textContent = '极速 (0ms)';
      } else {
        const ms = Math.round(1000 / val);
        fadeSpeed = ms;
        typeSpeed = ms;
        demoSpeedVal.textContent = `${val} 字/秒`;
      }
      updateTransitionSpeeds(fadeSpeed);
    });
    
    // Checkbox sound
    soundToggle.addEventListener('change', (e) => {
      soundEnabled = e.target.checked;
    });
  };

  // --- Assign unique view-transition-names to elements ---
  const assignViewTransitionNames = () => {
    // Letter keys
    letterKeys.forEach(key => {
      const char = key.getAttribute('data-char');
      key.style.viewTransitionName = `key-${char}`;
    });
    
    // Control keys
    if (keyShift) keyShift.style.viewTransitionName = 'key-shift';
    if (keyBackspace) keyBackspace.style.viewTransitionName = 'key-backspace';
    if (keySpace) keySpace.style.viewTransitionName = 'key-space';
    if (keyReturn) keyReturn.style.viewTransitionName = 'key-return';
    
    const key123 = document.getElementById('key-123');
    if (key123) key123.style.viewTransitionName = 'key-123';
    
    const keyGlobe = document.getElementById('key-globe');
    if (keyGlobe) keyGlobe.style.viewTransitionName = 'key-globe';
  };

  // --- Initialize App ---
  const init = () => {
    generateKeyPopups();
    assignViewTransitionNames();
    updateNotesDate();
    setupControls();
    setupManualTyping();
    updateTransitionSpeeds(getDelayFromCps(parseInt(demoSpeedInput.value)));
  };

  init();
});
