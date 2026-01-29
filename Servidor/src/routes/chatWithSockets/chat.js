const { Router } = require("express");
const router = Router();
const path = require("path");

const io = app.get("io");
const bddConnection = app.get("bdd");
const { NodeGridColumnsServer } = require("../../game/nodeGridColumnsServer");

const PROC = { GET_ROOMS:"GetRooms", CREATE_ROOM:"CreateRoom", GET_ROOM_MESSAGES:"GetRoomMessages", ADD_MESSAGE:"AddMessage" };
const loggedUsers = new Map(); // socket.id -> { id, username }
const roomChannel = (roomId) => `room_${roomId}`;

// roomId -> { status, players:Set<userId>, engines: Map<userId,{engine,started,username}> }
const roomGames = new Map();
function ensureRoom(roomId) {
  let game = roomGames.get(roomId);
  if (game) return game;
  game = { status:"WAITING", players:new Set(), engines:new Map() };
  roomGames.set(roomId, game);
  return game;
}

router.get("/", (req, res) => res.sendFile(path.resolve(__dirname + "/chat.html")));

function emitRoomsToSocket(socket) {
  bddConnection.query("SELECT id, name FROM Rooms ORDER BY id DESC", (err, rows) => {
    if (err) { console.error("Error fetching Rooms:", err); socket.emit("ChatRoomsData", []); return; }
    socket.emit("ChatRoomsData", rows);
  });
}

io.on("connection", (socket) => {
  // Detect viewer
  const q = socket.handshake.query || {};
  socket.data = socket.data || {};
  socket.data.isViewer = (q.viewer === "1");

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
  socket.on("JoinRoomRequest", (arg1, arg2) => {
    let roomId = 0;
    if (typeof arg1 === "number") roomId = arg1;
    else if (typeof arg1 === "string") {
      const n = Number(arg1);
      if (isFinite(n) && n > 0) roomId = n;
      else { try { const o = JSON.parse(arg1); const raw = o && o.roomId; roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw); } catch { roomId = 0; } }
    } else if (Array.isArray(arg1)) {
      const f = arg1[0]; roomId = typeof f === "number" ? f : (isFinite(Number(f)) ? Number(f) : 0);
    } else if (typeof arg1 === "object" && arg1) {
      const raw = arg1.roomId; roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
    }

    if (!roomId || !isFinite(roomId) || roomId <= 0) {
      socket.emit("JoinRoomResponse", { status: "error", message: "roomId is required" });
      return;
    }

    socket.join(roomChannel(roomId));

    const user = loggedUsers.get(socket.id);
    const game = ensureRoom(roomId);
    let role = "spectator";

    // Assign player only if not viewer and logged in
    if (!socket.data.isViewer && user) {
      const userId = user.id;
      if (!game.players.has(userId) && game.players.size < 2) {
        game.players.add(userId);
        role = "player";

        if (!game.engines.has(userId)) {
          const engine = new NodeGridColumnsServer({ tickMs: 500 });
          game.engines.set(userId, { engine, started: false, username: user.username });

          engine.onSetup = (gridSetup) => io.to(roomChannel(roomId)).emit("setupGrid", JSON.stringify(gridSetup));
          engine.onUpdate = (gridUpdate) => io.to(roomChannel(roomId)).emit("updateGrid", JSON.stringify(gridUpdate));

          engine.provideSetup({ playerId: userId, playerName: user.username, sizeX: 6, sizeY: 12 });
        }
      }
    }

    // Start both engines when 2 players present
    if (game.players.size >= 2 && game.status === "WAITING") {
      game.status = "RUNNING";
      game.players.forEach(pid => {
        const rec = game.engines.get(pid);
        if (rec && !rec.started && rec.engine && rec.engine.sizeX > 0) {
          rec.started = true;
          try { rec.engine.start(); } catch (e) { console.error(e); }
        }
      });
    }

    socket.emit("JoinRoomResponse", { status: "success", roomId, role });

    // Send setup + full snapshot to the newly joined socket (players and viewers)
    for (const [pid, rec] of game.engines.entries()) {
      try {
        const setup = { playerId: rec.engine.playerId, playerName: rec.engine.playerName, sizeX: rec.engine.sizeX, sizeY: rec.engine.sizeY };
        socket.emit("setupGrid", JSON.stringify(setup));
        const fullUpdate = rec.engine.getFullUpdate();
        socket.emit("updateGrid", JSON.stringify(fullUpdate));
      } catch (e) {
        console.error("[JoinRoom] emit setup/fullUpdate error:", e);
      }
    }

    // Messages (unchanged)
    bddConnection.query(`CALL ${PROC.GET_ROOM_MESSAGES}(?);`, [roomId], (err, results) => {
      if (err) return;
      const rows = results[0] || [];
      socket.emit("ServerResponseRequestMessageListToClient", rows.map(msg => ({ username: msg.username, text: msg.text, createDate: msg.createDate })));
    });
  });

  // NEW: player keyboard input from web client
  socket.on("GameInput", (payload) => {
  let obj = payload;
    try { if (typeof obj === "string") obj = JSON.parse(obj); } catch { console.warn("[GameInput] JSON inválido"); return; }

    const user = loggedUsers.get(socket.id);
    if (!user) { console.log("[GameInput] ignorado: socket no logeado"); return; }

    const roomId = Number(obj.roomId);
    const action = String(obj.action || "");
    if (!roomId || !action) { console.log("[GameInput] faltan parámetros"); return; }

    const game = roomGames.get(roomId);
    if (!game) { console.log("[GameInput] no hay juego en sala", roomId); return; }

    if (!game.players.has(user.id)) { console.log("[GameInput] usuario", user.id, "no es player en sala", roomId); return; }

    const rec = game.engines.get(user.id);
    if (!rec) { console.log("[GameInput] sin engine para player", user.id); return; }

    const allowed = new Set(["left", "right", "rotate", "softDropStart", "softDropEnd"]);
    if (!allowed.has(action)) { console.log("[GameInput] acción no permitida:", action); return; }

    console.log("[GameInput] user", user.id, "room", roomId, "action", action);
    try { rec.engine.applyInput(action); } catch (e) { console.error("[GameInput] error apply:", e); }
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
    const user = loggedUsers.get(socket.id);
    if (user) {
      // Liberar player y detener motor de su grid
      roomGames.forEach((game, rid) => {
        if (game.players.delete(user.id)) {
          const rec = game.engines.get(user.id);
          if (rec) {
            try { rec.engine.stop(); } catch {}
            game.engines.delete(user.id);
          }
          if (game.players.size < 2 && game.status === "RUNNING") {
            game.status = "WAITING";
          }
        }
      });
      loggedUsers.delete(socket.id);
    }
    console.log("Socket disconnected:", socket.id);
  });
});

module.exports = router;