import { useState, useCallback, useEffect, useRef } from "react";
import { supabase, ensureAnonSession, isOnlineConfigured } from "./supabaseClient.js";

// ═══════════════════════════════════════════════
//  SALA ONLINE — sync del log de acciones vía Supabase
//
//  Modelo: el log de acciones de la partida se replica en room_actions.
//  Cada cliente aplica localmente sus acciones al instante (offline-first)
//  y las inserta; Realtime broadcastea los INSERT y los demás las aplican.
//  El dedupe es por `uid` (generado por el cliente que originó la acción).
//  Si falla el insert (sin red), la acción queda en una cola local que se
//  reintenta al reconectar, seguida de un refetch completo para resincronizar.
// ═══════════════════════════════════════════════

const PENDING_KEY = "catan.onlinePending.v1";
const ROOM_KEY = "catan.onlineRoom.v1";

// Código de la última sala activa (para reconectar tras un refresh).
export const loadSavedRoomCode = () => {
  try { return JSON.parse(localStorage.getItem(ROOM_KEY))?.code || null; } catch { return null; }
};
const saveRoomMeta = (room) => {
  try {
    if (!room) localStorage.removeItem(ROOM_KEY);
    else localStorage.setItem(ROOM_KEY, JSON.stringify({ code: room.code }));
  } catch { /* sin storage */ }
};

