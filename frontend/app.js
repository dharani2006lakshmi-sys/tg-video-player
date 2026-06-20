(() => {
  const els = {
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    stageFrame: document.getElementById('stageFrame'),
    emptyState: document.getElementById('emptyState'),
    video: document.getElementById('video'),
    tooLargeBanner: document.getElementById('tooLargeBanner'),
    tooLargeName: document.getElementById('tooLargeName'),
    controls: document.getElementById('controls'),
    playBtn: document.getElementById('playBtn'),
    iconPlay: document.getElementById('iconPlay'),
    iconPause: document.getElementById('iconPause'),
    rewindBtn: document.getElementById('rewindBtn'),
    forwardBtn: document.getElementById('forwardBtn'),
    muteBtn: document.getElementById('muteBtn'),
    iconVolHigh: document.getElementById('iconVolHigh'),
    iconVolMute: document.getElementById('iconVolMute'),
    volTrack: document.getElementById('volTrack'),
    volFill: document.getElementById('volFill'),
    scrubTrack: document.getElementById('scrubTrack'),
    scrubFill: document.getElementById('scrubFill'),
    scrubBuffered: document.getElementById('scrubBuffered'),
    scrubHandle: document.getElementById('scrubHandle'),
    timeCurrent: document.getElementById('timeCurrent'),
    timeDuration: document.getElementById('timeDuration'),
    nowPlaying: document.getElementById('nowPlaying'),
    speedBtn: document.getElementById('speedBtn'),
    speedMenu: document.getElementById('speedMenu'),
    pipBtn: document.getElementById('pipBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    iconExpand: document.getElementById('iconExpand'),
    iconCompress: document.getElementById('iconCompress'),
    metaRow: document.getElementById('metaRow'),
    metaTitle: document.getElementById('metaTitle'),
    metaSize: document.getElementById('metaSize'),
    metaDuration: document.getElementById('metaDuration'),
    metaAdded: document.getElementById('metaAdded'),
    logList: document.getElementById('logList'),
    refreshBtn: document.getElementById('refreshBtn'),
  };

  let videos = [];
  let activeId = null;
  let isDraggingScrub = false;
  let isDraggingVol = false;
  let pollTimer = null;

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function fmtAddedAt(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function setStatus(state, label) {
    els.statusDot.className = 'status-dot' + (state ? ' ' + state : '');
    els.statusText.textContent = label;
  }

  // ---------------------------------------------------------------------
  // Fetch & render video list
  // ---------------------------------------------------------------------
  async function fetchVideos({ silent = false } = {}) {
    if (!silent) els.refreshBtn.classList.add('spinning');
    try {
      const res = await fetch(`${API_BASE}/api/videos`);
      if (!res.ok) throw new Error('Bad response');
      const data = await res.json();
      videos = data;
      setStatus('live', 'connected');
      renderList();
    } catch (err) {
      setStatus('error', 'offline');
      if (!silent) renderListError();
    } finally {
      setTimeout(() => els.refreshBtn.classList.remove('spinning'), 400);
    }
  }

  function renderListError() {
    els.logList.innerHTML = `
      <div class="log-empty">
        <div class="num">ERR</div>
        <p>Can't reach the backend.<br>Check that your Render service is awake and config.js points to the right URL.</p>
      </div>`;
  }

  function renderList() {
    if (videos.length === 0) {
      els.logList.innerHTML = `
        <div class="log-empty">
          <div class="num">00</div>
          <p>Nothing here yet.<br>Send a video to your Telegram bot to get started.</p>
        </div>`;
      return;
    }

    els.logList.innerHTML = '';
    videos.forEach((v, idx) => {
      const item = document.createElement('div');
      item.className = 'log-item' + (v.id === activeId ? ' active' : '');
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');

      const num = String(idx + 1).padStart(2, '0');

      item.innerHTML = `
        <span class="log-item-num">${num}</span>
        <div class="log-thumb">
          ${v.thumbUrl
            ? `<img src="${API_BASE}${v.thumbUrl}" alt="" loading="lazy" />`
            : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`}
        </div>
        <div class="log-item-body">
          <div class="log-item-title">${escapeHtml(v.fileName)}</div>
          <div class="log-item-meta">
            <span>${v.sizeLabel}</span>
            ${v.duration ? `<span>${fmtTime(v.duration)}</span>` : ''}
            ${v.tooLarge ? `<span class="warn">over limit</span>` : ''}
          </div>
        </div>
      `;

      item.addEventListener('click', () => loadVideo(v));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadVideo(v); }
      });

      els.logList.appendChild(item);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------
  // Load & play a video
  // ---------------------------------------------------------------------
  function loadVideo(v) {
    activeId = v.id;
    renderList();

    els.emptyState.hidden = true;
    els.metaRow.hidden = false;
    els.metaTitle.textContent = v.fileName;
    els.metaSize.textContent = v.sizeLabel;
    els.metaDuration.textContent = v.duration ? fmtTime(v.duration) : '—';
    els.metaAdded.textContent = fmtAddedAt(v.addedAt);
    els.nowPlaying.textContent = v.fileName;

    if (v.tooLarge) {
      els.video.hidden = true;
      els.video.removeAttribute('src');
      els.tooLargeBanner.hidden = false;
      els.tooLargeName.textContent = v.fileName;
      els.controls.style.display = 'none';
      return;
    }

    els.tooLargeBanner.hidden = true;
    els.video.hidden = false;
    els.controls.style.display = '';
    els.video.src = `${API_BASE}${v.streamUrl}`;
    els.video.load();
    els.video.play().catch(() => { /* autoplay may be blocked, that's fine */ });
  }

  // ---------------------------------------------------------------------
  // Custom controls — playback
  // ---------------------------------------------------------------------
  function togglePlay() {
    if (els.video.paused) els.video.play();
    else els.video.pause();
  }

  els.playBtn.addEventListener('click', togglePlay);
  els.video.addEventListener('click', togglePlay);

  els.video.addEventListener('play', () => {
    els.iconPlay.hidden = true;
    els.iconPause.hidden = false;
    els.stageFrame.classList.remove('paused');
  });

  els.video.addEventListener('pause', () => {
    els.iconPlay.hidden = false;
    els.iconPause.hidden = true;
    els.stageFrame.classList.add('paused');
  });

  els.rewindBtn.addEventListener('click', () => {
    els.video.currentTime = Math.max(0, els.video.currentTime - 10);
  });
  els.forwardBtn.addEventListener('click', () => {
    els.video.currentTime = Math.min(els.video.duration || Infinity, els.video.currentTime + 10);
  });

  // ---------------------------------------------------------------------
  // Scrub bar
  // ---------------------------------------------------------------------
  function updateScrubFromEvent(e) {
    const rect = els.scrubTrack.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.min(1, Math.max(0, pct));
    if (els.video.duration) {
      els.video.currentTime = pct * els.video.duration;
    }
    paintScrub(pct);
  }

  function paintScrub(pct) {
    const p = (pct * 100).toFixed(2) + '%';
    els.scrubFill.style.width = p;
    els.scrubHandle.style.left = p;
  }

  els.scrubTrack.addEventListener('mousedown', (e) => {
    isDraggingScrub = true;
    updateScrubFromEvent(e);
  });
  els.scrubTrack.addEventListener('touchstart', (e) => {
    isDraggingScrub = true;
    updateScrubFromEvent(e);
  }, { passive: true });

  window.addEventListener('mousemove', (e) => { if (isDraggingScrub) updateScrubFromEvent(e); });
  window.addEventListener('touchmove', (e) => { if (isDraggingScrub) updateScrubFromEvent(e); }, { passive: true });
  window.addEventListener('mouseup', () => { isDraggingScrub = false; });
  window.addEventListener('touchend', () => { isDraggingScrub = false; });

  els.video.addEventListener('timeupdate', () => {
    if (isDraggingScrub) return;
    const dur = els.video.duration || 0;
    const pct = dur ? els.video.currentTime / dur : 0;
    paintScrub(pct);
    els.timeCurrent.textContent = fmtTime(els.video.currentTime);
  });

  els.video.addEventListener('loadedmetadata', () => {
    els.timeDuration.textContent = fmtTime(els.video.duration);
  });

  els.video.addEventListener('progress', () => {
    if (!els.video.duration || els.video.buffered.length === 0) return;
    try {
      const end = els.video.buffered.end(els.video.buffered.length - 1);
      const pct = (end / els.video.duration) * 100;
      els.scrubBuffered.style.width = pct + '%';
    } catch { /* ignore */ }
  });

  // ---------------------------------------------------------------------
  // Volume
  // ---------------------------------------------------------------------
  function updateVolFromEvent(e) {
    const rect = els.volTrack.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.min(1, Math.max(0, pct));
    els.video.volume = pct;
    els.video.muted = pct === 0;
    paintVol(pct);
  }

  function paintVol(pct) {
    els.volFill.style.width = (pct * 100) + '%';
    els.iconVolHigh.hidden = pct === 0;
    els.iconVolMute.hidden = pct !== 0;
  }

  els.volTrack.addEventListener('mousedown', (e) => { isDraggingVol = true; updateVolFromEvent(e); });
  window.addEventListener('mousemove', (e) => { if (isDraggingVol) updateVolFromEvent(e); });
  window.addEventListener('mouseup', () => { isDraggingVol = false; });

  els.muteBtn.addEventListener('click', () => {
    els.video.muted = !els.video.muted;
    paintVol(els.video.muted ? 0 : els.video.volume);
  });

  els.video.volume = 1;
  paintVol(1);

  // ---------------------------------------------------------------------
  // Speed menu
  // ---------------------------------------------------------------------
  els.speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.speedMenu.classList.toggle('open');
  });

  els.speedMenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.dataset.speed);
      els.video.playbackRate = speed;
      els.speedBtn.textContent = speed + 'x';
      els.speedMenu.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      els.speedMenu.classList.remove('open');
    });
  });

  document.addEventListener('click', () => els.speedMenu.classList.remove('open'));

  // ---------------------------------------------------------------------
  // Picture-in-picture
  // ---------------------------------------------------------------------
  els.pipBtn.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await els.video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP not available:', err.message);
    }
  });

  // ---------------------------------------------------------------------
  // Fullscreen
  // ---------------------------------------------------------------------
  els.fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      els.stageFrame.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const isFull = !!document.fullscreenElement;
    els.iconExpand.hidden = isFull;
    els.iconCompress.hidden = !isFull;
  });

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    switch (e.key.toLowerCase()) {
      case 'k':
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'j':
        els.video.currentTime = Math.max(0, els.video.currentTime - 10);
        break;
      case 'l':
        els.video.currentTime = Math.min(els.video.duration || Infinity, els.video.currentTime + 10);
        break;
      case 'm':
        els.muteBtn.click();
        break;
      case 'f':
        els.fullscreenBtn.click();
        break;
      case 'arrowup':
        e.preventDefault();
        els.video.volume = Math.min(1, els.video.volume + 0.1);
        els.video.muted = false;
        paintVol(els.video.volume);
        break;
      case 'arrowdown':
        e.preventDefault();
        els.video.volume = Math.max(0, els.video.volume - 0.1);
        paintVol(els.video.volume);
        break;
      case 'arrowleft':
        els.video.currentTime = Math.max(0, els.video.currentTime - 5);
        break;
      case 'arrowright':
        els.video.currentTime = Math.min(els.video.duration || Infinity, els.video.currentTime + 5);
        break;
    }
  });

  // Show controls on mouse activity, hide after idle while playing
  let idleTimer = null;
  els.stageFrame.addEventListener('mousemove', () => {
    els.stageFrame.classList.add('controls-active');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!els.video.paused) els.stageFrame.classList.remove('controls-active');
    }, 2200);
  });

  // ---------------------------------------------------------------------
  // Refresh button + polling
  // ---------------------------------------------------------------------
  els.refreshBtn.addEventListener('click', () => fetchVideos());

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => fetchVideos({ silent: true }), 8000);
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  fetchVideos();
  startPolling();
})();
