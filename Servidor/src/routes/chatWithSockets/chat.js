const { Router } = require("express");
const router = Router();
const path = require("path");

const io = app.get("io");
const bddConnection = app.get("bdd");
const { NodeGridColumnsServer } = require("../../game/nodeGridColumnsServer");

const PROC = {
  GET_ROOMS:"GetRooms",
  CREATE_ROOM:"CreateRoom",
  GET_ROOM_MESSAGES:"GetRoomMessages",
  ADD_MESSAGE:"AddMessage",
  CREATE_REPLAY:"CreateReplay",
  ADD_REPLAY_PLAYER:"AddReplayPlayer",
  ADD_REPLAY_INPUT:"AddReplayInput",
  LIST_REPLAYS_FOR_ROOM: "ListReplaysForRoom"
};

const loggedUsers = new Map();
const roomChannel = (roomId) => `room_${roomId}`;

// roomId -> { status, players:Set<userId>, engines: Map<userId,{engine,started,username}>, replay?: { id, seed, startMs, seq } }
// Dentro del mapa de salas:
const roomGames = new Map(); // roomId -> { status, players:Set<userId>, engines: Map<userId,{engine,started,username}>, replay?: { id, seed, startMs, seq }, viewerCount: 0 }

function ensureRoom(roomId) {
  let game = roomGames.get(roomId);
  if (game) return game;
  game = { status:"WAITING", players:new Set(), engines:new Map(), replay:null, viewerCount: 0 };
  roomGames.set(roomId, game);
  return game;
}

router.get("/", (req, res) => res.sendFile(path.resolve(__dirname + "/chat.html")));

function emitRoomsToSocket(socket) {
  bddConnection.query("SELECT id, name FROM Rooms ORDER BY id ASC", (err, rows) => {
    if (err) { console.error("Error fetching Rooms:", err); socket.emit("ChatRoomsData", []); return; }
    socket.emit("ChatRoomsData", rows);
  });
}

function parseIdFlexible(a, b) {
  function norm(x) {
    if (typeof x === "number") return x;
    if (typeof x === "string") {
      const n = Number(x);
      return isFinite(n) ? n : 0;
    }
    if (Array.isArray(x) && x.length > 0) return norm(x[0]);
    if (x && typeof x === "object") {
      // intenta con replayId o id
      if (typeof x.replayId !== "undefined") return norm(x.replayId);
      if (typeof x.id !== "undefined") return norm(x.id);
    }
    return 0;
  }
  const r1 = norm(a);
  if (r1) return r1;
  const r2 = norm(b);
  return r2 || 0;
}

// Helper: emitir mensaje de sistema a la sala y (opcional) guardarlo en BD
function sendSystemChat(roomId, text, type) {
  const payload = { roomId: roomId, text: String(text || ""), type: String(type || "system"), ts: Date.now() };
  // Emitir al canal de la sala (web clients deben escucharlo)
  io.to(`room_${roomId}`).emit("RoomSystemMessage", JSON.stringify(payload));

  // Opcional: guardar en BD si tienes SP ADD_MESSAGE (ajusta a tu esquema real)
  try {
    if (typeof PROC !== "undefined" && PROC.ADD_MESSAGE) {
      // Ejemplo: CALL AddMessage(roomId, userId, username, message, type)
      // Si tu SP pide campos distintos, ajusta aquí.
      bddConnection.query(
        `CALL ${PROC.ADD_MESSAGE}(?, ?, ?, ?, ?);`,
        [roomId, null, "SYSTEM", payload.text, payload.type],
        function onMsgInsert(err) {
          if (err) console.error("[SystemChat] DB insert error:", err);
        }
      );
    }
  } catch (e) {
    console.error("[SystemChat] emit/store error:", e);
  }
}