const loadPending = () => {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; }
};
const savePending = (list) => {
  try {
    if (list.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch { /* sin storage: la cola vive en memoria */ }
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

export function useOnlineRoom({ onRemoteAction, onResync }) {
  // room: null | { roomId, code, isHost }
  const [room, setRoom] = useState(null);
  const [userId, setUserId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [members, setMembers] = useState([]); // [{user_id, player_index, display_name}]
  const [pendingCount, setPendingCount] = useState(0);

  const channelRef = useRef(null);
  const seenUidsRef = useRef(new Set());
  const pendingRef = useRef([]); // [{room_id, author_id, uid, action}]
  const roomRef = useRef(null);
  const flushingRef = useRef(false);

  const markSeen = useCallback((uids) => {
    uids.forEach(u => seenUidsRef.current.add(u));
  }, []);

  const fetchMembers = useCallback(async (roomId) => {
    const { data } = await supabase.from("room_members").select("user_id, player_index, display_name").eq("room_id", roomId);
    if (data) setMembers(data);
  }, []);

  const fetchAllActions = useCallback(async (roomId) => {
    const { data, error } = await supabase
      .from("room_actions")
      .select("uid, action")
      .eq("room_id", roomId)
      .order("id", { ascending: true });
    if (error) throw error;
    return data.map(r => ({ ...r.action, uid: r.uid }));
  }, []);

  // Reintenta la cola pendiente; si había algo, resincroniza el log completo.
  const flushPending = useCallback(async () => {
    if (flushingRef.current || pendingRef.current.length === 0 || !roomRef.current) return;
    flushingRef.current = true;
    try {
      while (pendingRef.current.length > 0) {
        const item = pendingRef.current[0];
        const { error } = await supabase.from("room_actions").insert(item);
        // 23505 = unique violation: ya estaba insertada (reintento duplicado) → descartar
        if (error && error.code !== "23505") throw error;
        pendingRef.current = pendingRef.current.slice(1);
        savePending(pendingRef.current);
        setPendingCount(pendingRef.current.length);
      }
      // Cola vacía: refetch para adoptar el orden canónico del servidor.
      const all = await fetchAllActions(roomRef.current.roomId);
      markSeen(all.map(a => a.uid));
      onResync?.(all);
    } catch { /* seguimos offline: se reintenta en la próxima señal */ }
    flushingRef.current = false;
  }, [fetchAllActions, markSeen, onResync]);

  const subscribe = useCallback((roomId) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel(`room:${roomId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "room_actions", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const { uid, action } = payload.new;
          if (seenUidsRef.current.has(uid)) return;
          seenUidsRef.current.add(uid);
          onRemoteAction?.({ ...action, uid });
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` },
        () => fetchMembers(roomId))
      .subscribe((status) => {
        const ok = status === "SUBSCRIBED";
        setConnected(ok);
        if (ok) flushPending();
      });
    channelRef.current = channel;
  }, [onRemoteAction, fetchMembers, flushPending]);

  // Reintento al recuperar conectividad del navegador.
  useEffect(() => {
    const onOnline = () => flushPending();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushPending]);

  // Crea una sala nueva subiendo el log actual (el host ya empezó la partida).
  const createRoom = useCallback(async (currentActions) => {
    const uid = await ensureAnonSession();
    setUserId(uid);
    const code = genCode();
    const { data: roomRow, error } = await supabase
      .from("rooms").insert({ code, host_id: uid }).select().single();
    if (error) throw error;
    const rows = currentActions.map(a => {
      const { uid: actionUid, ...action } = a;
      return { room_id: roomRow.id, author_id: uid, uid: actionUid, action };
    });
    if (rows.length > 0) {
      const { error: e2 } = await supabase.from("room_actions").insert(rows);
      if (e2) throw e2;
    }
    markSeen(currentActions.map(a => a.uid));
    const r = { roomId: roomRow.id, code, isHost: true };
    roomRef.current = r;
    setRoom(r);
    saveRoomMeta(r);
    subscribe(roomRow.id);
    fetchMembers(roomRow.id);
    return r;
  }, [subscribe, fetchMembers, markSeen]);

  // Se une a una sala existente; devuelve el log completo para replayar.
  const joinRoom = useCallback(async (codeInput) => {
    const uid = await ensureAnonSession();
    setUserId(uid);
    const code = codeInput.trim().toUpperCase();
    const { data: roomRow, error } = await supabase
      .from("rooms").select().eq("code", code).maybeSingle();
    if (error) throw error;
    if (!roomRow) throw new Error("Sala no encontrada. Revisá el código.");
    const all = await fetchAllActions(roomRow.id);
    markSeen(all.map(a => a.uid));
    const r = { roomId: roomRow.id, code, isHost: roomRow.host_id === uid };
    roomRef.current = r;
    setRoom(r);
    saveRoomMeta(r);
    subscribe(roomRow.id);
    fetchMembers(roomRow.id);
    return { room: r, actions: all };
  }, [subscribe, fetchMembers, fetchAllActions, markSeen]);

  // Publica una acción local (ya aplicada). Si falla, va a la cola.
  const pushAction = useCallback((stamped) => {
    const r = roomRef.current;
    if (!r) return;
    seenUidsRef.current.add(stamped.uid);
    const { uid: actionUid, ...action } = stamped;
    const row = { room_id: r.roomId, author_id: userId, uid: actionUid, action };
    supabase.from("room_actions").insert(row).then(({ error }) => {
      if (error && error.code !== "23505") {
        pendingRef.current = [...pendingRef.current, row];
        savePending(pendingRef.current);
        setPendingCount(pendingRef.current.length);
      }
    });
  }, [userId]);

  // Reclama (o libera) el control de un jugador.
  const claimPlayer = useCallback(async (playerIndex, displayName) => {
    const r = roomRef.current;
    if (!r || !userId) return;
    await supabase.from("room_members").upsert({
      room_id: r.roomId, user_id: userId,
      player_index: playerIndex, display_name: displayName || null,
    });
    fetchMembers(r.roomId);
  }, [userId, fetchMembers]);

  const leaveRoom = useCallback(() => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = null;
    roomRef.current = null;
    seenUidsRef.current = new Set();
    pendingRef.current = [];
    savePending([]);
    setPendingCount(0);
    setRoom(null);
    saveRoomMeta(null);
    setMembers([]);
    setConnected(false);
  }, []);

  // Carga la cola pendiente guardada (tras un refresh estando offline).
  useEffect(() => {
    pendingRef.current = loadPending();
    setPendingCount(pendingRef.current.length);
  }, []);

  const myPlayerIndex = members.find(m => m.user_id === userId)?.player_index ?? null;

  return {
    isConfigured: isOnlineConfigured,
    room, connected, members, userId, myPlayerIndex, pendingCount,
    createRoom, joinRoom, pushAction, claimPlayer, leaveRoom,
  };
}
