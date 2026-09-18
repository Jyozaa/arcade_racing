/**
 * Cloudflare Worker entry point.
 *
 * One origin serves everything:
 *   https://<domain>/            -> the built Vite game (static assets)
 *   https://<domain>/health      -> JSON health check
 *   wss://<domain>/ws/:roomId    -> multiplayer, routed to a RaceRoom
 *                                   Durable Object named by :roomId
 *                                   (Open Track uses `/ws/public`).
 */
import { RaceRoom } from './RaceRoom';
import { sanitizeRoomId } from './protocol';

export { RaceRoom };

interface Env {
  RACE_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'arcade-racing' });
    }

    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const roomId = sanitizeRoomId(url.pathname.slice('/ws'.length).replace(/^\//, ''));
      const stub = env.RACE_ROOM.get(env.RACE_ROOM.idFromName(roomId));
      return stub.fetch(request);
    }

    // Everything else is the built Vite app (./dist via `assets` config,
    // with single-page-application fallback for extensionless routes).
    return env.ASSETS.fetch(request);
  },
};
