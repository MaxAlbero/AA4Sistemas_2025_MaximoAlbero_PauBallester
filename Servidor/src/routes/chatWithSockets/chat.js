const { Router } = require("express");
const router = Router();
const path = require("path");

const io = app.get("io");
const bddConnection = app.get("bdd");

// Nombres de los procedures
const PROC = {
  GET_ROOMS: "GetRooms",
  CREATE_ROOM: "CreateRoom",
  GET_ROOM_MESSAGES: "GetRoomMessages",
  ADD_MESSAGE: "AddMessage"
};

const loggedUsers = new Map();
const roomChannel = (roomId) => `room_${roomId}`;

router.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname + "/chat.html"));
});

// Utilidad: emitir lista de salas
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

  // UNIRSE A SALA: robusto ante número, string, objeto o array
  socket.on("JoinRoomRequest", (arg1, arg2) => {
    // Permite que Unity envíe un número simple como arg1
    let roomId = 0;

    // Si es número directo
    if (typeof arg1 === "number") {
      roomId = arg1;
    } else if (typeof arg1 === "string") {
      // Intenta parsear número o JSON
      const num = Number(arg1);
      if (isFinite(num) && num > 0) {
        roomId = num;
      } else {
        try {
          const obj = JSON.parse(arg1);
          let raw = obj && obj.roomId;
          roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
        } catch {
          roomId = 0;
        }
      }
    } else if (Array.isArray(arg1)) {
      const first = arg1[0];
      if (typeof first === "number") {
        roomId = first;
      } else if (typeof first === "string") {
        const num = Number(first);
        roomId = isFinite(num) ? num : 0;
      } else if (typeof first === "object" && first) {
        let raw = first.roomId;
        roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
      }
    } else if (typeof arg1 === "object" && arg1) {
      let raw = arg1.roomId;
      roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
    }

    if (!roomId || !isFinite(roomId) || roomId <= 0) {
      socket.emit("JoinRoomResponse", { status: "error", message: "roomId is required" });
      return;
    }

    socket.join(roomChannel(roomId));
    socket.emit("JoinRoomResponse", { status: "success", roomId });

    // Obtener historial de mensajes
    bddConnection.query(
      `CALL ${PROC.GET_ROOM_MESSAGES}(?);`,
      [roomId],
      (err, results) => {
        if (err) {
          console.error("Error calling GetRoomMessages:", err);
          return;
        }
        const rows = results[0] || [];
        const formattedMessages = rows.map(msg => ({
          username: msg.username,
          text: msg.text,
          createDate: msg.createDate
        }));
        socket.emit("ServerResponseRequestMessageListToClient", formattedMessages);
      }
    );
  });

  // SOLICITAR LISTA DE MENSAJES: robusto ante número/objeto/array/string
  socket.on("ClientRequestMessageListToServer", (arg1, arg2) => {
    let roomId = 0;

    if (typeof arg1 === "number") {
      roomId = arg1;
    } else if (typeof arg1 === "string") {
      const num = Number(arg1);
      if (isFinite(num) && num > 0) {
        roomId = num;
      } else {
        try {
          const obj = JSON.parse(arg1);
          let raw = obj && obj.roomId;
          roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
        } catch {
          roomId = 0;
        }
      }
    } else if (Array.isArray(arg1)) {
      const first = arg1[0];
      if (typeof first === "number") {
        roomId = first;
      } else if (typeof first === "string") {
        const num = Number(first);
        roomId = isFinite(num) ? num : 0;
      } else if (typeof first === "object" && first) {
        let raw = first.roomId;
        roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
      }
    } else if (typeof arg1 === "object" && arg1) {
      let raw = arg1.roomId;
      roomId = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
    }

    if (!roomId || !isFinite(roomId) || roomId <= 0) {
      socket.emit("ServerResponseRequestMessageListToClient", []);
      return;
    }

    bddConnection.query(
      `CALL ${PROC.GET_ROOM_MESSAGES}(?);`,
      [roomId],
      (err, results) => {
        if (err) {
          console.error("Error calling GetRoomMessages:", err);
          socket.emit("ServerResponseRequestMessageListToClient", []);
          return;
        }
        const rows = results[0] || [];
        const formattedMessages = rows.map(msg => ({
          username: msg.username,
          text: msg.text,
          createDate: msg.createDate
        }));
        socket.emit("ServerResponseRequestMessageListToClient", formattedMessages);
      }
    );
  });

  // ENVIAR MENSAJE
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

  // LOGOUT
  socket.on("LogoutRequest", () => {
    const user = loggedUsers.get(socket.id);
    if (user) {
      loggedUsers.delete(socket.id);
    }
    socket.emit("LogoutResponse", { status: "success" });
  });

  // Al conectar, enviar listado de salas
  emitRoomsToSocket(socket);

  socket.on("disconnect", () => {
    const user = loggedUsers.get(socket.id);
    if (user) {
      loggedUsers.delete(socket.id);
    }
    console.log("Socket disconnected:", socket.id);
  });
});

module.exports = router;