io.on("connection", (socket) => {
  const q = socket.handshake && socket.handshake.query ? socket.handshake.query : {};
  socket.data = socket.data || {};
  socket.data.isViewer = (q.viewer === "1"); // Unity cliente usa viewer=1
  socket.data.currentRoomId = 0;

  // LOGIN: admite 2 args (user, pass) o objeto/array
  socket.on("LoginRequest", (arg1, arg2) => {
    let username = "";
    let password = "";

    if (typeof arg1 === "string" && typeof arg2 === "string") {
      username = arg1.trim();
      password = arg2.trim();
    } else {
      let dataObj = arg1;
      try {
        if (typeof dataObj === "string") dataObj = JSON.parse(dataObj);
        if (Array.isArray(dataObj)) dataObj = dataObj[0] || {};
      } catch {
        dataObj = {};
      }
      if (dataObj) {
        if (Array.isArray(dataObj.username)) username = String((dataObj.username[0] || "").trim());
        else if (typeof dataObj.username === "string") username = dataObj.username.trim();
        if (Array.isArray(dataObj.password)) password = String((dataObj.password[0] || "").trim());
        else if (typeof dataObj.password === "string") password = dataObj.password.trim();
      }
    }

    const loginResponseData = {};
    if (!username || !password) {
      loginResponseData.status = "error";
      loginResponseData.message = "User or password is blank";
      socket.emit("LoginResponse", loginResponseData);
      return;
    }

    bddConnection.query(
      "SELECT id, username FROM Users WHERE username = ? AND password = ?;",
      [username, password],
      (err, result) => {
        if (err) {
          console.log(err);
          loginResponseData.status = "error";
          socket.emit("LoginResponse", loginResponseData);
          return;
        }

        if (!result || result.length <= 0) {
          loginResponseData.status = "error";
          loginResponseData.message = "User or password Incorrect";
          socket.emit("LoginResponse", loginResponseData);
          return;
        }

        const user = { id: result[0].id, username: result[0].username };
        loggedUsers.set(socket.id, user);

        loginResponseData.status = "success";
        loginResponseData.id = user.id;
        loginResponseData.username = user.username;
        socket.emit("LoginResponse", loginResponseData);

        emitRoomsToSocket(socket);
      }
    );
  });

  // CREAR SALA (igual que antes)
  socket.on("CreateRoomRequest", (data) => {
    const user = loggedUsers.get(socket.id);
    if (!user) {
      socket.emit("CreateRoomResponse", {
        status: "error",
        message: "Not authenticated",
      });
      return;
    }

    const { name } = data || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      socket.emit("CreateRoomResponse", {
        status: "error",
        message: "Room name is required",
      });
      return;
    }

    bddConnection.query(
      `CALL ${PROC.CREATE_ROOM}(?);`,
      [name.trim()],
      (err) => {
        if (err) {
          console.error("Error calling CreateRoom:", err);
          socket.emit("CreateRoomResponse", {
            status: "error",
            message: "DB error creating room",
          });
          return;
        }

        socket.emit("CreateRoomResponse", { status: "success" });
        io.sockets.sockets.forEach(s => emitRoomsToSocket(s));
      }
    );
  });

  // JOIN room: only logged web users become players; viewers are spectators
  socket.on("JoinRoomRequest", function (arg1, arg2) {
    var roomId = 0;

      function normId(x) {
        if (x === null || x === undefined) return 0;
        if (typeof x === "number") return x;
        if (typeof x === "string") {
          var n = Number(x);
          return isFinite(n) ? n : 0;
        }
        if (Array.isArray(x) && x.length > 0) {
          return normId(x[0]);
        }
        if (typeof x === "object") {
          if (typeof x.roomId !== "undefined") return normId(x.roomId);
          if (typeof x.id !== "undefined") return normId(x.id);
        }
        return 0;
      }

      roomId = normId(arg1);
      if (!roomId) roomId = normId(arg2);

    socket.join(roomChannel(roomId));
    const user = loggedUsers.get(socket.id);
    const game = ensureRoom(roomId);
      socket.join(`room_${roomId}`);
      socket.data.currentRoomId = roomId;

    // Si es viewer (Unity), incrementar y reanudar si estaba pausado
    if (socket.data.isViewer) {
      const prev = game.viewerCount || 0;
      game.viewerCount = prev + 1;
      if (prev === 0 && (game.status === "RUNNING" || game.status === "PAUSED")) {
        // Reanudar motores
        for (const [, rec] of game.engines.entries()) {
          if (rec && rec.engine) { try { rec.engine.resume(); } catch (e) { console.error("[Resume] error:", e); } }
        }
        game.status = "RUNNING";
        // Notificaciones
        io.to(`room_${roomId}`).emit("RoomResumed", JSON.stringify({ roomId: roomId, reason: "Unity viewer connected" }));
        sendSystemChat(roomId, "La partida se ha reanudado: hay un visualizador de Unity conectado.", "resumed");
      }
    }

    if (!socket.data.isViewer && user) {
      const userId = user.id;
      if (!game.players.has(userId) && game.players.size < 2) {
        game.players.add(userId);
        role = "player";

        // Crear engine del player con semilla (si ya existe replay, usar su seed; si no, se asignará al arrancar)
        const seed = (game.replay && game.replay.seed) || Math.random().toString(16).slice(2);
        if (!game.engines.has(userId)) {
          const engine = new NodeGridColumnsServer({ tickMs: 500, seed });
          game.engines.set(userId, { engine, started:false, username:user.username });
          engine.onSetup  = (setup)  => io.to(roomChannel(roomId)).emit("setupGrid", JSON.stringify(setup));
          engine.onUpdate = (update) => io.to(roomChannel(roomId)).emit("updateGrid", JSON.stringify(update));
          engine.provideSetup({ playerId: userId, playerName: user.username, sizeX: 6, sizeY: 12 });
        }
      }
    }

    // Arrancar y crear Replay cuando hay 2 players
    if (game.players.size >= 2 && game.status === "WAITING") {
      game.status = "RUNNING";

      // Semilla compartida para la partida (todos los engines usarán la misma)
      const sharedSeed = Math.random().toString(16).slice(2);
      // Actualizar semilla en engines ya creados
      game.players.forEach(pid => {
        const rec = game.engines.get(pid);
        if (rec && rec.engine) {
          rec.engine.seed = sharedSeed;
          rec.engine._rng = rec.engine._mulberry32(rec.engine._hashSeed(sharedSeed));
        }
      });

      // Crear Replay en BD
      bddConnection.query(`CALL ${PROC.CREATE_REPLAY}(?, ?);`, [roomId, sharedSeed], (err, result) => {
        if (err) { console.error("[Replay] Create error:", err); }
        const replay_id = (result && result[0] && result[0][0] && result[0][0].replay_id) || null;
        if (replay_id) {
          // Guardar jugadores 0/1
          let idx = 0;
          game.players.forEach(pid => {
            const rec = game.engines.get(pid);
            bddConnection.query(
              `CALL ${PROC.ADD_REPLAY_PLAYER}(?, ?, ?, ?);`,
              [replay_id, pid, idx, (rec && rec.username) ? rec.username : `P${idx + 1}`],
              () => {}
            );
            idx++;
          });
          // Registrar estado de replay en memoria
          game.replay = { id: replay_id, seed: sharedSeed, startMs: Date.now(), seq: 0 };
        }
      });

      // Arrancar motores
      game.players.forEach(pid => {
        const rec = game.engines.get(pid);
        if (rec && !rec.started && rec.engine && rec.engine.sizeX > 0) {
          rec.started = true;
          try { rec.engine.start(); } catch (e) { console.error(e); }
        }
      });
    }

    socket.join("room_" + String(roomId));
    socket.emit("JoinRoomResponse", { status: "success", roomId, role: socket.data.isViewer ? "spectator" : "player" });

    // Re-emitir setup + snapshot al que se acaba de unir (players y viewers)
    for (const [, rec] of game.engines.entries()) {
      try {
        const setup = { playerId: rec.engine.playerId, playerName: rec.engine.playerName, sizeX: rec.engine.sizeX, sizeY: rec.engine.sizeY };
        socket.emit("setupGrid", JSON.stringify(setup));
        socket.emit("updateGrid", JSON.stringify(rec.engine.getFullUpdate()));
      } catch (e) { console.error("[JoinRoom] emit setup/fullUpdate error:", e); }
    }

    // Messages (unchanged)
    bddConnection.query(`CALL ${PROC.GET_ROOM_MESSAGES}(?);`, [roomId], (err, results) => {
      if (err) return;
      const rows = results[0] || [];
      socket.emit("ServerResponseRequestMessageListToClient", rows.map(msg => ({ username: msg.username, text: msg.text, createDate: msg.createDate })));
    });
  });

  // Inputs de jugador: aplicar y guardar en replay
  socket.on("GameInput", (payload) => {
    let obj = payload;
    try { if (typeof obj === "string") obj = JSON.parse(obj); } catch { return; }
    const user = loggedUsers.get(socket.id);
    if (!user) return;

    const roomId = Number(obj.roomId);
    const action = String(obj.action || "");
    if (!roomId || !action) return;

    const game = roomGames.get(roomId);
    if (!game) return;
    if (!game.players.has(user.id)) return;

    const rec = game.engines.get(user.id);
    if (!rec) return;

    const allowed = new Set(["left", "right", "rotate", "softDropStart", "softDropEnd"]);
    if (!allowed.has(action)) return;

    try { rec.engine.applyInput(action); } catch (e) { console.error("[GameInput] apply error:", e); }

    // Guardar input en BD con orden y offset temporal
    if (game.replay && game.replay.id) {
      const seq = ++game.replay.seq;
      const offset = Date.now() - game.replay.startMs;
      bddConnection.query(
        `CALL ${PROC.ADD_REPLAY_INPUT}(?, ?, ?, ?, ?);`,
        [game.replay.id, seq, user.id, action, offset],
        (err) => { if (err) console.error("[Replay] Add input error:", err); }
      );
    }
  });

  // ENVIAR MENSAJE (igual)  
  socket.on("ClientMessageToServer", (messageData) => {
    const user = loggedUsers.get(socket.id);
    if (!user) {
      socket.emit("ServerMessageToClient", {
        status: "error",
        message: "Not authenticated",
      });
      return;
    }

    const { roomId, content } = messageData || {};
    if (!roomId || !content || typeof content !== "string") {
      socket.emit("ServerMessageToClient", {
        status: "error",
        message: "roomId and content are required",
      });
      return;
    }

    bddConnection.query(
      `CALL ${PROC.ADD_MESSAGE}(?, ?, ?);`,
      [roomId, user.id, content],
      (err) => {
        if (err) {
          console.error("Error calling AddMessage:", err);
          socket.emit("ServerMessageToClient", {
            status: "error",
            message: "DB error inserting message",
          });
          return;
        }

        const messageToSend = {
          username: user.username,
          text: content,
          created_at: new Date(),
          room_id: roomId
        };

        io.to(roomChannel(roomId)).emit("ServerMessageToClient", messageToSend);
      }
    );
  });

  // LOGOUT y desconexión: liberar huecos y parar motores de ese player
  socket.on("LogoutRequest", () => {
    const user = loggedUsers.get(socket.id);
    if (user) {
      loggedUsers.delete(socket.id);
    }
    socket.emit("LogoutResponse", { status: "success" });
  });

  emitRoomsToSocket(socket);

  socket.on("disconnect", () => {
    const roomId = socket.data.currentRoomId || 0;
    if (!roomId) return;
    const game = roomGames.get(roomId);
    if (game && socket.data.isViewer) {
      const next = Math.max(0, (game.viewerCount || 0) - 1);
      game.viewerCount = next;
      if (next === 0 && game.status === "RUNNING") {
        for (const [, rec] of game.engines.entries()) {
          if (rec && rec.engine) { try { rec.engine.pause(); } catch {} }
        }
        game.status = "PAUSED";
        io.to(`room_${roomId}`).emit("RoomPaused", JSON.stringify({ roomId, reason: "No Unity viewers" }));
      }
    }
  });

    function parseRoomIdFlexible(a, b) {
      function norm(x) {
        if (typeof x === "number") return x;
        if (typeof x === "string") {
          const n = Number(x);
          return isFinite(n) ? n : 0;
        }
        if (Array.isArray(x) && x.length > 0) return norm(x[0]);
        if (x && typeof x === "object") {
          if (typeof x.roomId !== "undefined") return norm(x.roomId);
          if (typeof x.id !== "undefined") return norm(x.id);
        }
        return 0;
      }
      const r1 = norm(a);
      if (r1) return r1;
      const r2 = norm(b);
      return r2 || 0;
    }

    socket.on("ListReplaysRequest", (arg1, arg2) => {
      const roomId = parseRoomIdFlexible(arg1, arg2);

      if (!roomId || !isFinite(roomId) || roomId <= 0) {
        console.log("[ListReplaysRequest] payload inválido:", arg1, arg2);
        socket.emit("ListReplaysResponse", { status: "error", message: "roomId inválido", data: [] });
        return;
      }

      bddConnection.query(
        `CALL ${PROC.LIST_REPLAYS_FOR_ROOM}(?);`,
        [roomId],
        function (err, results) {
          if (err) {
            console.error("[ListReplays] DB error:", err);
            socket.emit("ListReplaysResponse", { status: "error", message: "DB error", data: [] });
            return;
          }
          var rows = (results && results[0]) ? results[0] : [];
          var data = rows.map(function (r) {
            return {
              id: r.id,
              created_at: r.created_at,
              status: r.status,
              seed: r.seed,
              players: r.players || ""
            };
          });
          socket.emit("ListReplaysResponse", JSON.stringify({ status: "success", roomId: roomId, data: data }));
          // socket.emit("ListReplaysResponse", { status: "success", roomId: roomId, data: data });
        }
      );
    });

    // Unirse a canal de replay (visualización)
    socket.on("JoinReplayChannel", function (arg1, arg2) {
      const replayId = parseIdFlexible(arg1, arg2);
      if (!replayId || !isFinite(replayId)) {
        console.log("[JoinReplayChannel] payload inválido:", arg1, arg2);
        socket.emit("JoinReplayResponse", { status: "error", message: "replayId inválido" });
        return;
      }
      socket.join("replay_" + replayId);
      socket.emit("JoinReplayResponse", { status: "success", replayId: replayId });
    });

    // Iniciar reproducción (si no lo tenías ya)
    socket.on("StartReplayRequest", function (arg1, arg2) {
      const replayId = parseIdFlexible(arg1, arg2);
      if (!replayId || !isFinite(replayId)) {
        console.log("[StartReplayRequest] payload inválido:", arg1, arg2);
        socket.emit("StartReplayResponse", { status: "error", message: "replayId inválido" });
        return;
      }

      // Cargar cabecera y jugadores
      bddConnection.query("SELECT * FROM Replay WHERE id = ?;", [replayId], (err, repRows) => {
        if (err || !repRows || repRows.length === 0) {
          socket.emit("StartReplayResponse", { status: "error", message: "Replay no encontrada" });
          return;
        }
        const seed = repRows[0].seed;

        bddConnection.query("SELECT * FROM ReplayPlayer WHERE replay_id = ? ORDER BY player_index ASC;", [replayId], (err2, plRows) => {
          if (err2 || !plRows || plRows.length === 0) {
            socket.emit("StartReplayResponse", { status: "error", message: "Jugadores no encontrados" });
            return;
          }

          // Crear motores por jugador
          const engines = new Map();
          plRows.forEach(pl => {
            const engine = new NodeGridColumnsServer({ tickMs: 500, seed });
            engine.onSetup = (setup) => io.to(`replay_${replayId}`).emit("setupGrid", JSON.stringify(setup));
            engine.onUpdate = (update) => io.to(`replay_${replayId}`).emit("updateGrid", JSON.stringify(update));
            engine.provideSetup({ playerId: pl.user_id, playerName: pl.username, sizeX: 6, sizeY: 12 });
            engine.start();
            engines.set(pl.user_id, { engine, timers: [] });
          });

          // Cargar inputs y dispararlos por offset
          bddConnection.query("SELECT * FROM ReplayInput WHERE replay_id = ? ORDER BY seq ASC;", [replayId], (err3, inRows) => {
            if (err3) {
              socket.emit("StartReplayResponse", { status: "error", message: "Error cargando inputs" });
              return;
            }
            inRows.forEach(ev => {
              const rec = engines.get(ev.player_id);
              if (!rec) return;
              const tid = setTimeout(() => {
                try { rec.engine.applyInput(ev.action); } catch (e) { console.error("[Replay] apply error:", e); }
              }, Math.max(0, ev.ts_offset_ms));
              rec.timers.push(tid);
            });

            // Opcional: guarda engines en memoria si quieres detener luego


            socket.emit("StartReplayResponse", { status: "success", replayId: replayId });
          });
        });
      });
    });

    function roomChannel(roomId) { return "room_" + String(roomId); }

    // Listar salas bajo demanda
    socket.on("GetRoomsRequest", function () {
      console.log("[GetRoomsRequest] from", socket.id);
      bddConnection.query(
        "SELECT id, name FROM Rooms ORDER BY id ASC",
        function (err, rows) {
          if (err) {
            console.error("[GetRoomsRequest] DB error:", err);
            socket.emit("ChatRoomsData", JSON.stringify([]));
            return;
          }
          const payload = JSON.stringify(rows || []);
          console.log("[GetRoomsRequest] Emitting ChatRoomsData:", payload);
          socket.emit("ChatRoomsData", payload);
        }
      );
    });

    // Salir de sala
    socket.on("LeaveRoomRequest", (arg1) => {
        let roomId = 0;
        if (typeof arg1 === "number") roomId = arg1;
        else if (typeof arg1 === "string") { const n = Number(arg1); roomId = isFinite(n) ? n : 0; }
        if (!roomId || !isFinite(roomId) || roomId <= 0) {
          socket.emit("LeaveRoomResponse", { status: "error", message: "roomId inválido" });
          return;
        }
        const game = roomGames.get(roomId);
        try { socket.leave(`room_${roomId}`); } catch {}
        if (socket.data.currentRoomId === roomId) socket.data.currentRoomId = 0;

        // Si es viewer (Unity), decrementar y pausar si llega a 0
        if (game && socket.data.isViewer) {
          const next = Math.max(0, (game.viewerCount || 0) - 1);
          game.viewerCount = next;
          if (next === 0 && game.status === "RUNNING") {
            for (const [, rec] of game.engines.entries()) {
              if (rec && rec.engine) { try { rec.engine.pause(); } catch (e) { console.error("[Pause] error:", e); } }
            }
            game.status = "PAUSED";
            // Notificaciones
            io.to(`room_${roomId}`).emit("RoomPaused", JSON.stringify({ roomId: roomId, reason: "No Unity viewers" }));
            sendSystemChat(roomId, "La partida se ha pausado: no hay ningún visualizador de Unity conectado.", "paused");
          }
        }

        socket.emit("LeaveRoomResponse", { status: "success", roomId: roomId });
      });
});

module.exports = router;