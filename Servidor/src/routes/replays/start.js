const { Router } = require("express");
const router = Router();
const io = app.get("io");
const bddConnection = app.get("bdd");
const { NodeGridColumnsServer } = require("../../game/nodeGridColumnsServer");

const replayChannel = (replayId) => `replay_${replayId}`;

// Mapa de replays en reproducción: replayId -> { engines: Map<playerId,{engine, timerIds:[]}> }
const activeReplays = new Map();

io.on("connection", (socket) => {
  // Unirse a un canal de replay para visualizar
  socket.on("JoinReplayChannel", (replayId) => {
    socket.join(replayChannel(Number(replayId)));
    socket.emit("JoinReplayResponse", { status:"success", replayId });
  });

  // Iniciar la reproducción de una replay
  socket.on("StartReplayRequest", (replayId) => {
    replayId = Number(replayId);
    if (!replayId) { socket.emit("StartReplayResponse", { status:"error" }); return; }

    // Cargar cabecera y jugadores
    bddConnection.query("SELECT * FROM Replay WHERE id = ?;", [replayId], (err, repRows) => {
      if (err || !repRows || repRows.length === 0) { socket.emit("StartReplayResponse", { status:"error" }); return; }
      const seed = repRows[0].seed;

      bddConnection.query("SELECT * FROM ReplayPlayer WHERE replay_id = ? ORDER BY player_index ASC;", [replayId], (err2, plRows) => {
        if (err2 || !plRows || plRows.length === 0) { socket.emit("StartReplayResponse", { status:"error" }); return; }

        // Crear motores de replay por jugador
        const engines = new Map();
        plRows.forEach(pl => {
          const engine = new NodeGridColumnsServer({ tickMs: 500, seed });
          engine.onSetup = (setup) => io.to(replayChannel(replayId)).emit("setupGrid", JSON.stringify(setup));
          engine.onUpdate = (update) => io.to(replayChannel(replayId)).emit("updateGrid", JSON.stringify(update));
          engine.provideSetup({ playerId: pl.user_id, playerName: pl.username, sizeX: 6, sizeY: 12 });
          engine.start();
          engines.set(pl.user_id, { engine, timerIds: [] });
        });

        // Cargar inputs y programarlos por offset
        bddConnection.query("SELECT * FROM ReplayInput WHERE replay_id = ? ORDER BY seq ASC;", [replayId], (err3, inRows) => {
          if (err3) { socket.emit("StartReplayResponse", { status:"error" }); return; }

          const startAbs = Date.now();
          inRows.forEach(ev => {
            const rec = engines.get(ev.player_id);
            if (!rec) return;
            const delay = Math.max(0, ev.ts_offset_ms);
            const tid = setTimeout(() => {
              try { rec.engine.applyInput(ev.action); } catch (e) { console.error("[Replay] apply error:", e); }
            }, delay);
            rec.timerIds.push(tid);
          });

          activeReplays.set(replayId, { engines });
          socket.emit("StartReplayResponse", { status:"success", replayId });
        });
      });
    });
  });

  socket.on("StopReplayRequest", (replayId) => {
    replayId = Number(replayId);
    const act = activeReplays.get(replayId);
    if (!act) { socket.emit("StopReplayResponse", { status:"error" }); return; }
    act.engines.forEach(({ engine, timerIds }) => {
      try { engine.stop(); } catch {}
      timerIds.forEach(tid => clearTimeout(tid));
    });
    activeReplays.delete(replayId);
    socket.emit("StopReplayResponse", { status:"success" });
  });
});

module.exports = router;