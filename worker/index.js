// Chess Relay Worker
// Pure signaling mailbox for a WebRTC handshake, keyed by a short room code.
// Uses non-trickle ICE — each side gathers all its ICE candidates locally
// before sending its offer/answer, so the SDP already contains everything
// needed and there's no separate candidate-by-candidate exchange to manage.
// Once the peer connection is up, chess moves travel directly between the
// two browsers — this worker and D1 never see any game state.

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid mixups
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    const url = new URL(req.url);
    const path = url.pathname;

    // POST /api/create  { offer }  -> { code }
    if (path === '/api/create' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (!body.offer) return json({ error: 'missing offer' }, 400);

      // opportunistic cleanup of stale rooms (older than 24h)
      await env.DB.prepare('DELETE FROM games WHERE created_at < ?')
        .bind(Date.now() - 86400000).run();

      let code = randomCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await env.DB.prepare('SELECT code FROM games WHERE code = ?').bind(code).first();
        if (!existing) break;
        code = randomCode();
      }

      const now = Date.now();
      await env.DB.prepare(
        'INSERT INTO games (code, host_offer, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(code, JSON.stringify(body.offer), 'waiting', now, now).run();

      return json({ code });
    }

    // GET /api/game/:code -> { status, offer, answer }
    const gameMatch = path.match(/^\/api\/game\/([A-Z0-9]{6})$/);
    if (gameMatch && req.method === 'GET') {
      const code = gameMatch[1];
      const row = await env.DB.prepare('SELECT * FROM games WHERE code = ?').bind(code).first();
      if (!row) return json({ error: 'not found' }, 404);
      return json({
        status: row.status,
        offer: JSON.parse(row.host_offer),
        answer: row.guest_answer ? JSON.parse(row.guest_answer) : null,
      });
    }

    // POST /api/join/:code  { answer }
    const joinMatch = path.match(/^\/api\/join\/([A-Z0-9]{6})$/);
    if (joinMatch && req.method === 'POST') {
      const code = joinMatch[1];
      const body = await req.json().catch(() => ({}));
      if (!body.answer) return json({ error: 'missing answer' }, 400);

      const row = await env.DB.prepare('SELECT guest_answer FROM games WHERE code = ?').bind(code).first();
      if (!row) return json({ error: 'not found' }, 404);
      if (row.guest_answer) return json({ error: 'room already full' }, 409);

      await env.DB.prepare('UPDATE games SET guest_answer = ?, status = ?, updated_at = ? WHERE code = ?')
        .bind(JSON.stringify(body.answer), 'answered', Date.now(), code).run();
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  },
};
