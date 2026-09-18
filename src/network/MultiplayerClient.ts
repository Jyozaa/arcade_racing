import * as THREE from 'three';
import { CarModel, CarColorConfig } from '../car/CarModel';
import { PlayerCar } from '../car/PlayerCar';

export interface LeaderboardEntry {
  id: string;
  name: string;
  lapTime: number;
}

export interface RemotePlayer {
  id: string;
  name: string;
  model: CarModel;
  label: THREE.Sprite;
  livery: CarColorConfig;
  flag: string;
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  currentQuat: THREE.Quaternion;
  targetQuat: THREE.Quaternion;
  speed: number;
  lap: number;
}

// Sanitize an untrusted livery payload.
function sanitizeLivery(raw: any): CarColorConfig {
  const num = (v: any, fallback: number) => (Number.isFinite(v) ? (v as number) : fallback);
  return {
    bodyColor: num(raw?.bodyColor, 0x3b82f6),
    accentColor: num(raw?.accentColor, 0xffffff),
    sideColor: num(raw?.sideColor, 0x1d4ed8),
    helmetColor: num(raw?.helmetColor, 0xfacc15),
  };
}

function sanitizeFlag(raw: any): string {
  return typeof raw === 'string' && raw.length > 0 ? raw.slice(0, 8) : '🏁';
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private scene: THREE.Scene;
  private playerCar: PlayerCar;

  public localPlayerId: string | null = null;
  public localPlayerName: string = 'You';
  public isConnected: boolean = false;
  public autoReconnect: boolean = true;
  public status: 'idle' | 'connecting' | 'live' | 'offline' = 'idle';

  private remotePlayers: Map<string, RemotePlayer> = new Map();
  private onLeaderboardUpdate: ((leaderboard: LeaderboardEntry[]) => void) | null = null;

  private sendInterval: number = 0.05; // 20 Hz
  private sendTimer: number = 0;
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUrl: string | null = null;
  private manualDisconnect: boolean = false;
  private pendingLivery: CarColorConfig | null = null;
  private pendingFlag: string = '🏁';

  constructor(scene: THREE.Scene, playerCar: PlayerCar, onLeaderboardUpdate?: (lb: LeaderboardEntry[]) => void) {
    this.scene = scene;
    this.playerCar = playerCar;
    if (onLeaderboardUpdate) {
      this.onLeaderboardUpdate = onLeaderboardUpdate;
    }
  }

  // explicit arg > ?server= override > saved override > same-origin > localhost:8080.
  private resolveUrl(url?: string): string {
    if (url) return url;
    try {
      const params = new URLSearchParams(window.location.search);
      const override = params.get('server');
      if (override) {
        try { localStorage.setItem('apexgp_server', override); } catch { /* private mode */ }
        return override;
      }
    } catch { /* non-browser URL */ }
    try {
      const saved = localStorage.getItem('apexgp_server');
      if (saved) return saved;
    } catch { /* private mode */ }
    const secure = window.location.protocol === 'https:';
    const scheme = secure ? 'wss' : 'ws';
    const host = window.location.hostname || 'localhost';
    if (!window.location.port) return `${scheme}://${host}`;
    return `${scheme}://${host}:8080`;
  }

  public connect(url?: string, livery?: CarColorConfig, flag?: string) {
    const wsUrl = this.resolveUrl(url);
    console.log('[Multiplayer] Connecting to', wsUrl);
    this.lastUrl = wsUrl;
    this.manualDisconnect = false;
    this.status = 'connecting';
    if (livery) this.pendingLivery = livery;
    if (flag) this.pendingFlag = flag;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[Multiplayer] Connected to server');
        this.isConnected = true;
        this.status = 'live';
        this.reconnectAttempts = 0;
        if (this.pendingLivery && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'livery', livery: this.pendingLivery, flag: this.pendingFlag }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[Multiplayer] Failed to parse message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[Multiplayer] Disconnected from server');
        this.isConnected = false;
        this.status = this.manualDisconnect ? 'offline' : 'connecting';
        this.clearRemotePlayers();
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('[Multiplayer] WebSocket error:', err);
        if (!this.isConnected) this.status = 'connecting';
      };
    } catch (err) {
      console.warn('[Multiplayer] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (!this.autoReconnect || this.manualDisconnect) return;
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= 10) {
      this.status = 'offline';
      return;
    }
    const delay = Math.min(5000, 600 * Math.pow(1.5, this.reconnectAttempts));
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected && this.lastUrl) this.connect(this.lastUrl);
    }, delay);
  }

  public disconnect() {
    this.manualDisconnect = true;
    this.autoReconnect = true; // keep default for next connect()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
    this.clearRemotePlayers();
    this.isConnected = false;
    this.status = 'offline';
    this.reconnectAttempts = 0;
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'init':
        this.localPlayerId = msg.playerId;
        this.localPlayerName = msg.name;
        for (const p of msg.players) {
          this.addRemotePlayer(p);
        }
        if (msg.leaderboard && this.onLeaderboardUpdate) {
          this.onLeaderboardUpdate(msg.leaderboard);
        }
        break;

      case 'player_joined':
        if (msg.player.id !== this.localPlayerId) {
          this.addRemotePlayer(msg.player);
        }
        break;

      case 'player_update':
        this.updateRemotePlayer(msg);
        break;

      case 'player_left':
        this.removeRemotePlayer(msg.id);
        break;

      case 'player_livery':
        this.applyRemoteLivery(msg.id, sanitizeLivery(msg.livery), sanitizeFlag(msg.flag));
        break;

      case 'leaderboard_update':
        if (this.onLeaderboardUpdate) {
          this.onLeaderboardUpdate(msg.leaderboard);
        }
        break;
    }
  }

  private addRemotePlayer(data: any) {
    if (this.remotePlayers.has(data.id)) return;

    const livery: CarColorConfig = data.livery ? sanitizeLivery(data.livery) : {
      bodyColor: 0x3b82f6,
      accentColor: 0xffffff,
      sideColor: 0x1d4ed8,
      helmetColor: 0xfacc15
    };

    const model = new CarModel(livery);
    this.scene.add(model.mesh);

    const flag = sanitizeFlag(data.flag);
    const label = this.makeNameSprite(data.name || 'Racer', flag);
    this.scene.add(label);

    const initialPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    const initialQuat = new THREE.Quaternion(
      data.quaternion?.x || 0,
      data.quaternion?.y || 0,
      data.quaternion?.z || 0,
      data.quaternion?.w ?? 1
    );

    model.mesh.position.copy(initialPos);
    model.mesh.quaternion.copy(initialQuat);
    label.position.copy(initialPos).add(new THREE.Vector3(0, 2.4, 0));

    this.remotePlayers.set(data.id, {
      id: data.id,
      name: data.name,
      model,
      label,
      livery,
      flag,
      currentPos: initialPos.clone(),
      targetPos: initialPos.clone(),
      currentQuat: initialQuat.clone(),
      targetQuat: initialQuat.clone(),
      speed: data.speed || 0,
      lap: data.lap || 1
    });
  }

  private applyRemoteLivery(id: string, livery: CarColorConfig, flag: string) {
    const remote = this.remotePlayers.get(id);
    if (!remote) return;
    this.scene.remove(remote.model.mesh);
    remote.model.mesh.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
    remote.model = new CarModel(livery);
    remote.livery = livery;
    remote.flag = flag;
    remote.model.mesh.position.copy(remote.currentPos);
    remote.model.mesh.quaternion.copy(remote.currentQuat);
    this.scene.add(remote.model.mesh);
    this.scene.remove(remote.label);
    (remote.label.material.map as THREE.Texture | null)?.dispose();
    remote.label.material.dispose();
    remote.label = this.makeNameSprite(remote.name, flag);
    remote.label.position.copy(remote.currentPos).add(new THREE.Vector3(0, 2.4, 0));
    this.scene.add(remote.label);
  }

  private makeNameSprite(name: string, flag: string = '🏁'): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(6,12,24,0.72)';
    ctx.beginPath();
    const c = ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
    if (c.roundRect) c.roundRect(28, 8, 200, 40, 12);
    else ctx.rect(28, 8, 200, 40);
    ctx.fill();
    ctx.font = 'bold 24px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8f6ff';
    const short = name.length > 10 ? name.slice(0, 10) + '…' : name;
    ctx.fillText(`${flag} ${short}`, 128, 29);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(5.2, 1.3, 1);
    return sprite;
  }

  private updateRemotePlayer(msg: any) {
    const remote = this.remotePlayers.get(msg.id);
    if (!remote) return;

    remote.targetPos.set(msg.position.x, msg.position.y, msg.position.z);
    remote.targetQuat.set(msg.quaternion.x, msg.quaternion.y, msg.quaternion.z, msg.quaternion.w);
    remote.speed = msg.speed;
    remote.lap = msg.lap;
  }

  private disposeRemoteModel(model: CarModel) {
    model.mesh.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
  }

  private removeRemotePlayer(id: string) {
    const remote = this.remotePlayers.get(id);
    if (remote) {
      this.scene.remove(remote.model.mesh);
      this.disposeRemoteModel(remote.model);
      this.scene.remove(remote.label);
      (remote.label.material.map as THREE.Texture | null)?.dispose();
      remote.label.material.dispose();
      this.remotePlayers.delete(id);
    }
  }

  private clearRemotePlayers() {
    for (const remote of this.remotePlayers.values()) {
      this.scene.remove(remote.model.mesh);
      this.disposeRemoteModel(remote.model);
      this.scene.remove(remote.label);
      (remote.label.material.map as THREE.Texture | null)?.dispose();
      remote.label.material.dispose();
    }
    this.remotePlayers.clear();
  }

  public update(delta: number) {
    for (const remote of this.remotePlayers.values()) {
      remote.currentPos.lerp(remote.targetPos, Math.min(1.0, 15.0 * delta));
      remote.model.mesh.position.copy(remote.currentPos);

      remote.currentQuat.slerp(remote.targetQuat, Math.min(1.0, 15.0 * delta));
      remote.model.mesh.quaternion.copy(remote.currentQuat);

      remote.label.position.copy(remote.currentPos).add(new THREE.Vector3(0, 2.4, 0));

      remote.model.updateVisuals(0, remote.speed, delta);
      remote.model.setBrakeLight(false);
    }

    if (this.ws && this.isConnected) {
      this.sendTimer += delta;
      if (this.sendTimer >= this.sendInterval) {
        this.sendTimer = 0;

        const pos = this.playerCar.position;
        const quat = this.playerCar.group.quaternion;

        const payload = {
          type: 'update',
          position: { x: Number(pos.x.toFixed(3)), y: Number(pos.y.toFixed(3)), z: Number(pos.z.toFixed(3)) },
          quaternion: { x: Number(quat.x.toFixed(4)), y: Number(quat.y.toFixed(4)), z: Number(quat.z.toFixed(4)), w: Number(quat.w.toFixed(4)) },
          speed: this.playerCar.speed,
          lap: this.playerCar.currentLap
        };

        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(payload));
        }
      }
    }
  }

  public notifyLapCompleted(lapTime: number) {
    if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'lap_completed',
        lapTime
      }));
    }
  }

  public getRemotePlayerCount(): number {
    return this.remotePlayers.size;
  }

  // Live remote-driver positions for the minimap.
  public getRemoteDots(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const remote of this.remotePlayers.values()) {
      out.push({ x: remote.currentPos.x, z: remote.currentPos.z });
    }
    return out;
  }
}
