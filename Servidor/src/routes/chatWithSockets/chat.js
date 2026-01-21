const { Router } = require("express");
const router = Router();
const path = require("path");

const io = app.get("io");
const bddConnection = app.get("bdd");

// Sustituye por los nombres REALES de tus procedures en la rama BDD
const PROC = {
  LOGIN: "Login",                 // (si lo usas por procedimiento)
  GET_ROOMS: "GetRooms",          // Debe devolver listado de salas {id,name,...}
  CREATE_ROOM: "CreateRoom",      // Debe crear una sala y devolver su id
  GET_ROOM_MESSAGES: "GetRoomMessages", // Debe devolver mensajes de una sala
  ADD_MESSAGE: "AddMessage"       // Debe insertar mensaje: (room_id, user_id, content)
};

const loggedUsers = new Map();
const roomChannel = (roomId) => `room_${roomId}`;

router.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname + "/chat.html"));
});

// Utilidad: emitir lista de salas usando procedure
function emitRoomsToSocket(socket) {
  bddConnection.query(`CALL ${PROC.GET_ROOMS}();`, (err, results) => {
    if (err) {
      console.error("Error calling GetRooms:", err);
      socket.emit("ChatRoomsData", []);
      return;
    }
    // MySQL devuelve results[0] como primer recordset
    const rows = Array.isArray(results) ? results[0] : results;
    socket.emit("ChatRoomsData", rows || []);
  });
}

io.on("connection", (socket) => {
  const address = socket.request.connection;
  console.log(
    "Socket connected with ip:port --> " +
      address.remoteAddress +
      ":" +
      address.remotePort
  );

  // LOGIN con consulta directa existente (mantengo tu código actual) 
  // o bien por procedure PROC.LOGIN si lo tienes listo
  socket.on("LoginRequest", (loginData) => {
    const { username, password } = loginData || {};

    // Opción A: tu SQL actual (si prefieres no tocar)
    bddConnection.query(
      "select id, username from Users where username = ? and password = ?;",
      [username, password],
      (err, result) => {
        const loginResponseData = {};

        if (err) {
          console.log(err);
          loginResponseData.status = "error";
          socket.emit("LoginResponse", loginResponseData);
          return;
        }

        if (!result || result.length <= 0) {
          console.log("User or password incorrecta");
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
        console.log(loginResponseData);

        emitRoomsToSocket(socket);
      }
    );

    // Opción B: por procedure (si tu Login procedure ya devuelve los datos)
    // bddConnection.query(`CALL ${PROC.LOGIN}(?, ?);`, [username, password], (err, results) => { ... });
  });

  // CREAR SALA via procedure
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

    // CALL CreateRoom(name, owner_id) – ajusta firma a tu procedure real
    bddConnection.query(
      `CALL ${PROC.CREATE_ROOM}(?, ?);`,
      [name.trim(), user.id],
      (err, results) => {
        if (err) {
          console.error("Error calling CreateRoom:", err);
          socket.emit("CreateRoomResponse", {
            status: "error",
            message: "DB error creating room",
          });
          return;
        }

        // Si el procedure devuelve el id de la sala creada:
        // const createdRoomId = results[0]?.[0]?.id;
        // if (createdRoomId) socket.join(roomChannel(createdRoomId));

        socket.emit("CreateRoomResponse", {
          status: "success"
        });

        // Refrescar listado de salas usando procedure
        emitRoomsToSocket(io);
        io.sockets.sockets.forEach(s => emitRoomsToSocket(s));
      }
    );
  });

  socket.on("JoinRoomRequest", (data) => {
    const { roomId } = data || {};
    if (!roomId) {
      socket.emit("JoinRoomResponse", {
        status: "error",
        message: "roomId is required",
      });
      return;
    }

    socket.join(roomChannel(roomId));
    socket.emit("JoinRoomResponse", { status: "success", roomId });

    // Historial de mensajes por procedure
    bddConnection.query(
      `CALL ${PROC.GET_ROOM_MESSAGES}(?);`,
      [roomId],
      (err, results) => {
        if (err) {
          console.error("Error calling GetRoomMessages:", err);
          return;
        }
        const rows = results[0] || [];
        socket.emit("ServerResponseRequestMessageListToClient", rows);
      }
    );
  });

  socket.on("ClientRequestMessageListToServer", (data) => {
    const { roomId } = data || {};
    if (!roomId) {
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
        socket.emit("ServerResponseRequestMessageListToClient", rows);
      }
    );
  });

  // Enviar mensaje a una sala via procedure
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

    // CALL AddMessage(room_id, user_id, content)
    bddConnection.query(
      `CALL ${PROC.ADD_MESSAGE}(?, ?, ?);`,
      [roomId, user.id, content],
      (err, results) => {
        if (err) {
          console.error("Error calling AddMessage:", err);
          socket.emit("ServerMessageToClient", {
            status: "error",
            message: "DB error inserting message",
          });
          return;
        }

        // Opcional: si el procedure devuelve el mensaje recién insertado
        // const inserted = results[0]?.[0];
        // if(inserted){
        //   io.to(roomChannel(roomId)).emit("ServerMessageToClient", inserted);
        // } else {
        //   io.to(roomChannel(roomId)).emit("ServerMessageToClient", { room_id: roomId, user_id: user.id, content, created_at: new Date() });
        // }

        io.to(roomChannel(roomId)).emit("ServerMessageToClient", { room_id: roomId, user_id: user.id, content, created_at: new Date() });
      }
    );
  });

  // Al conectar, enviar listado de salas
  emitRoomsToSocket(socket);

  socket.on("disconnect", () => {
    loggedUsers.delete(socket.id);
    console.log("Socket disconnected:", socket.id);
  });
});

module.exports = router;