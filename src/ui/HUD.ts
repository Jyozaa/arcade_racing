import { PlayerCar } from '../car/PlayerCar';
import { RaceManager, RaceStats } from '../race/RaceManager';
import { TrackData } from '../track/TrackData';
import { AudioEngine } from '../race/AudioEngine';
import { TRACKS } from '../track/tracks';
import { CARS, FLAG_OPTIONS, TIRE_COLORS, TireCompound, driverCode, formatGap } from '../car/cars';
import { AICar } from '../car/AICar';

export class HUD {
  private player: PlayerCar;
  private raceManager: RaceManager;
  private trackData: TrackData;
  private audioEngine: AudioEngine;

  private posCurrentEl!: HTMLElement;
  private lapCurrentEl!: HTMLElement;
  private lapTotalEl!: HTMLElement;
  private posTotalEl!: HTMLElement;
  private timeDisplayEl!: HTMLElement;
  private bestTimeDisplayEl!: HTMLElement;
  private speedNumberEl!: HTMLElement;
  private gearEl!: HTMLElement;
  private revBarEl!: HTMLElement;
  private nitroBarEl!: HTMLElement;
  private surfaceIndicatorEl!: HTMLElement;
  private wrongWayBannerEl!: HTMLElement;
  private countdownOverlayEl!: HTMLElement;
  private countdownTextEl!: HTMLElement;
  private winnerBannerEl!: HTMLElement;
  private winnerTextEl!: HTMLElement;
  private cutsceneOverlayEl!: HTMLElement;
  private cutsceneTitleEl!: HTMLElement;
  private finishWinnerLineEl!: HTMLElement;
  private finishWinnerNameEl!: HTMLElement;
  private lastWinnerShown: string | null = null;
  private standingsOverlayEl!: HTMLElement;
  private standingsListEl!: HTMLElement;
  private touchControlsEl!: HTMLElement;

  private startMenuEl!: HTMLElement;
  private tabAiEl!: HTMLButtonElement;
  private tabOnlineEl!: HTMLButtonElement;
  private aiSetupEl!: HTMLElement;
  private btnStartEl!: HTMLButtonElement;
  private startTitleEl!: HTMLElement;
  private startDescEl!: HTMLElement;
  private leaderboardOverlayEl!: HTMLElement;
  private leaderboardListEl!: HTMLElement;
  private menuBestEl!: HTMLElement;
  private menuBestTimeEl!: HTMLElement;
  private selectedLaps: number = 3;
  private selectedDifficulty: 'ROOKIE' | 'PRO' | 'ACE' = 'PRO';
  private selectedTrackId: string = TRACKS[0].id;
  private selectedCarId: string = CARS[0].id;
  private menuTab: 'AI_RACE' | 'OPEN_TRACK' = 'AI_RACE';

  private finishScreenEl!: HTMLElement;
  private finishTitleEl!: HTMLElement;
  private finishPosEl!: HTMLElement;
  private finishTotalTimeEl!: HTMLElement;
  private finishBestLapEl!: HTMLElement;
  private finishTopSpeedEl!: HTMLElement;
  private btnRestartEl!: HTMLButtonElement;
  private btnMenuFinishEl!: HTMLButtonElement;

  private pauseScreenEl!: HTMLElement;
  private btnResumeEl!: HTMLButtonElement;
  private btnRestartPauseEl!: HTMLButtonElement;
  private btnQuitPauseEl!: HTMLButtonElement;
  private btnAudioToggleEl!: HTMLButtonElement;
  private btnMenuHudEl!: HTMLButtonElement;

  private trackCurrentEl!: HTMLElement;
  private carCurrentEl!: HTMLElement;
  private flagCurrentEl!: HTMLElement;
  private trackIdx: number = 0;
  private carIdx: number = 0;
  private flagIdx: number = 0;
  private selectedFlag: string = '🏁';

  private minimapCanvas!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;
  private minimapScale: number = 0.22;
  private minimapOffset = { x: 90, y: 90 };

  private topSpeedRecorded: number = 0;
  private lastSavedBest: number = Infinity;
  private standingsFrame: number = 0;
  private netDotEl: HTMLElement | null = null;
  private lastNetStatus: string = '';

