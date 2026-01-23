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

   // LOGIN - parseo robusto de argumentos múltiples u objeto
  socket.on("LoginRequest", (arg1, arg2) => {
    console.log("[LoginRequest] raw arg1 typeof=", typeof arg1, "value=", arg1, "arg2 typeof=", typeof arg2, "value=", arg2);

    let username = "";
    let password = "";

    // Forma 1: dos argumentos simples (strings) enviados por el cliente C#
    if (typeof arg1 === "string" && typeof arg2 === "string") {
      username = arg1.trim();
      password = arg2.trim();
    } else {
      // Forma 2: objeto/array/string JSON como antes
      let dataObj = arg1;
      try {
        if (typeof dataObj === "string") {
          dataObj = JSON.parse(dataObj);
        }
        if (Array.isArray(dataObj)) {
          // Algunos clientes envuelven el objeto como primer elemento del array
          dataObj = dataObj[0] || {};
        }
      } catch (e) {
        console.warn("LoginRequest payload parse warning:", e);
        dataObj = {};
      }

      // Extraer username/password admitiendo strings o arrays con primer elemento
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

    console.log("[LoginRequest] parsed username='" + username + "' password='(hidden)'");

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
        console.log("Usuario logueado:", user.username);

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
      (err, results) => {
        if (err) {
          console.error("Error calling CreateRoom:", err);
          socket.emit("CreateRoomResponse", {
            status: "error",
            message: "DB error creating room",
          });
          return;
        }

        socket.emit("CreateRoomResponse", {
          status: "success"
        });

        // Refrescar listado de salas para todos los clientes (cambio mínimo añadido previamente)
        io.sockets.sockets.forEach(s => emitRoomsToSocket(s));
      }
    );
  });

  // UNIRSE A SALA
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
        
        // Formatear mensajes sin IDs
        const formattedMessages = rows.map(msg => ({
          username: msg.username,
          text: msg.text,
          createDate: msg.createDate
        }));
        
        socket.emit("ServerResponseRequestMessageListToClient", formattedMessages);
      }
    );
  });

  // SOLICITAR LISTA DE MENSAJES
    socket.on("ClientRequestMessageListToServer", (data) => {
      // Parseo robusto: string -> JSON, array -> primer elemento, objeto -> tal cual
      let obj = data;
      try {
        if (typeof obj === "string") obj = JSON.parse(obj);
        if (Array.isArray(obj)) obj = obj[0] || {};
      } catch (e) {
        obj = {};
      }

      const roomId = Number(obj && obj.roomId);
      if (!roomId) {
        // No llamar al procedure si falta roomId
        socket.emit("ServerResponseRequestMessageListToClient", []);
        return;
      }

      bddConnection.query(
        "CALL " + PROC.GET_ROOM_MESSAGES + "(?);",
        [roomId],
        (err, results) => {
          if (err) {
            console.error("Error calling GetRoomMessages:", err);
            socket.emit("ServerResponseRequestMessageListToClient", []);
            return;
          }
          const rows = results[0] || [];
          const formattedMessages = rows.map(function (msg) {
            return { username: msg.username, text: msg.text, createDate: msg.createDate };
          });
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

    // Insertar mensaje en la base de datos
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

        // Crear objeto de mensaje sin IDs para enviar a los clientes
        const messageToSend = {
          username: user.username,  // Solo nombre de usuario
          text: content,
          created_at: new Date(),
          room_id: roomId           // Opcional, si necesitas para lógica
        };

        // Enviar a todos en la sala
        io.to(roomChannel(roomId)).emit("ServerMessageToClient", messageToSend);
      }
    );
  });

  // LOGOUT
  socket.on("LogoutRequest", (logoutData) => {
    const user = loggedUsers.get(socket.id);
    if (user) {
      console.log("Usuario logout:", user.username);
      loggedUsers.delete(socket.id);
    }
    socket.emit("LogoutResponse", { status: "success" });
  });

  // Al conectar, enviar listado de salas
  emitRoomsToSocket(socket);

  socket.on("disconnect", () => {
    const user = loggedUsers.get(socket.id);
    if (user) {
      console.log("Usuario desconectado:", user.username);
      loggedUsers.delete(socket.id);
    }
    console.log("Socket disconnected:", socket.id);
  });
});

module.exports = router;