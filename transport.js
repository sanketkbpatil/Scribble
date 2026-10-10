// Transport abstraction: Supabase Realtime (broadcast + presence) or a local BroadcastChannel fallback.
// API: connect(room, me, { onMessage(event, payload), onPresence(players[]) }) -> { send(event, payload), leave() }

export async function connect(room, me, handlers) {
  const cfg = window.SCRIBBLE_CONFIG || {};
  if (cfg.supabaseUrl && cfg.supabaseKey) return connectSupabase(cfg, room, me, handlers);
  return connectLocal(room, me, handlers);
}

export function mode() {
  const cfg = window.SCRIBBLE_CONFIG || {};
  return cfg.supabaseUrl && cfg.supabaseKey ? 'online' : 'local';
}

async function connectSupabase(cfg, room, me, { onMessage, onPresence }) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const client = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    realtime: { params: { eventsPerSecond: 40 } },
  });
  const channel = client.channel(`doodle:${room}`, {
    config: { broadcast: { self: false, ack: false }, presence: { key: me.id } },
  });

  channel.on('broadcast', { event: 'm' }, ({ payload }) => onMessage(payload.e, payload.p));
  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    const list = [];
    for (const key of Object.keys(state)) {
      const metas = state[key];
      if (metas && metas.length) list.push({ id: key, name: metas[0].name, joinedAt: metas[0].joinedAt });
    }
    onPresence(list);
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timed out connecting to the game server')), 12000);
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(t);
        await channel.track({ name: me.name, joinedAt: me.joinedAt });
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(t);
        reject(new Error('Could not connect to the game server (' + status + ')'));
      }
    });
  });

  return {
    send(e, p) { channel.send({ type: 'broadcast', event: 'm', payload: { e, p } }); },
    leave() { channel.untrack(); client.removeChannel(channel); },
  };
}

function connectLocal(room, me, { onMessage, onPresence }) {
  const bc = new BroadcastChannel(`doodle:${room}`);
  const peers = new Map(); // id -> {id,name,joinedAt,seen}
  const self = { id: me.id, name: me.name, joinedAt: me.joinedAt };
  const emitPresence = () => onPresence([self, ...[...peers.values()].map(({ seen, ...p }) => p)]);

  bc.onmessage = ({ data }) => {
    if (data.t === 'hb') {
      const isNew = !peers.has(data.p.id);
      peers.set(data.p.id, { ...data.p, seen: Date.now() });
      if (isNew) { emitPresence(); bc.postMessage({ t: 'hb', p: self }); }
    } else if (data.t === 'bye') {
      peers.delete(data.id); emitPresence();
    } else if (data.t === 'm') {
      onMessage(data.e, data.p);
    }
  };
  const hb = setInterval(() => {
    bc.postMessage({ t: 'hb', p: self });
    let changed = false;
    for (const [id, p] of peers) if (Date.now() - p.seen > 5000) { peers.delete(id); changed = true; }
    if (changed) emitPresence();
  }, 1500);
  bc.postMessage({ t: 'hb', p: self });
  window.addEventListener('beforeunload', () => bc.postMessage({ t: 'bye', id: self.id }));
  setTimeout(emitPresence, 0);

  return Promise.resolve({
    send(e, p) { bc.postMessage({ t: 'm', e, p }); },
    leave() { clearInterval(hb); bc.postMessage({ t: 'bye', id: self.id }); bc.close(); },
  });
}