  public onSelectMode?: (mode: 'AI_RACE' | 'OPEN_TRACK') => void;
  public onSelectTrack?: (trackId: string) => void;
  public onSelectCar?: (carId: string) => void;
  public onSelectFlag?: (emoji: string) => void;
  public onQuitToMenu?: () => void;
  // Wired by Game: Escape during the finish cinematic skips to results.
  public onSkipCinematic?: () => void;
  // Wired by Game: live remote-driver positions for the open-track minimap.
  public getRemoteDots?: () => { x: number; z: number }[];
  // Wired by Game: server state for the leaderboard status dot.
  public getNetStatus?: () => string;

  constructor(player: PlayerCar, raceManager: RaceManager, trackData: TrackData, audioEngine: AudioEngine) {
    this.player = player;
    this.raceManager = raceManager;
    this.trackData = trackData;
    this.audioEngine = audioEngine;

    this.bindElements();
    this.initMinimap();
    this.setupListeners();
  }

  private bindElements() {
    this.posCurrentEl = document.getElementById('pos-current')!;
    this.lapCurrentEl = document.getElementById('lap-current')!;
    this.lapTotalEl = document.querySelector('.lap-total') as HTMLElement;
    this.posTotalEl = document.querySelector('.pos-total') as HTMLElement;
    this.timeDisplayEl = document.getElementById('time-display')!;
    this.bestTimeDisplayEl = document.getElementById('best-time-display')!;
    this.speedNumberEl = document.getElementById('speed-number')!;
    this.gearEl = document.getElementById('gear')!;
    this.revBarEl = document.getElementById('rev-bar')!;
    this.nitroBarEl = document.getElementById('nitro-bar')!;
    this.surfaceIndicatorEl = document.getElementById('surface-indicator')!;
    this.wrongWayBannerEl = document.getElementById('wrong-way-banner')!;
    this.countdownOverlayEl = document.getElementById('countdown-overlay')!;
    this.countdownTextEl = document.getElementById('countdown-text')!;
    this.winnerBannerEl = document.getElementById('winner-banner')!;
    this.winnerTextEl = document.getElementById('winner-text')!;
    this.cutsceneOverlayEl = document.getElementById('cutscene-overlay')!;
    this.cutsceneTitleEl = document.getElementById('cutscene-title')!;
    this.finishWinnerLineEl = document.getElementById('finish-winner-line')!;
    this.finishWinnerNameEl = document.getElementById('finish-winner-name')!;
    this.standingsOverlayEl = document.getElementById('standings-overlay')!;
    this.standingsListEl = document.getElementById('standings-list')!;
    this.touchControlsEl = document.getElementById('touch-controls')!;

    this.startMenuEl = document.getElementById('start-menu')!;
    this.tabAiEl = document.getElementById('tab-ai') as HTMLButtonElement;
    this.tabOnlineEl = document.getElementById('tab-online') as HTMLButtonElement;
    this.aiSetupEl = document.getElementById('ai-setup')!;
    this.btnStartEl = document.getElementById('btn-start') as HTMLButtonElement;
    this.startTitleEl = document.getElementById('start-title')!;
    this.startDescEl = document.getElementById('start-desc')!;
    this.leaderboardOverlayEl = document.getElementById('leaderboard-overlay')!;
    this.leaderboardListEl = document.getElementById('leaderboard-list')!;
    this.menuBestEl = document.getElementById('menu-best')!;
    this.menuBestTimeEl = document.getElementById('menu-best-time')!;

    this.finishScreenEl = document.getElementById('finish-screen')!;
    this.finishTitleEl = document.getElementById('finish-title')!;
    this.finishPosEl = document.getElementById('finish-pos')!;
    this.finishTotalTimeEl = document.getElementById('finish-total-time')!;
    this.finishBestLapEl = document.getElementById('finish-best-lap')!;
    this.finishTopSpeedEl = document.getElementById('finish-top-speed')!;
    this.btnRestartEl = document.getElementById('btn-restart') as HTMLButtonElement;
    this.btnMenuFinishEl = document.getElementById('btn-menu-finish') as HTMLButtonElement;

    this.pauseScreenEl = document.getElementById('pause-screen')!;
    this.btnResumeEl = document.getElementById('btn-resume') as HTMLButtonElement;
    this.btnRestartPauseEl = document.getElementById('btn-restart-pause') as HTMLButtonElement;
    this.btnQuitPauseEl = document.getElementById('btn-quit-pause') as HTMLButtonElement;
    this.btnAudioToggleEl = document.getElementById('btn-audio-toggle') as HTMLButtonElement;
    this.btnMenuHudEl = document.getElementById('btn-menu-hud') as HTMLButtonElement;

    this.trackCurrentEl = document.getElementById('track-current')!;
    this.carCurrentEl = document.getElementById('car-current')!;
    this.flagCurrentEl = document.getElementById('flag-current')!;
    try {
      const saved = localStorage.getItem('apexgp_flag');
      const found = FLAG_OPTIONS.findIndex((f) => f.emoji === saved);
      if (found >= 0) {
        this.flagIdx = found;
        this.selectedFlag = FLAG_OPTIONS[found].emoji;
      }
    } catch { /* private mode */ }
    document.getElementById('track-prev')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleTrack(-1);
    });
    document.getElementById('track-next')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleTrack(1);
    });
    document.getElementById('car-prev')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleCar(-1);
    });
    document.getElementById('car-next')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleCar(1);
    });
    document.getElementById('flag-prev')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleFlag(-1);
    });
    document.getElementById('flag-next')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleFlag(1);
    });

    this.minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.netDotEl = document.getElementById('net-dot');
  }

  private setupListeners() {
    document.querySelectorAll('#laps-selector .seg-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('#laps-selector .seg-btn').forEach((b) => b.classList.remove('active'));
        (btn as HTMLElement).classList.add('active');
        this.selectedLaps = parseInt((btn as HTMLElement).dataset.laps || '3', 10);
        this.raceManager.setLaps(this.selectedLaps);
        this.updateMenuTab();
        this.audioEngine.init();
        this.audioEngine.playClick();
      });
    });
    document.querySelectorAll('#difficulty-selector .seg-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('#difficulty-selector .seg-btn').forEach((b) => b.classList.remove('active'));
        (btn as HTMLElement).classList.add('active');
        this.selectedDifficulty = ((btn as HTMLElement).dataset.difficulty || 'PRO') as 'ROOKIE' | 'PRO' | 'ACE';
        this.raceManager.setDifficulty(this.selectedDifficulty);
        this.audioEngine.init();
        this.audioEngine.playClick();
      });
    });
    this.raceManager.setLaps(this.selectedLaps);
    this.raceManager.setDifficulty(this.selectedDifficulty);
    this.buildTrackCarSelectors();
    this.updateMenuTab();
    this.refreshMenuBest();

    const setTab = (tab: 'AI_RACE' | 'OPEN_TRACK') => {
      this.menuTab = tab;
      this.updateMenuTab();
      this.audioEngine.init();
      this.audioEngine.playClick();
    };
    this.tabAiEl.addEventListener('click', (e) => { e.stopPropagation(); setTab('AI_RACE'); });
    this.tabOnlineEl.addEventListener('click', (e) => { e.stopPropagation(); setTab('OPEN_TRACK'); });

    this.btnStartEl.addEventListener('click', () => {
      const online = this.menuTab === 'OPEN_TRACK';
      this.startMenuEl.classList.add('hidden');
      this.leaderboardOverlayEl.classList.toggle('hidden', !online);
      this.standingsOverlayEl.classList.toggle('hidden', online);
      this.audioEngine.init();
      this.audioEngine.playClick();
      if (this.onSelectMode) {
        this.onSelectMode(this.menuTab);
      }
      this.maybeShowTouchControls();
    });
    this.btnRestartEl.addEventListener('click', () => {
      this.finishScreenEl.classList.add('hidden');
      this.winnerBannerEl.classList.add('hidden');
      this.lastWinnerShown = null;
      this.topSpeedRecorded = 0;
      this.audioEngine.playClick();
      this.raceManager.setupStartingGrid();
    });

    this.btnMenuFinishEl.addEventListener('click', () => {
      this.audioEngine.playClick();
      if (this.onQuitToMenu) this.onQuitToMenu();
    });

    this.btnResumeEl.addEventListener('click', () => {
      this.pauseScreenEl.classList.add('hidden');
      this.raceManager.state = 'RACING';
    });

    this.btnRestartPauseEl.addEventListener('click', () => {
      this.pauseScreenEl.classList.add('hidden');
      this.winnerBannerEl.classList.add('hidden');
      this.lastWinnerShown = null;
      this.topSpeedRecorded = 0;
      this.raceManager.setupStartingGrid();
    });

    this.btnQuitPauseEl.addEventListener('click', () => {
      this.audioEngine.playClick();
      if (this.onQuitToMenu) this.onQuitToMenu();
    });

    this.btnMenuHudEl.addEventListener('click', () => {
      this.audioEngine.init();
      this.audioEngine.playClick();
      if (this.onQuitToMenu) this.onQuitToMenu();
    });

    this.btnAudioToggleEl.addEventListener('click', () => {
      this.audioEngine.init();
      const isMuted = this.audioEngine.toggleMute();
      this.btnAudioToggleEl.innerText = isMuted ? '🔇' : '🔊';
    });

    // ESC pauses, or skips the finish cinematic. Ignored in the start menu.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (!this.startMenuEl.classList.contains('hidden')) return;
        if (this.raceManager.state === 'CUTSCENE') {
          if (this.onSkipCinematic) this.onSkipCinematic();
          return;
        }
        if (this.raceManager.state === 'RACING') {
          this.raceManager.state = 'PAUSED';
          this.pauseScreenEl.classList.remove('hidden');
        } else if (this.raceManager.state === 'PAUSED') {
          this.raceManager.state = 'RACING';
          this.pauseScreenEl.classList.add('hidden');
        }
      }
    });

    this.setupTouchControls();
  }

  private updateMenuTab() {
    const online = this.menuTab === 'OPEN_TRACK';
    this.tabAiEl.classList.toggle('active', !online);
    this.tabOnlineEl.classList.toggle('active', online);
    this.aiSetupEl.classList.toggle('hidden', online);
    this.btnStartEl.classList.toggle('btn-accent', online);
    this.btnStartEl.classList.toggle('btn-primary', !online);
    if (online) {
      this.startTitleEl.innerText = '🌐 Start Open Track';
      this.startDescEl.innerText = 'Live Multiplayer • Random color • Fastest Lap Leaderboard';
    } else {
      const lapWord = this.selectedLaps === 1 ? '1 Lap' : `${this.selectedLaps} Laps`;
      this.startTitleEl.innerText = '🏁 Start Race vs AI';
      this.startDescEl.innerText = `Championship grid • ${lapWord} • 8 Racers • ${this.selectedDifficulty}`;
    }
  }

  private buildTrackCarSelectors() {
    this.renderTrackCycle();
    this.renderCarCycle();
    this.renderFlagCycle();
  }

  private cycleTrack(dir: number) {
    this.trackIdx = (this.trackIdx + dir + TRACKS.length) % TRACKS.length;
    this.renderTrackCycle();
    const t = TRACKS[this.trackIdx];
    this.selectedTrackId = t.id;
    this.audioEngine.init();
    this.audioEngine.playClick();
    if (this.onSelectTrack) this.onSelectTrack(t.id);
  }

  private renderTrackCycle() {
    const t = TRACKS[this.trackIdx];
    this.trackCurrentEl.innerHTML =
      `<span class="pick-badge">${t.badge}</span>` +
      `<span class="pick-name">${t.name}</span>` +
      `<span class="pick-sub">${t.tagline}</span>` +
      `<span class="cycle-count">${this.trackIdx + 1}/${TRACKS.length}</span>`;
  }

  private cycleCar(dir: number) {
    this.carIdx = (this.carIdx + dir + CARS.length) % CARS.length;
    this.renderCarCycle();
    const c = CARS[this.carIdx];
    this.selectedCarId = c.id;
    this.audioEngine.init();
    this.audioEngine.playClick();
    if (this.onSelectCar) this.onSelectCar(c.id);
  }

  private renderCarCycle() {
    const c = CARS[this.carIdx];
    const hex = '#' + c.livery.bodyColor.toString(16).padStart(6, '0');
    this.carCurrentEl.innerHTML =
      `<span class="pick-swatch" style="background:${hex}"></span>` +
      `<span class="pick-name">${c.name}</span>` +
      `<span class="pick-sub">${c.tagline}</span>` +
      `<span class="cycle-count">${this.carIdx + 1}/${CARS.length}</span>`;
  }

  private cycleFlag(dir: number) {
    this.flagIdx = (this.flagIdx + dir + FLAG_OPTIONS.length) % FLAG_OPTIONS.length;
    this.renderFlagCycle();
    const f = FLAG_OPTIONS[this.flagIdx];
    this.selectedFlag = f.emoji;
    this.audioEngine.init();
    this.audioEngine.playClick();
    if (this.onSelectFlag) this.onSelectFlag(f.emoji);
  }

  private renderFlagCycle() {
    const f = FLAG_OPTIONS[this.flagIdx];
    this.flagCurrentEl.innerHTML =
      `<span class="pick-badge">${f.emoji}</span>` +
      `<span class="pick-name">${f.name}</span>` +
      `<span class="cycle-count">${this.flagIdx + 1}/${FLAG_OPTIONS.length}</span>`;
  }

  public setTrackData(trackData: TrackData) {
    this.trackData = trackData;
    this.initMinimap();
  }

  public showMenu() {
    this.pauseScreenEl.classList.add('hidden');
    this.finishScreenEl.classList.add('hidden');
    this.winnerBannerEl.classList.add('hidden');
    this.cutsceneOverlayEl.classList.add('hidden');
    this.countdownOverlayEl.classList.add('hidden');
    this.leaderboardOverlayEl.classList.add('hidden');
    this.standingsOverlayEl.classList.add('hidden');
    this.touchControlsEl.classList.add('hidden');
    this.lastWinnerShown = null;
    this.topSpeedRecorded = 0;
    this.refreshMenuBest();
    this.startMenuEl.classList.remove('hidden');
  }

  private refreshMenuBest() {
    try {
      const raw = localStorage.getItem('apexgp_best_lap');
      if (raw) {
        const v = parseFloat(raw);
        if (Number.isFinite(v) && v > 0) {
          this.menuBestEl.classList.remove('hidden');
          this.menuBestTimeEl.innerText = this.formatTime(v);
          return;
        }
      }
    } catch { /* private mode */ }
    this.menuBestEl.classList.add('hidden');
  }

  public saveBestLap(lapTime: number) {
    try {
      const raw = localStorage.getItem('apexgp_best_lap');
      const prev = raw ? parseFloat(raw) : Infinity;
      if (lapTime < prev) {
        localStorage.setItem('apexgp_best_lap', lapTime.toString());
        this.refreshMenuBest();
      }
    } catch { /* ignore */ }
  }

  private maybeShowTouchControls() {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (isTouch) this.touchControlsEl.classList.remove('hidden');
  }

  private setupTouchControls() {
    const bindHold = (id: string, down: () => void, up: () => void) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (e: Event) => { e.preventDefault(); down(); };
      const off = (e: Event) => { e.preventDefault(); up(); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    bindHold('touch-left', () => { this.player.touch.steer = 1; }, () => { if (this.player.touch.steer > 0) this.player.touch.steer = 0; });
    bindHold('touch-right', () => { this.player.touch.steer = -1; }, () => { if (this.player.touch.steer < 0) this.player.touch.steer = 0; });
    bindHold('touch-gas', () => { this.player.touch.throttle = 1; }, () => { this.player.touch.throttle = 0; });
    bindHold('touch-brake', () => { this.player.touch.brake = true; }, () => { this.player.touch.brake = false; });
    bindHold('touch-nitro', () => { this.player.touch.nitro = true; }, () => { this.player.touch.nitro = false; });
    bindHold('touch-drift', () => { this.player.touch.drift = true; }, () => { this.player.touch.drift = false; });
  }

  private initMinimap() {
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const pt of this.trackData.samplePoints) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }

    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const maxSpan = Math.max(spanX, spanZ);

    this.minimapScale = (this.minimapCanvas.width - 28) / maxSpan;
    this.minimapOffset = {
      x: this.minimapCanvas.width / 2 - ((minX + maxX) / 2) * this.minimapScale,
      y: this.minimapCanvas.height / 2 - ((minZ + maxZ) / 2) * this.minimapScale
    };
  }

  public updateLeaderboard(entries: { id: string; name: string; lapTime: number }[], localPlayerId: string | null) {
    if (!entries || entries.length === 0) {
      this.leaderboardListEl.innerHTML = '<div class="leaderboard-empty">Complete a lap to set a time</div>';
      return;
    }

    let html = '';
    entries.slice(0, 5).forEach((entry, idx) => {
      const isLocal = entry.id === localPlayerId;
      const rank = idx + 1;
      const displayName = isLocal ? 'You' : entry.name;
      const timeStr = this.formatTime(entry.lapTime);

      html += `
        <div class="leaderboard-row ${isLocal ? 'local' : ''}">
          <span class="lb-rank">${rank}.</span>
          <span class="lb-name">${displayName}</span>
          <span class="lb-time">${timeStr}</span>
        </div>
      `;
    });

    this.leaderboardListEl.innerHTML = html;
  }

  public update(countdownText: string | null) {
    const stats: RaceStats = this.raceManager.getStats();

    if (stats.mode === 'OPEN_TRACK') {
      this.posCurrentEl.innerText = 'FREE';
      this.posTotalEl.innerText = 'DRIVE';
      this.posCurrentEl.style.fontSize = '1.8rem';
      this.posCurrentEl.style.color = '#00f0ff';
      this.lapCurrentEl.innerText = stats.lap.toString();
      this.lapTotalEl.innerText = '';
    } else {
      this.posCurrentEl.innerText = `P${stats.position}`;
      this.posTotalEl.innerText = `/ ${stats.totalRacers}`;
      this.posCurrentEl.style.fontSize = '2.75rem';
      this.lapCurrentEl.innerText = Math.min(stats.lap, stats.totalLaps).toString();
      this.lapTotalEl.innerText = `/ ${stats.totalLaps}`;

      if (stats.position === 1) {
        this.posCurrentEl.style.color = '#ffcc00';
      } else if (stats.position === 2) {
        this.posCurrentEl.style.color = '#e2e8f0';
      } else if (stats.position === 3) {
        this.posCurrentEl.style.color = '#f97316';
      } else {
        this.posCurrentEl.style.color = '#94a3b8';
      }
    }

    this.timeDisplayEl.innerText = this.formatTime(stats.currentTime);
    if (stats.bestLapTime < Infinity) {
      this.bestTimeDisplayEl.innerText = `BEST: ${this.formatTime(stats.bestLapTime)}`;
      if (stats.bestLapTime !== this.lastSavedBest) {
        this.lastSavedBest = stats.bestLapTime;
        this.saveBestLap(stats.bestLapTime);
      }
    } else {
      this.bestTimeDisplayEl.innerText = 'BEST: --:--.--';
    }

    const speedKmH = this.player.getSpeedKmH();
    if (speedKmH > this.topSpeedRecorded) {
      this.topSpeedRecorded = speedKmH;
    }
    this.speedNumberEl.innerText = speedKmH.toString();
    const gear = Math.max(1, Math.min(8, Math.floor((speedKmH / 260) * 8) + 1));
    this.gearEl.innerText = gear.toString();

    const maxSpeedEstimate = 225;
    const revPct = Math.min(100, Math.round((speedKmH / maxSpeedEstimate) * 100));
    this.revBarEl.style.width = `${revPct}%`;
    if (this.nitroBarEl) {
      const nitroPct = Math.round(this.player.nitroAmount);
      this.nitroBarEl.style.width = `${nitroPct}%`;
      this.nitroBarEl.classList.toggle('active', this.player.nitroActive);
      this.nitroBarEl.classList.toggle('low', !this.player.nitroLocked && nitroPct < 25);
      this.nitroBarEl.classList.toggle('locked', this.player.nitroLocked);
    }

    if (this.player.isOnRoad) {
      this.surfaceIndicatorEl.innerText = 'ROAD';
      this.surfaceIndicatorEl.className = 'surface-badge road';
    } else {
      this.surfaceIndicatorEl.innerText = 'GRASS (SLOW)';
      this.surfaceIndicatorEl.className = 'surface-badge grass';
    }

    if (this.player.isWrongWay && this.raceManager.state === 'RACING') {
      this.wrongWayBannerEl.classList.remove('hidden');
    } else {
      this.wrongWayBannerEl.classList.add('hidden');
    }

    if (stats.mode === 'OPEN_TRACK') {
      this.countdownOverlayEl.classList.add('hidden');
    } else if (countdownText) {
      this.countdownOverlayEl.classList.remove('hidden');
      this.countdownTextEl.innerText = countdownText;
    } else if (this.raceManager.state === 'RACING') {
      if (this.raceManager.raceTimer < 1.0) {
        this.countdownOverlayEl.classList.remove('hidden');
        this.countdownTextEl.innerText = 'GO!';
      } else {
        this.countdownOverlayEl.classList.add('hidden');
      }
    } else {
      this.countdownOverlayEl.classList.add('hidden');
    }

    if (stats.mode === 'AI_RACE' && stats.hasWinner && stats.winnerName !== this.lastWinnerShown) {
      this.lastWinnerShown = stats.winnerName;
      this.winnerBannerEl.classList.remove('hidden');
      if (stats.winnerIsPlayer) {
        this.winnerTextEl.innerText = `${this.player.flag} YOU WIN THE RACE`;
        this.winnerBannerEl.classList.add('player-win');
      } else {
        const ai = this.raceManager.aiCars.find(
          (c) => this.raceManager.getCarDisplayName(c) === stats.winnerName,
        );
        const tag = ai ? `${ai.flag} ${driverCode(stats.winnerName ?? '')}` : (stats.winnerName ?? '');
        this.winnerTextEl.innerText = `🏁 ${tag} WINS THE RACE`;
        this.winnerBannerEl.classList.remove('player-win');
      }
    } else if (!this.winnerBannerEl.classList.contains('hidden') &&
               (stats.mode !== 'AI_RACE' || !stats.hasWinner)) {
      this.winnerBannerEl.classList.add('hidden');
      if (!stats.hasWinner) this.lastWinnerShown = null;
    }

    if (stats.mode === 'AI_RACE' && this.raceManager.state === 'CUTSCENE') {
      if (this.cutsceneOverlayEl.classList.contains('hidden')) {
        this.cutsceneOverlayEl.classList.remove('hidden');
        this.cutsceneTitleEl.style.animation = 'none';
        void this.cutsceneTitleEl.offsetWidth;
        this.cutsceneTitleEl.style.animation = '';
        this.cutsceneTitleEl.innerText = stats.winnerIsPlayer ? 'VICTORY!' : 'FINISH!';
      }
    } else if (!this.cutsceneOverlayEl.classList.contains('hidden')) {
      this.cutsceneOverlayEl.classList.add('hidden');
    }

    if (stats.mode === 'AI_RACE' && this.raceManager.state === 'FINISHED' && stats.isFinished && this.finishScreenEl.classList.contains('hidden')) {
      this.showFinishScreen(stats);
    }

    if (stats.mode === 'AI_RACE' && this.startMenuEl.classList.contains('hidden')) {
      this.standingsFrame++;
      if (this.standingsFrame % 6 === 0) this.renderStandings();
      if (this.standingsOverlayEl.classList.contains('hidden') &&
          (this.raceManager.state === 'RACING' || this.raceManager.state === 'COUNTDOWN')) {
        this.standingsOverlayEl.classList.remove('hidden');
      }
      if (this.raceManager.state === 'FINISHED' || this.raceManager.state === 'CUTSCENE') {
        this.standingsOverlayEl.classList.add('hidden');
      }
    } else {
      this.standingsOverlayEl.classList.add('hidden');
    }

    this.drawMinimap();

    const menuOpen = !this.startMenuEl.classList.contains('hidden');
    this.btnMenuHudEl.classList.toggle('hidden', menuOpen);

    if (this.getNetStatus && this.netDotEl) {
      const s = this.getNetStatus();
      if (s !== this.lastNetStatus) {
        this.lastNetStatus = s;
        this.netDotEl.className = `net-dot ${s === 'live' ? 'live' : s === 'connecting' ? 'connecting' : s === 'offline' ? 'offline' : ''}`;
        this.netDotEl.title = s === 'live' ? 'Connected to server' : s === 'connecting' ? 'Connecting to server…' : s === 'offline' ? 'Server unreachable' : 'Server connection';
      }
    }
  }

  private renderStandings() {
    const standings = this.raceManager.getStandings();
    if (standings.length === 0) return;
    const leader = standings[0];
    const totalLength = this.trackData.totalLength;
    let html = '';
    standings.forEach((car, idx) => {
      const isPlayer = car === this.player;
      const code = isPlayer ? 'YOU' : driverCode(this.raceManager.getCarDisplayName(car));
      const flag = isPlayer ? this.player.flag : (car as AICar).flag ?? '🏁';
      const body = isPlayer
        ? this.player.currentLivery.bodyColor
        : ((car as AICar).livery?.bodyColor ?? 0x38bdf8);
      const teamHex = '#' + body.toString(16).padStart(6, '0');
      const compound: TireCompound = isPlayer ? 'SOFT' : ((car as AICar).compound ?? 'MEDIUM');
      const gap = idx === 0
        ? 'LEADER'
        : formatGap(leader.currentLap, leader.raceProgress, leader.speed, car.currentLap, car.raceProgress, totalLength);
      html += `<div class="standing-row${isPlayer ? ' player' : ''}${idx === 0 ? ' leader' : ''}">` +
        `<span class="st-team" style="background:${teamHex}"></span>` +
        `<span class="st-pos">P${idx + 1}</span>` +
        `<span class="st-flag">${flag}</span>` +
        `<span class="st-name">${code}</span>` +
        `<span class="st-tire" style="background:${TIRE_COLORS[compound]}"></span>` +
        `<span class="st-gap">${gap}</span></div>`;
    });
    this.standingsListEl.innerHTML = html;
  }

  private showFinishScreen(stats: RaceStats) {
    this.finishScreenEl.classList.remove('hidden');
    const suffix = stats.finalPosition === 1 ? 'st' : stats.finalPosition === 2 ? 'nd' : stats.finalPosition === 3 ? 'rd' : 'th';
    this.finishPosEl.innerText = `${this.player.flag} ${stats.finalPosition}${suffix}`;
    this.finishTotalTimeEl.innerText = this.formatTime(stats.currentTime);
    this.finishBestLapEl.innerText = stats.bestLapTime < Infinity ? this.formatTime(stats.bestLapTime) : '--:--.--';
    this.finishTopSpeedEl.innerText = `${this.topSpeedRecorded} KM/H`;

    if (stats.finalPosition === 1) {
      this.finishTitleEl.innerText = 'VICTORY!';
    } else if (stats.finalPosition <= 3) {
      this.finishTitleEl.innerText = 'PODIUM FINISH!';
    } else {
      this.finishTitleEl.innerText = 'RACE COMPLETED';
    }

    if (stats.hasWinner && !stats.winnerIsPlayer && stats.winnerName) {
      this.finishWinnerLineEl.classList.remove('hidden');
      this.finishWinnerNameEl.innerText = stats.winnerName;
    } else {
      this.finishWinnerLineEl.classList.add('hidden');
    }
  }

  private drawMinimap() {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#1e293b';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < this.trackData.samplePoints.length; i++) {
      const pt = this.trackData.samplePoints[i];
      const mx = pt.x * this.minimapScale + this.minimapOffset.x;
      const my = pt.z * this.minimapScale + this.minimapOffset.y;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e8e8e8';
    for (let i = 0; i < this.trackData.samplePoints.length; i++) {
      const pt = this.trackData.samplePoints[i];
      const mx = pt.x * this.minimapScale + this.minimapOffset.x;
      const my = pt.z * this.minimapScale + this.minimapOffset.y;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.closePath();
    ctx.stroke();

    const startPt = this.trackData.samplePoints[0];
    const smx = startPt.x * this.minimapScale + this.minimapOffset.x;
    const smy = startPt.z * this.minimapScale + this.minimapOffset.y;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(smx - 2, smy - 2, 5, 5);

    // AI dots in races, remote drivers in open track.
    if (this.raceManager.mode === 'OPEN_TRACK') {
      const dots = this.getRemoteDots ? this.getRemoteDots() : [];
      for (const d of dots) {
        const ax = d.x * this.minimapScale + this.minimapOffset.x;
        const ay = d.z * this.minimapScale + this.minimapOffset.y;
        ctx.beginPath();
        ctx.arc(ax, ay, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#a5f3fc'; // pale cyan = live player
        ctx.fill();
      }
    } else {
      for (const ai of this.raceManager.aiCars) {
        const ax = ai.position.x * this.minimapScale + this.minimapOffset.x;
        const ay = ai.position.z * this.minimapScale + this.minimapOffset.y;
        ctx.beginPath();
        ctx.arc(ax, ay, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8'; // bright cyan
        ctx.fill();
      }
    }

    const px = this.player.position.x * this.minimapScale + this.minimapOffset.x;
    const py = this.player.position.z * this.minimapScale + this.minimapOffset.y;

    ctx.beginPath();
    ctx.arc(px, py, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444'; // player red
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#facc15'; // yellow border
    ctx.stroke();
  }

  private formatTime(sec: number): string {
    if (isNaN(sec) || sec < 0) sec = 0;
    const mins = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec * 100) % 100);

    const mStr = mins.toString().padStart(2, '0');
    const sStr = s.toString().padStart(2, '0');
    const msStr = ms.toString().padStart(2, '0');
    return `${mStr}:${sStr}.${msStr}`;
  }
}
