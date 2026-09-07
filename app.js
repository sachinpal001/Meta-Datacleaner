// ===== MetaClean — Instant Photo Privacy App =====
// All processing happens client-side. No data leaves the device.
(function () {
  'use strict';

  const heroSection = document.getElementById('heroSection');
  const processingSection = document.getElementById('processingSection');
  const resultsGrid = document.getElementById('resultsGrid');
  const fileCount = document.getElementById('fileCount');
  const bulkActions = document.getElementById('bulkActions');
  const cameraInput = document.getElementById('cameraInput');
  const fileInput = document.getElementById('fileInput');
  const cameraInput2 = document.getElementById('cameraInput2');
  const addMoreInput = document.getElementById('addMoreInput');
  const dropZone = document.getElementById('dropZone');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const installBtn = document.getElementById('installBtn');
  const autoSaveCheck = document.getElementById('autoSaveCheck');
  const saveFolderBtn = document.getElementById('saveFolderBtn');
  const saveFolderLabel = document.getElementById('saveFolderLabel');
  const desktopHints = document.getElementById('desktopHints');

  // Camera Modal & WebRTC Live Stream elements
  const captureRing = document.getElementById('captureRing');
  const captureAgainBtn = document.getElementById('captureAgainBtn');
  const cameraModal = document.getElementById('cameraModal');
  const cameraVideo = document.getElementById('cameraVideo');
  const shutterBtn = document.getElementById('shutterBtn');
  const closeCameraBtn = document.getElementById('closeCameraBtn');
  const switchCameraBtn = document.getElementById('switchCameraBtn');
  const fallbackFileBtn = document.getElementById('fallbackFileBtn');
  const cameraStatus = document.getElementById('cameraStatus');
  const cameraFlash = document.getElementById('cameraFlash');

  let currentCameraStream = null;
  let currentFacingMode = 'user'; // Defaults to laptop front camera!

  // FIX: Track all active blob URLs so we can revoke them on clear
  let processedFiles = [];
  let activeBlobUrls = [];
  let deferredPrompt = null;

  // Max file size: 20MB — prevents tab crash on huge files
  const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

  // HEIC/HEIF cannot be decoded by canvas in any browser
  const UNSUPPORTED_TYPES = ['image/heic', 'image/heif'];

  // ===== Platform / display-mode detection =====
  const isTouchMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const uaPlatform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const isWindows = /Win/i.test(uaPlatform);

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      navigator.standalone === true;
  }

  if (isWindows) document.documentElement.classList.add('is-windows');
  if (isStandalone()) document.documentElement.classList.add('is-installed');
  if (!isTouchMobile && desktopHints) desktopHints.classList.add('visible');

  // ===== Window Controls Overlay =====
  // When MetaClean is installed as a Windows app, Chrome can hand the title bar to
  // the page. The header then becomes the title bar, so it must reserve room for the
  // minimise/maximise/close buttons and declare itself draggable (see style.css).
  function syncTitlebarOverlay() {
    const wco = navigator.windowControlsOverlay;
    const visible = !!(wco && wco.visible);
    document.documentElement.classList.toggle('wco', visible);
    if (!visible) return;
    const rect = wco.getTitlebarAreaRect();
    const root = document.documentElement.style;
    root.setProperty('--titlebar-height', rect.height + 'px');
    root.setProperty('--titlebar-inset-left', rect.x + 'px');
    root.setProperty('--titlebar-inset-right', Math.max(0, window.innerWidth - rect.right) + 'px');
  }
  if (navigator.windowControlsOverlay) {
    syncTitlebarOverlay();
    navigator.windowControlsOverlay.addEventListener('geometrychange', syncTitlebarOverlay);
  }

  // PWA Install
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone()) installBtn.style.display = 'flex';
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice;
    if (r.outcome === 'accepted') showToast('App installed! 🎉', 'success');
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.style.display = 'none';
    document.documentElement.classList.add('is-installed');
    if (isWindows) showToast('MetaClean added to your Start Menu', 'success');
  });

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  // ===== Windows launcher handshake =====
  // windows\Start-MetaClean.ps1 serves this app from a loopback-only PowerShell
  // server and shuts itself down once no window has checked in, so closing the
  // MetaClean window also stops the background process. Skipped everywhere else,
  // and every request is fire-and-forget so failures are harmless.
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].indexOf(location.hostname) !== -1;
  if (isLoopback && location.protocol === 'http:') {
    const ping = () => { fetch('/__mc/ping', { cache: 'no-store' }).catch(() => { }); };
    ping();
    setInterval(ping, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
    window.addEventListener('pagehide', () => {
      try { navigator.sendBeacon('/__mc/quit'); } catch (err) { }
    });
  }

  // Check for files shared via Web Share Target API
  function checkSharedFiles() {
    try {
      const req = indexedDB.open('MetaCleanDB', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('SharedFiles');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('SharedFiles')) return;
        const tx = db.transaction('SharedFiles', 'readwrite');
        const store = tx.objectStore('SharedFiles');
        const getReq = store.get('latest');
        getReq.onsuccess = () => {
          if (getReq.result && getReq.result.length > 0) {
            handleFiles(getReq.result);
            store.delete('latest');
          }
        };
      };
    } catch (err) {
      console.error('IndexedDB error:', err);
    }
  }
  checkSharedFiles();

  // ===== Windows jump list & "Open with > MetaClean" =====
  // The manifest declares shortcuts (?action=camera / ?action=open) which Windows
  // surfaces on the taskbar jump list, plus file_handlers so Explorer can send
  // images straight here. launch_handler is focus-existing, so a jump-list click
  // does NOT navigate — the action arrives via launchQueue.targetURL instead.
  function runLaunchAction(action) {
    if (action === 'camera') {
      openCameraModal();
    } else if (action === 'open') {
      if (fileInput) fileInput.click();
    }
  }

  try {
    const startupAction = new URLSearchParams(location.search).get('action');
    if (startupAction) {
      history.replaceState(null, '', location.pathname);   // don't re-fire on reload
      setTimeout(() => runLaunchAction(startupAction), 0);
    }
  } catch (err) { }

  if ('launchQueue' in window && window.launchQueue && window.launchQueue.setConsumer) {
    window.launchQueue.setConsumer(async (params) => {
      if (params.targetURL) {
        try {
          const action = new URL(params.targetURL, location.href).searchParams.get('action');
          if (action) runLaunchAction(action);
        } catch (err) { }
      }
      if (params.files && params.files.length) {
        const opened = [];
        for (const handle of params.files) {
          try { opened.push(await handle.getFile()); } catch (err) { }
        }
        if (opened.length) handleFiles(opened);
      }
    });
  }

  // ===== Clipboard paste (Ctrl+V) =====
  // Covers the standard Windows screenshot flow: Win+Shift+S or PrintScreen, then
  // paste straight into MetaClean. Chrome names clipboard images "image.png", so we
  // stamp a real filename to keep saved files distinguishable.
  window.addEventListener('paste', (e) => {
    if (!e.clipboardData) return;
    const items = Array.from(e.clipboardData.items || []);
    const pasted = items
      .filter(i => i.kind === 'file' && i.type && i.type.indexOf('image/') === 0)
      .map(i => i.getAsFile())
      .filter(Boolean);
    if (!pasted.length) return;
    e.preventDefault();
    const stamp = timeStamp();
    const named = pasted.map((f, i) => {
      const suffix = pasted.length > 1 ? '_' + (i + 1) : '';
      const name = 'pasted_' + stamp + suffix + extensionFor(f.type);
      return new File([f], name, { type: f.type, lastModified: f.lastModified });
    });
    handleFiles(named);
  });

  // ===== Desktop keyboard shortcuts =====
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const key = (e.key || '').toLowerCase();
    if (key === 'o') {
      e.preventDefault();
      if (fileInput) fileInput.click();
    } else if (key === 's') {
      e.preventDefault();                 // also suppresses Chrome's "Save page as"
      saveAll();
    }
  });

  // ===== Save folder (File System Access API — Chrome on Windows) =====
  // Lets cleaned photos land in a folder the user picks instead of Downloads.
  // Uses its own IndexedDB database so it can never collide with the version-1
  // 'MetaCleanDB' that sw.js also opens for share-target files.
  const canPickFolder = typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
  let saveDirHandle = null;

  function handleStore(mode, action) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('MetaCleanFS', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('Handles')) db.createObjectStore('Handles');
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('Handles', mode);
        let op;
        try {
          op = action(tx.objectStore('Handles'));
        } catch (err) {
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve(op ? op.result : undefined);
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  function updateSaveFolderUi() {
    if (!saveFolderBtn) return;
    if (!canPickFolder || isTouchMobile) {
      saveFolderBtn.style.display = 'none';
      return;
    }
    saveFolderBtn.style.display = 'flex';
    if (saveDirHandle) {
      saveFolderBtn.classList.add('folder-set');
      if (saveFolderLabel) saveFolderLabel.textContent = saveDirHandle.name;
      saveFolderBtn.title = 'Cleaned photos are saved to "' + saveDirHandle.name + '" — click to change';
    } else {
      saveFolderBtn.classList.remove('folder-set');
      if (saveFolderLabel) saveFolderLabel.textContent = 'Save Folder';
      saveFolderBtn.title = 'Choose a Windows folder to save cleaned photos into';
    }
  }

  async function pickSaveFolder() {
    try {
      const dir = await window.showDirectoryPicker({
        id: 'metaclean-output',
        mode: 'readwrite',
        startIn: 'pictures'
      });
      saveDirHandle = dir;
      try { await handleStore('readwrite', s => s.put(dir, 'saveDir')); } catch (err) { }
      updateSaveFolderUi();
      showToast('Cleaned photos will be saved to "' + dir.name + '"', 'success');
    } catch (err) {
      if (err && err.name !== 'AbortError') showToast('Could not set the save folder', 'error');
    }
  }

  async function ensureFolderPermission() {
    if (!saveDirHandle) return false;
    try {
      if ((await saveDirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
      return (await saveDirHandle.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch (err) {
      return false;
    }
  }

  // Never silently overwrite: clean.jpg, clean (1).jpg, clean (2).jpg, ...
  async function uniqueFileName(dir, filename) {
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : '';
    let candidate = filename;
    for (let i = 1; i < 100; i++) {
      try {
        await dir.getFileHandle(candidate);            // resolves => name is taken
        candidate = base + ' (' + i + ')' + ext;
      } catch (err) {
        return candidate;                              // NotFoundError => free
      }
    }
    return base + '-' + Date.now() + ext;
  }

  async function writeToFolder(blob, filename) {
    if (!saveDirHandle) return false;
    if (!(await ensureFolderPermission())) return false;
    const name = await uniqueFileName(saveDirHandle, filename);
    const fileHandle = await saveDirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  // Writes to the chosen folder when one is set, otherwise falls back to a download.
  async function saveBlob(blob, filename) {
    if (saveDirHandle) {
      try {
        if (await writeToFolder(blob, filename)) return 'folder';
      } catch (err) {
        console.error('Folder save failed, falling back to download:', err);
      }
    }
    downloadBlob(blob, filename);
    return 'download';
  }

  async function saveAll() {
    if (!processedFiles.length) {
      showToast('No cleaned photos yet', 'error');
      return;
    }
    let toFolder = 0;
    let toDownloads = 0;
    for (const pf of processedFiles) {
      if (!pf.cleanBlob) continue;
      if ((await saveBlob(pf.cleanBlob, 'clean_' + pf.name)) === 'folder') toFolder++;
      else toDownloads++;
    }
    if (toFolder) showToast('Saved ' + toFolder + ' photo(s) to "' + saveDirHandle.name + '"', 'success');
    if (toDownloads) showToast('Downloaded ' + toDownloads + ' clean photo(s)', 'success');
  }

  if (saveFolderBtn) saveFolderBtn.addEventListener('click', pickSaveFolder);
  updateSaveFolderUi();

  // Restore a previously chosen folder. Chrome does not persist the permission
  // across reloads, so we only adopt it if it is still granted — otherwise the
  // next save re-prompts from a real user gesture.
  if (canPickFolder) {
    (async () => {
      try {
        const dir = await handleStore('readonly', s => s.get('saveDir'));
        if (!dir) return;
        if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') {
          saveDirHandle = dir;
          updateSaveFolderUi();
        }
      } catch (err) { }
    })();
  }

  // Remember the Auto-Save toggle like a desktop app would
  if (autoSaveCheck) {
    try {
      autoSaveCheck.checked = localStorage.getItem('metaclean.autosave') === '1';
    } catch (err) { }
    autoSaveCheck.addEventListener('change', () => {
      try { localStorage.setItem('metaclean.autosave', autoSaveCheck.checked ? '1' : '0'); } catch (err) { }
    });
  }

  // Event Listeners
  [cameraInput, cameraInput2].forEach(el => {
    if (el) el.addEventListener('change', (e) => handleFiles(e.target.files));
  });
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  addMoreInput.addEventListener('change', (e) => handleFiles(e.target.files));

  // Camera Modal & Live Stream Handlers
  async function openCameraModal() {
    // Mobile devices (Android/iOS) open the native camera app directly
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     (window.matchMedia('(max-width: 768px)').matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0));

    if (isMobile) {
      if (cameraInput) cameraInput.click();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (cameraInput) cameraInput.click();
      return;
    }
    if (cameraModal) cameraModal.style.display = 'flex';
    await startCameraStream(currentFacingMode);
  }

  async function startCameraStream(facingMode) {
    stopCameraStream();
    if (cameraStatus) {
      cameraStatus.style.display = 'block';
      cameraStatus.textContent = 'Accessing laptop camera...';
    }

    try {
      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentCameraStream = stream;

      if (cameraVideo) {
        cameraVideo.srcObject = stream;
        if (facingMode === 'user') {
          cameraVideo.classList.add('user-facing');
        } else {
          cameraVideo.classList.remove('user-facing');
        }
        await cameraVideo.play();
      }

      if (cameraStatus) cameraStatus.style.display = 'none';

      if (navigator.mediaDevices.enumerateDevices && switchCameraBtn) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (videoDevices.length > 1) {
          switchCameraBtn.style.display = 'inline-flex';
        } else {
          switchCameraBtn.style.display = 'none';
        }
      }
    } catch (err) {
      console.error('Camera access error:', err);
      if (cameraStatus) {
        cameraStatus.style.display = 'block';
        cameraStatus.textContent = 'Camera access denied or unavailable. Click "Choose File Instead" below.';
      }
    }
  }

  function stopCameraStream() {
    if (currentCameraStream) {
      currentCameraStream.getTracks().forEach(track => track.stop());
      currentCameraStream = null;
    }
    if (cameraVideo) cameraVideo.srcObject = null;
  }

  function closeCameraModal() {
    stopCameraStream();
    if (cameraModal) cameraModal.style.display = 'none';
  }

  function takeSnapshot() {
    if (!cameraVideo || !cameraVideo.videoWidth) {
      showToast('Camera feed is loading...', 'error');
      return;
    }

    if (cameraFlash) {
      cameraFlash.classList.add('active');
      setTimeout(() => cameraFlash.classList.remove('active'), 250);
    }

    const canvas = document.createElement('canvas');
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    const ctx = canvas.getContext('2d');

    if (currentFacingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) {
        showToast('Failed to capture snapshot', 'error');
        return;
      }

      const now = new Date();
      const filename = 'capture_' + timeStamp(now) + '.jpg';
      const file = new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() });

      // Report what the capture pipeline actually knows about this machine. The JPEG
      // produced by canvas.toBlob carries no EXIF at all, so we say so rather than
      // claiming metadata was stripped out of it.
      const track = currentCameraStream ? currentCameraStream.getVideoTracks()[0] : null;
      const settings = (track && track.getSettings) ? track.getSettings() : {};
      file._webcamMeta = {
        'Capture Source': 'Live webcam stream (WebRTC)',
        'Camera Device': (track && track.label) ? track.label : 'Unnamed camera',
        'Camera Facing': currentFacingMode === 'user' ? 'Front / user-facing' : 'Rear / external',
        'Frame Resolution': canvas.width + ' × ' + canvas.height + ' px',
        'Frame Rate': settings.frameRate ? Math.round(settings.frameRate) + ' fps' : 'not reported',
        'Capture Time': now.toLocaleString(),
        'Host Platform': uaPlatform || 'Desktop',
        'Embedded Metadata': 'None — a canvas capture writes no EXIF',
        '__embedded': false
      };

      closeCameraModal();
      handleFiles([file]);
    }, 'image/jpeg', 0.95);
  }

  // Camera Event Listeners
  if (captureRing) {
    captureRing.addEventListener('click', (e) => {
      e.preventDefault();
      openCameraModal();
    });
  }

  if (captureAgainBtn) {
    captureAgainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openCameraModal();
    });
  }

  if (shutterBtn) shutterBtn.addEventListener('click', takeSnapshot);
  if (closeCameraBtn) closeCameraBtn.addEventListener('click', closeCameraModal);

  if (switchCameraBtn) {
    switchCameraBtn.addEventListener('click', () => {
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
      startCameraStream(currentFacingMode);
    });
  }

  if (fallbackFileBtn) {
    fallbackFileBtn.addEventListener('click', () => {
      closeCameraModal();
      if (cameraInput) cameraInput.click();
    });
  }

  if (cameraModal) {
    cameraModal.addEventListener('click', (e) => {
      if (e.target === cameraModal) closeCameraModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cameraModal && cameraModal.style.display !== 'none') {
      closeCameraModal();
    }
  });

  clearAllBtn.addEventListener('click', () => {
    processedFiles = [];

    // FIX: Revoke all tracked blob URLs on clear to free memory
    activeBlobUrls.forEach(u => URL.revokeObjectURL(u));
    activeBlobUrls = [];

    resultsGrid.innerHTML = '';
    processingSection.style.display = 'none';
    heroSection.style.display = '';
    bulkActions.style.display = 'none';
    fileCount.textContent = '0';
    [cameraInput, fileInput, addMoreInput, cameraInput2].forEach(el => { if (el) el.value = ''; });
  });

  downloadAllBtn.addEventListener('click', saveAll);

  // Drag & Drop
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, () => { dropZone.classList.remove('drag-over'); }));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  }

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter(f =>
      (f.type && f.type.startsWith('image/')) ||
      /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)$/i.test(f.name || '')
    );
    if (imageFiles.length === 0) { showToast('Please select image files only', 'error'); return; }
    heroSection.style.display = 'none';
    processingSection.style.display = '';
    for (const file of imageFiles) await processFile(file);
    updateCounts();
  }

  async function processFile(file) {
    if (UNSUPPORTED_TYPES.includes(file.type)) {
      showToast('HEIC/HEIF not supported by browsers. Convert to JPEG first, then clean.', 'error');
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      showToast(esc(file.name) + ' is too large (max 20MB). Please resize it first.', 'error');
      return;
    }

    const id = 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const card = createResultCard(id, file.name, file.size);
    resultsGrid.appendChild(card);
    try {
      const originalMeta = await readMetadata(file);
      const cleanBlob = await stripMetadata(file);
      const result = { id, name: file.name, cleanBlob, originalMeta };
      processedFiles.push(result);
      updateResultCard(id, result, file);
      if (autoSaveCheck && autoSaveCheck.checked) {
        const where = await saveBlob(cleanBlob, 'clean_' + file.name);
        if (where === 'folder') {
          showToast('✅ Cleaned & saved to "' + saveDirHandle.name + '": ' + file.name, 'success');
        } else {
          showToast('✅ Cleaned & saved: ' + file.name, 'success');
        }
      } else {
        showToast('✅ Cleaned: ' + file.name, 'success');
      }
    } catch (err) {
      console.error('Error processing file:', err);
      updateResultCardError(id, err.message);
    }
  }

  // Reports only what is actually in the file. The previous version filled in
  // "Xiaomi / Phone Device" and "EXIF Data: Present" whenever a tag was missing,
  // which invented metadata for the files a desktop deals with most — screenshots
  // and re-saved images that genuinely carry no EXIF at all.
  function readMetadata(file) {
    return new Promise((resolve) => {
      if (file._webcamMeta) {
        resolve(Object.assign({}, file._webcamMeta));
        return;
      }

      const fileFacts = () => ({
        'File Modified': new Date(file.lastModified).toLocaleString(),
        'File Type': file.type || 'unknown'
      });

      const reader = new FileReader();
      reader.onload = function (e) {
        const view = new DataView(e.target.result);
        const meta = {};
        if (view.byteLength > 4 && view.getUint16(0) === 0xffd8) {
          Object.assign(meta, parseExif(view));
        } else if (view.byteLength > 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
          Object.assign(meta, parsePngChunks(view));
        }

        const embedded = Object.keys(meta).some(k => k !== 'OrientationRaw');
        if (!embedded) meta['Embedded Metadata'] = 'None found — no EXIF, XMP or IPTC block';
        Object.assign(meta, fileFacts());
        meta['__embedded'] = embedded;
        resolve(meta);
      };
      reader.onerror = () => {
        const meta = fileFacts();
        meta['Embedded Metadata'] = 'Could not be read';
        meta['__embedded'] = false;
        resolve(meta);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // PNG keeps its metadata in chunks rather than an EXIF APP1 segment. Windows
  // screenshot tools (Snipping Tool, Greenshot, Paint) routinely leave tEXt keys
  // and a tIME chunk behind, and newer encoders can attach a real eXIf chunk.
  function parsePngChunks(view) {
    const meta = {};
    const textKeys = [];
    const length = view.byteLength;
    let offset = 8; // skip the 8-byte PNG signature

    while (offset + 8 <= length) {
      const chunkLen = view.getUint32(offset);
      const type = readAscii(view, offset + 4, 4);
      if (type === 'IEND') break;

      if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
        const raw = readAscii(view, offset + 8, Math.min(chunkLen, 80));
        const key = raw.split('\u0000')[0];
        if (key) textKeys.push(key);
      } else if (type === 'eXIf') {
        meta['EXIF Data'] = '⚠️ Present (PNG eXIf chunk)';
      } else if (type === 'tIME') {
        meta['PNG Timestamp'] = 'Embedded last-modified time';
      } else if (type === 'iCCP') {
        meta['Colour Profile'] = 'Embedded ICC profile';
      }

      const next = offset + 12 + chunkLen; // length(4) + type(4) + data + crc(4)
      if (next <= offset || next > length) break;
      offset = next;
    }

    if (textKeys.length) {
      meta['PNG Text Chunks'] = textKeys.slice(0, 6).join(', ');
    }
    return meta;
  }

  function parseExif(view) {
    const meta = {};
    const length = view.byteLength;
    let offset = 2; // skip FFD8
    while (offset < length) {
      if (offset + 2 >= length) break;
      const marker = view.getUint16(offset);
      if (marker === 0xffda) break; // SOS — image data starts

      if (marker === 0xffe1) {
        const segLen = view.getUint16(offset + 2);
        const payloadStart = offset + 4;

        if (
          payloadStart + 6 <= length &&
          view.getUint32(payloadStart) === 0x45786966 &&
          view.getUint16(payloadStart + 4) === 0x0000
        ) {
          const tiffStart = payloadStart + 6;
          const bigEndian = view.getUint16(tiffStart) === 0x4d4d;
          const g16 = (o) => view.getUint16(o, !bigEndian);
          const g32 = (o) => view.getUint32(o, !bigEndian);
          const ifdOff = g32(tiffStart + 4);

          const TAGS = {
            0x010f: 'Camera Make', 0x0110: 'Camera Model', 0x0112: 'OrientationRaw',
            0x0131: 'Software', 0x0132: 'Date/Time',
            0x9003: 'Date/Time', 0x9004: 'Date/Time',
            0x920a: 'Focal Length', 0x829a: 'Exposure Time',
            0x829d: 'F-Number', 0x8827: 'ISO Speed', 0xa434: 'Lens Model',
            0x013b: 'Photographer / Artist', 0x8298: 'Copyright Notice',
            0x9286: 'User Comments', 0xc62f: 'Camera Serial Number',
            0xa002: 'Image Width', 0xa003: 'Image Height'
          };

          const parseDirectory = (dirOffset) => {
            if (dirOffset <= 0 || tiffStart + dirOffset + 2 > length) return;
            const entryCount = g16(tiffStart + dirOffset);
            for (let i = 0; i < entryCount && i < 50; i++) {
              const eo = tiffStart + dirOffset + 2 + i * 12;
              if (eo + 12 > length) break;
              const tag = g16(eo), type = g16(eo + 2), count = g32(eo + 4);

              // ExifSubIFD Pointer
              if (tag === 0x8769) {
                parseDirectory(g32(eo + 8));
                continue;
              }

              // GPS IFD Pointer
              if (tag === 0x8825) {
                const gpsOff = g32(eo + 8);
                meta['GPS Coordinates'] = parseGpsLocation(view, tiffStart, gpsOff, g16, g32, length);
                continue;
              }

              if (TAGS[tag]) {
                let val = '';
                if (type === 2) { // ASCII
                  let so = count > 4 ? tiffStart + g32(eo + 8) : eo + 8;
                  if (so + count <= length) {
                    const b = [];
                    for (let j = 0; j < count - 1; j++) {
                      const c = view.getUint8(so + j);
                      if (c > 0) b.push(c);
                    }
                    val = String.fromCharCode(...b).trim();
                  }
                } else if (type === 3) {
                  val = g16(eo + 8).toString();
                } else if (type === 4) {
                  val = g32(eo + 8).toString();
                } else if (type === 5) {
                  const ro = tiffStart + g32(eo + 8);
                  if (ro + 8 <= length) {
                    const num = g32(ro), den = g32(ro + 4);
                    val = den ? (num / den).toFixed(2) : num.toString();
                  }
                }
                if (val) meta[TAGS[tag]] = val;
              }
            }
          };

          parseDirectory(ifdOff);
          meta['EXIF Data'] = '⚠️ Present';
        } else if (payloadStart + 29 <= length && readAscii(view, payloadStart, 29) === 'http://ns.adobe.com/xap/1.0/\0') {
          meta['XMP Metadata'] = 'Adobe XMP Block Present';
        }

        if (segLen <= 0) break;
        offset += 2 + segLen;
        continue;
      }

      if (marker === 0xffed) {
        meta['IPTC / Photoshop'] = 'IPTC Photoshop Block Present';
      }

      const segLen = view.getUint16(offset + 2);
      if (segLen <= 0) break;
      offset += 2 + segLen;
    }
    return meta;
  }

  function parseGpsLocation(view, tiffStart, gpsOff, g16, g32, length) {
    if (gpsOff <= 0 || tiffStart + gpsOff + 2 > length) return 'GPS Location Tag Embedded';
    const count = g16(tiffStart + gpsOff);
    let latRef = 'N', lonRef = 'E', lat = null, lon = null;

    const getRationalDeg = (eo) => {
      const ro = tiffStart + g32(eo + 8);
      if (ro + 24 <= length) {
        const d1 = g32(ro), d2 = g32(ro + 4);
        const m1 = g32(ro + 8), m2 = g32(ro + 12);
        const s1 = g32(ro + 16), s2 = g32(ro + 20);
        const deg = d2 ? d1 / d2 : 0;
        const min = m2 ? m1 / m2 : 0;
        const sec = s2 ? s1 / s2 : 0;
        return `${deg.toFixed(0)}°${min.toFixed(0)}'${sec.toFixed(1)}"`;
      }
      return null;
    };

    for (let i = 0; i < count && i < 20; i++) {
      const eo = tiffStart + gpsOff + 2 + i * 12;
      if (eo + 12 > length) break;
      const tag = g16(eo);
      if (tag === 1) latRef = String.fromCharCode(view.getUint8(eo + 8)) || 'N';
      else if (tag === 2) lat = getRationalDeg(eo);
      else if (tag === 3) lonRef = String.fromCharCode(view.getUint8(eo + 8)) || 'E';
      else if (tag === 4) lon = getRationalDeg(eo);
    }
    if (lat && lon) return `${lat} ${latRef}, ${lon} ${lonRef}`;
    return 'Embedded GPS Coordinates';
  }

  function readAscii(view, offset, length) {
    let str = '';
    try {
      for (let i = 0; i < length; i++) {
        if (offset + i >= view.byteLength) break;
        str += String.fromCharCode(view.getUint8(offset + i));
      }
    } catch (e) {}
    return str;
  }

  // Chrome — and every current browser — applies the EXIF Orientation tag while it
  // decodes an image, so naturalWidth/naturalHeight and drawImage() are ALREADY
  // upright. The previous version re-applied the rotation matrix on top of that,
  // which rotated every photo a second time: verified against synthetic
  // Orientation 1-8 fixtures, only Orientation 1 survived intact. Portrait phone
  // photos (Orientation 6) came out sideways with swapped dimensions. Drawing the
  // decoded image as-is is correct for all eight values, and the canvas re-encode
  // still discards the orientation tag along with the rest of the metadata.
  function stripMetadata(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const q = mime === 'image/png' ? undefined : 0.95;
        c.toBlob((b) => b ? resolve(b) : reject(new Error('Failed to create clean image')), mime, q);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  }

  function createResultCard(id, name, size) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.id = id;
    card.innerHTML =
      '<div class="result-card-header">' +
      '<div class="result-thumb" style="background:var(--glass);display:flex;align-items:center;justify-content:center;"><div class="spinner"></div></div>' +
      '<div class="result-info"><div class="result-filename">' + esc(name) + '</div><div class="result-size">Original: ' + formatBytes(size) + '</div></div>' +
      '<div class="result-status status-cleaning"><div class="spinner"></div> Cleaning...</div>' +
      '</div>';
    return card;
  }

  function updateResultCard(id, result, origFile) {
    const card = document.getElementById(id);
    if (!card) return;

    const thumbUrl = URL.createObjectURL(result.cleanBlob);
    activeBlobUrls.push(thumbUrl);

    // Filter out internal non-display tags
    const allEntries = Object.entries(result.originalMeta).filter(
      ([k]) => !['OrientationRaw', '__embedded'].includes(k)
    );
    const hadEmbedded = result.originalMeta['__embedded'] === true;

    // Claim only what was actually found: a screenshot with no EXIF should not be
    // told its GPS coordinates were removed.
    const keys = allEntries.map(([k]) => k.toLowerCase());
    const has = (...fragments) => fragments.some(f => keys.some(k => k.indexOf(f) !== -1));
    const badges = [];
    if (!hadEmbedded) {
      badges.push(['badge-exif', '✅ No embedded metadata found']);
    } else {
      if (has('gps', 'location')) badges.push(['badge-gps', '🛡️ GPS: Removed']);
      if (has('camera', 'lens', 'make', 'serial')) badges.push(['badge-exif', '📷 Camera Info: Stripped']);
      if (has('exif', 'xmp', 'iptc', 'png text')) badges.push(['badge-exif', '🏷️ EXIF/XMP: Removed']);
      if (has('date', 'time', 'software')) badges.push(['badge-time', '📅 Timestamp: Cleared']);
    }
    badges.push(['badge-time', '📄 File timestamp not carried over']);
    const badgesHtml = badges
      .map(([cls, text]) => '<span class="meta-badge ' + cls + '">' + text + '</span>')
      .join('');

    let beforeListHtml = '';
    let afterListHtml = '';

    allEntries.forEach(([k, v]) => {
      let cleanVal = '✅ Stripped & Protected';
      const keyLower = k.toLowerCase();
      if (keyLower === 'embedded metadata') {
        cleanVal = '✅ Still clean — nothing to remove';
      } else if (keyLower === 'file type') {
        cleanVal = '✅ Re-encoded from raw pixels';
      } else if (keyLower.includes('gps') || keyLower.includes('location')) {
        cleanVal = '✅ 0 Location Bytes (Removed)';
      } else if (keyLower.includes('camera') || keyLower.includes('model') || keyLower.includes('make') || keyLower.includes('device')) {
        cleanVal = '✅ Identifiers Removed';
      } else if (keyLower.includes('date') || keyLower.includes('time') || keyLower.includes('modified') || keyLower.includes('timestamp')) {
        cleanVal = '✅ Timestamp Cleared';
      } else if (keyLower.includes('exif') || keyLower.includes('xmp') || keyLower.includes('iptc') || keyLower.includes('header') || keyLower.includes('chunk') || keyLower.includes('profile')) {
        cleanVal = '✅ 0 EXIF Headers Remaining';
      } else if (keyLower.includes('format') || keyLower.includes('size') || keyLower.includes('resolution') || keyLower.includes('platform') || keyLower.includes('engine')) {
        cleanVal = '✅ Standardized';
      }

      beforeListHtml += '<li class="removed"><span>' + esc(k) + ':</span> <span>' + esc(v) + '</span></li>';
      afterListHtml += '<li class="clean-item"><span>' + esc(k) + ':</span> <span>' + esc(cleanVal) + '</span></li>';
    });

    let html =
      '<div class="result-card-header">' +
      '<img class="result-thumb" src="' + thumbUrl + '" alt="Clean photo" loading="lazy">' +
      '<div class="result-info">' +
      '<div class="result-filename">' + esc(result.name) + '</div>' +
      '<div class="result-size">Original: ' + formatBytes(origFile.size) + ' → Clean: ' + formatBytes(result.cleanBlob.size) + '</div>' +
      '<div class="metadata-badges">' +
      badgesHtml +
      '</div>' +
      '</div>' +
      '<div class="result-status status-done">' +
      '<svg class="status-icon checkmark-anim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' +
      '</svg> Cleaned!' +
      '</div>' +
      '</div>';

    html +=
      '<div class="metadata-comparison" id="meta-' + id + '">' +
      '<div class="metadata-box">' +
      '<div class="metadata-box-title before">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
      ' Before (Exposed Exact Data)' +
      '</div>' +
      '<ul class="metadata-list">' +
      beforeListHtml +
      '</ul>' +
      '</div>' +
      '<div class="metadata-box">' +
      '<div class="metadata-box-title after">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
      ' After (100% Cleaned)' +
      '</div>' +
      '<ul class="metadata-list">' +
      afterListHtml +
      '</ul>' +
      '</div>' +
      '</div>';

    html +=
      '<div class="result-actions">' +
      '<button class="btn-download" data-id="' + id + '">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      ' Download Clean Photo' +
      '</button>' +
      '<button class="btn-toggle-meta-text" data-target="meta-' + id + '">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
      ' <span class="toggle-text">Hide Stripped Metadata</span>' +
      '</button>' +
      '</div>';

    card.innerHTML = html;
    card.classList.add('success-flash');

    card.querySelector('.btn-download').addEventListener('click', async () => {
      const where = await saveBlob(result.cleanBlob, 'clean_' + result.name);
      if (where === 'folder') {
        showToast('Saved to "' + saveDirHandle.name + '"', 'success');
      } else {
        showToast('Downloaded!', 'success');
      }
    });

    const tb = card.querySelector('.btn-toggle-meta-text');
    if (tb) {
      tb.addEventListener('click', () => {
        const m = document.getElementById('meta-' + id);
        const textSpan = tb.querySelector('.toggle-text');
        if (m) {
          const isHidden = m.style.display === 'none';
          m.style.display = isHidden ? '' : 'none';
          if (textSpan) textSpan.textContent = isHidden ? 'Hide Stripped Metadata' : 'Show Stripped Metadata';
        }
      });
    }
  }

  function updateResultCardError(id, msg) {
    const card = document.getElementById(id);
    if (!card) return;
    const s = card.querySelector('.result-status');
    if (s) { s.className = 'result-status'; s.style.color = 'var(--accent-red)'; s.innerHTML = '❌ Error'; }
    showToast(msg || 'Failed to process image', 'error');
  }

  function updateCounts() {
    fileCount.textContent = processedFiles.length;
    bulkActions.style.display = processedFiles.length > 1 ? '' : 'none';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showToast(message, type) {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'success');
    const icon = type === 'error'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    t.innerHTML = icon + ' ' + esc(message);
    c.appendChild(t);
    setTimeout(() => {
      t.classList.add('toast-exit');
      t.addEventListener('animationend', () => t.remove());
    }, 3000);
  }

  function formatBytes(b) {
    if (b === 0) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
  }

  // YYYYMMDD_HHMMSS — sorts correctly in File Explorer and is filename-safe
  function timeStamp(date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function extensionFor(mime) {
    if (mime === 'image/jpeg') return '.jpg';
    if (mime === 'image/webp') return '.webp';
    if (mime === 'image/gif') return '.gif';
    if (mime === 'image/bmp') return '.bmp';
    return '.png';
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
})();