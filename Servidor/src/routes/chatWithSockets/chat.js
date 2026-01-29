const { Router } = require("express");
const router = Router();
const path = require("path");

const io = app.get("io");
const bddConnection = app.get("bdd");
const { NodeGridColumnsServer } = require("../../game/nodeGridColumnsServer"); // [ADD]

// Nombres de los procedures
const PROC = {
  GET_ROOMS: "GetRooms",
  CREATE_ROOM: "CreateRoom",
  GET_ROOM_MESSAGES: "GetRoomMessages",
  ADD_MESSAGE: "AddMessage"
};

const loggedUsers = new Map();
const roomChannel = (roomId) => `room_${roomId}`;

// Estado por sala: engines por jugador
// roomId -> { status:'WAITING'|'RUNNING'|'ENDED', players:Set<socketId>, engines: Map<playerKey,{engine,started}> }
const roomGames = new Map();

function ensureRoom(roomId) {
  let game = roomGames.get(roomId);
  if (game) return game;
  game = {
    status: "WAITING",
    players: new Set(),
    engines: new Map()
  };
  roomGames.set(roomId, game);
  return game;
}

router.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname + "/chat.html"));
});

function emitRoomsToSocket(socket) {
  bddConnection.query(
    "SELECT id, name FROM Rooms ORDER BY id DESC",
    (err, rows) => {
      if (err) {
        console.error("Error fetching Rooms:", err);
        socket.emit("ChatRoomsData", []);
        return;
      }
      socket.emit("ChatRoomsData", rows);
    }
  );
}

io.on("connection", (socket) => {
  const address = socket.request.connection;
  console.log(
    "Socket connected with ip:port --> " +
      address.remoteAddress +
      ":" +
      address.remotePort
  );

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
        if (Array.isArray(dataObj.username)) {
          username = String((dataObj.username[0] || "").trim());
        } else if (typeof dataObj.username === "string") {
          username = dataObj.username.trim();
        }
        if (Array.isArray(dataObj.password)) {
          password = String((dataObj.password[0] || "").trim());
        } else if (typeof dataObj.password === "string") {
          password = dataObj.password.trim();
        }
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

  // CREAR SALA
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
  
  // Unirse a sala: asignación de roles por socket.id (primeros 2 -> player)
  socket.on("JoinRoomRequest", (arg1, arg2) => {
    let roomId = 0;
    if (typeof arg1 === "number") roomId = arg1;
    else if (typeof arg1 === "string") {
      const n = Number(arg1);
      if (isFinite(n) && n > 0) roomId = n;
      else {
        try {
          const o = JSON.parse(arg1);
          const raw = o && o.roomId;
          roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
        } catch { roomId = 0; }
      }
    } else if (Array.isArray(arg1)) {
      const f = arg1[0];
      roomId = typeof f === "number" ? f : (isFinite(Number(f)) ? Number(f) : 0);
    } else if (typeof arg1 === "object" && arg1) {
      const raw = arg1.roomId;
      roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
    }

    if (!roomId || !isFinite(roomId) || roomId <= 0) {
      socket.emit("JoinRoomResponse", { status: "error", message: "roomId is required" });
      return;
    }

    socket.join(roomChannel(roomId));

    const game = ensureRoom(roomId);
    let role = "spectator";
    if (game.players.size < 2 && !game.players.has(socket.id)) {
      game.players.add(socket.id);
      role = "player";
    }

    // Si ya hay 2 jugadores en sala, estado RUNNING (los engines arrancarán al recibir setup)
    if (game.players.size >= 2 && game.status === "WAITING") {
      game.status = "RUNNING";
    }

    socket.emit("JoinRoomResponse", { status: "success", roomId, role });

    // Mensajes (igual que tenías)
    bddConnection.query(`CALL ${PROC.GET_ROOM_MESSAGES}(?);`, [roomId], (err, results) => {
      if (err) return;
      const rows = results[0] || [];
      const formatted = rows.map(msg => ({ username: msg.username, text: msg.text, createDate: msg.createDate }));
      socket.emit("ServerResponseRequestMessageListToClient", formatted);
    });
  });

  // El cliente C# envía su GridSetup (NodeGrid.GridSetup) por player
  socket.on("GameProvideSetup", (payload) => {
    let setupObj = payload;
    try {
      if (typeof setupObj === "string") setupObj = JSON.parse(setupObj);
    } catch (e) {
      console.error("[GameProvideSetup] JSON parse error:", e);
      return;
    }

    // Localizar la sala: preferimos roomId en payload; si no, inferimos desde socket.rooms
    const explicitRoom = setupObj.roomId || setupObj.RoomId || setupObj.room_id;
    let roomId = explicitRoom ? Number(explicitRoom) : 0;
    if (!roomId) {
      const rooms = Array.from(socket.rooms || []);
      const r = rooms.find(rn => rn.startsWith("room_"));
      if (r) roomId = Number(r.split("_")[1]);
    }
    if (!roomId || !isFinite(roomId) || roomId <= 0) {
      console.warn("[GameProvideSetup] cannot determine roomId; ignoring");
      return;
    }

    const game = ensureRoom(roomId);

    // Solo aceptar setups de sockets que son players
    if (!game.players.has(socket.id)) {
      console.warn("[GameProvideSetup] setup from spectator ignored");
      return;
    }

    // Clave de player: usar el playerId que el cliente C# define en su GridSetup (o fallback a socket.id)
    const playerKey = Number.isFinite(setupObj.playerId) ? String(setupObj.playerId) : socket.id;

    // Crear engine si no existe para este player
    let rec = game.engines.get(playerKey);
    if (!rec) {
      const engine = new NodeGridColumnsServer();
      rec = { engine, started: false, socketId: socket.id };
      game.engines.set(playerKey, rec);

      // Emitir a toda la sala usando contrato NodeGrid
      engine.onSetup = function (gridSetup) {
        io.to(roomChannel(roomId)).emit("setupGrid", JSON.stringify(gridSetup));
      };
      engine.onUpdate = function (gridUpdate) {
        io.to(roomChannel(roomId)).emit("updateGrid", JSON.stringify(gridUpdate));
      };
      engine.onEnd = function () {
        // opcional: marcar estado
      };
    }

    // Aplicar setup en el motor del player
    try {
      rec.engine.provideSetup({
        playerId: Number(setupObj.playerId || 0),
        playerName: String(setupObj.playerName || "P1"),
        sizeX: Number(setupObj.sizeX),
        sizeY: Number(setupObj.sizeY)
      });
    } catch (e) {
      console.error("[GameProvideSetup] provideSetup error:", e);
      return;
    }

    // Arrancar el engine de este player si la sala está en RUNNING y aún no arrancó
    const readyToRun = (game.status === "RUNNING" && game.players.size >= 2);
    if (readyToRun && !rec.started) {
      rec.started = true;
      rec.engine.start();
    }
  });

  // Limpieza: liberar huecos de player y parar engines asociados si quieres
  socket.on("disconnect", () => {
    roomGames.forEach((game, rid) => {
      if (game.players.delete(socket.id)) {
        // Opcional: detener engines de ese player
        for (const [key, rec] of game.engines.entries()) {
          if (rec.socketId === socket.id) {
            try { rec.engine.stop(); } catch {}
            game.engines.delete(key);
          }
        }
        if (game.players.size === 0) {
          game.status = "WAITING";
        }
      }
    });
    const user = loggedUsers.get(socket.id);
    if (user) loggedUsers.delete(socket.id);
  });

  // Al conectar, enviar listado de salas
  emitRoomsToSocket(socket);
});

module.exports = router;