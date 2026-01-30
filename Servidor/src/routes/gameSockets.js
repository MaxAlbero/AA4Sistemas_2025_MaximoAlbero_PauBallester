const { ColumnsEngine } = require("../game/columnsEngine");

const io = app.get("io");
const bdd = app.get("bdd");

// Estructura en memoria de partidas
const games = new Map(); // gameId -> { id, title, status: 'WAITING'|'RUNNING'|'ENDED', engine, viewers:Set<socket.id>, createdAt, replayId }
let nextGameId = 1;

// Helpers SQL para replays (usa tablas ya creadas)
function createReplay({ room_id = null, owner_user_id = null, title = null }, cb) {
  bdd.query(
    "INSERT INTO Replays (room_id, owner_user_id, title) VALUES (?, ?, ?);",
    [room_id, owner_user_id, title],
    (err, result) => {
      if (err) return cb(err);
      cb(null, result.insertId);
    }
  );
}
function addReplayEvent(replay_id, seq, type, payloadJson, cb) {
  bdd.query(
    "INSERT INTO ReplayEvents (replay_id, seq, event_type, payload) VALUES (?, ?, ?, ?);",
    [replay_id, seq, type, payloadJson],
    cb
  );
}

function broadcastGameList() {
  const list = Array.from(games.values()).map(g => ({
    id: g.id,
    title: g.title,
    status: g.status,
    createdAt: g.createdAt
  }));
  io.emit("GameList", list);
}

// Socket.IO wiring
io.on("connection", (socket) => {
  // Solicitar lista de partidas en espera/ejecución
  socket.on("GameListRequest", () => {
    const list = Array.from(games.values()).map(g => ({
      id: g.id,
      title: g.title,
      status: g.status,
      createdAt: g.createdAt
    }));
    socket.emit("GameList", list);
  });

  // Crear partida (servidor será el cerebro, el cliente solo visualiza)
  socket.on("GameCreateRequest", (data) => {
    const dataObj = data || {};
        const title = (dataObj.title || "").trim() ||  `Game #${nextGameId}`;
        const sizeX = Number(dataObj.sizeX || 6);
        const sizeY = Number(dataObj.sizeY || 12);
        const tickMs = Number(dataObj.tickMs || 500);

    const id = nextGameId++;
    const engine = new ColumnsEngine({ sizeX, sizeY, tickMs });

    const game = {
      id,
      title,
      status: "WAITING",
      engine,
      viewers: new Set(),
      createdAt: new Date(),
      replayId: null,
    };
    games.set(id, game);

    // Crear replay asociado
    createReplay({ title }, (err, replayId) => {
      if (err) {
        console.error("[Replay] Error creating replay:", err);
      } else {
        game.replayId = replayId;
        // Conectar el recorder del engine
        engine.replay.onRecord = ({ type, payload, seq }) => {
          const payloadJson = JSON.stringify(payload);
          addReplayEvent(replayId, seq, type, payloadJson, (e) => {
            if (e) console.error("[Replay] Error saving event:", e);
          });
        };
      }
    });

    // Eventos del engine -> emitir a espectadores
    engine.onSetup = (setup) => {
      game.viewers.forEach(sid => io.to(sid).emit("setupGrid", JSON.stringify(setup)));
    };
    engine.onUpdate = (update) => {
      game.viewers.forEach(sid => io.to(sid).emit("updateGrid", JSON.stringify(update)));
    };
    engine.onEnd = () => {
      game.status = "ENDED";
      broadcastGameList();
    };

    // Notificar lista actualizada
    broadcastGameList();
    socket.emit("GameCreateResponse", { status: "success", gameId: id });
  });

  // Arrancar partida
  socket.on("GameStartRequest", (data) => {
    const dataObj = data || {};
        const gameId = Number(dataObj.gameId);
        const game = games.get(gameId);
        if (!game)
        return socket.emit("GameStartResponse", {
            status: "error",
            message: "Game not found",
        });

        if (game.status !== "WAITING") {
        return socket.emit("GameStartResponse", {
            status: "error",
            message: "Game already running or ended",
        });
        }
        game.status = "RUNNING";
        game.engine.start();
        broadcastGameList();
        socket.emit("GameStartResponse", { status: "success" });
  });

  // Unirse como espectador
  socket.on("GameJoinViewerRequest", (data) => {
    const dataObj = data || {};
        const gameId = Number(dataObj.gameId);
        const game = games.get(gameId);
        if (!game)
        return socket.emit("GameJoinViewerResponse", {
            status: "error",
            message: "Game not found",
        });

        game.viewers.add(socket.id);

        // Enviar setup inmediato (para engancharse al estado actual)
        const setup = game.engine.getSetupGrid({ playerId: 0, playerName: "P1" });
        socket.emit("setupGrid", JSON.stringify(setup));

        socket.emit("GameJoinViewerResponse", { status: "success", gameId });
  });

// Salir de una partida
  socket.on("GameLeaveViewerRequest", (data) => {
    const dataObj = data || {};
    const gameId = Number(dataObj.gameId);
    const game = games.get(gameId);
    if (!game) return;
    game.viewers.delete(socket.id);
    socket.emit("GameLeaveViewerResponse", { status: "success" });
  });

  // Listar replays
  socket.on("ReplayListRequest", () => {
    bdd.query(
      "SELECT id, title, created_at, ended_at, duration_ms FROM Replays ORDER BY created_at DESC;",
      (err, rows) => {
        if (err) {
          console.error("[Replay] List error:", err);
          return socket.emit("ReplayList", []);
        }
        socket.emit("ReplayList", rows || []);
      }
    );
  });

  // Reproducir un replay (stream de eventos)
  socket.on("ReplayPlayRequest", (data) => {
    const dataObj = data || {};
    const replayId = Number(dataObj.replayId);
    if (!replayId)
      return socket.emit("ReplayPlayError", { message: "Invalid replayId" });

    bdd.query(
      "SELECT seq, event_type, payload FROM ReplayEvents WHERE replay_id = ? ORDER BY seq ASC;",
      [replayId],
      (err, rows) => {
        if (err) {
          console.error("[Replay] Fetch events error:", err);
          return socket.emit("ReplayPlayError", { message: "DB error" });
        }
        // Emitir eventos como si fuera un juego en directo
        rows.forEach((ev) => {
          if (ev.event_type === "GRID_SETUP")
            socket.emit("setupGrid", ev.payload);
          else if (ev.event_type === "GRID_UPDATE")
            socket.emit("updateGrid", ev.payload);
        });
        socket.emit("ReplayPlayDone", { replayId });
      }
    );
  });

  socket.on("disconnect", () => {
    // Limpiar viewers
    games.forEach((g) => g.viewers.delete(socket.id));
  });
});

module.exports = {};