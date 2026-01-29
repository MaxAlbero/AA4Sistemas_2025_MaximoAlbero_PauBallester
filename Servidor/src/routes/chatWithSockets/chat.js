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

const loggedUsers = new Map(); // socket.id -> { id, username }
const roomChannel = (roomId) => `room_${roomId}`;

// Estado por sala: dos grids (máximo) y players logeados
// roomId -> { status:'WAITING'|'RUNNING'|'ENDED', players:Set<userId>, engines: Map<userId,{engine,started,username}> }
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

  // UNIRSE A SALA: los dos primeros usuarios LOGEADOS son players
  socket.on("JoinRoomRequest", (arg1, arg2) => {
    let roomId = 0;

    if (typeof arg1 === "number") roomId = arg1;
    else if (typeof arg1 === "string") {
      const n = Number(arg1);
      if (isFinite(n) && n > 0) roomId = n;
      else {
        try { const o = JSON.parse(arg1); const raw = o && o.roomId; roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw); }
        catch { roomId = 0; }
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

    const user = loggedUsers.get(socket.id); // solo web logeado cuenta como player
    const game = ensureRoom(roomId);
    let role = "spectator";

    if (user) {
      const userId = user.id;
      if (!game.players.has(userId) && game.players.size < 2) {
        game.players.add(userId);
        role = "player";

        // Crear engine para este player si no existe aún
        if (!game.engines.has(userId)) {
          const engine = new NodeGridColumnsServer({ tickMs: 500 });
          game.engines.set(userId, { engine, started: false, username: user.username });

          // Emitir setupGrid al canal (contrato NodeGrid)
          engine.onSetup = function (gridSetup) {
            io.to(roomChannel(roomId)).emit("setupGrid", JSON.stringify(gridSetup));
            console.log(`[EMIT setupGrid] room=${roomId} playerId=${gridSetup.playerId}`);
          };
          // Emitir updateGrid periódicamente
          engine.onUpdate = function (gridUpdate) {
            io.to(roomChannel(roomId)).emit("updateGrid", JSON.stringify(gridUpdate));
          };
          engine.onEnd = function () {};

          // Inicializar grid para este player (servidor decide tamaño y nombres)
          engine.provideSetup({
            playerId: userId,
            playerName: user.username,
            sizeX: 6,
            sizeY: 12
          });
        }
      }
    }

    // Si ya hay 2 players y aún no corre, arrancar motores de ambos
    if (game.players.size >= 2 && game.status === "WAITING") {
      game.status = "RUNNING";
      console.log(`[ROOM RUNNING] room=${roomId} starting engines for players: ${Array.from(game.players).join(",")}`);
      game.players.forEach(pid => {
        const rec = game.engines.get(pid);
        if (rec && !rec.started && rec.engine && rec.engine.sizeX > 0) {
          rec.started = true;
          try {
            rec.engine.start();
            console.log(`[ENGINE START] room=${roomId} playerId=${pid}`);
          } catch (e) {
            console.error(`[ENGINE START ERROR] room=${roomId} playerId=${pid}`, e);
          }
        }
      });
    }

    socket.emit("JoinRoomResponse", { status: "success", roomId, role });

    // Historial de mensajes
    bddConnection.query(
      `CALL ${PROC.GET_ROOM_MESSAGES}(?);`,
      [roomId],
      (err, results) => {
        if (err) return;
        const rows = results[0] || [];
        const formatted = rows.map(msg => ({
          username: msg.username,
          text: msg.text,
          createDate: msg.createDate
        }));
        socket.emit("ServerResponseRequestMessageListToClient", formatted);
      }
    );
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