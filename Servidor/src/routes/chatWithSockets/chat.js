const { Router } = require("express");
const router = Router();

router.get("/", (req, res) => {
  const path = require("path");
  res.sendFile(path.resolve(__dirname + "/chat.html"));
});

const io = app.get("io");

// Utilidad: obtener conexión BDD
function db() {
  return app.get("bdd");
}

io.on("connection", (socket) => {
  // Histórico de mensajes por sala
  socket.on("ClientRequestMessageListToServer", (payload) => {
    try {
      const { roomId } = typeof payload === "string" ? JSON.parse(payload) : payload;
      if (!roomId) {
        socket.emit("ServerResponseRequestMessageListToClient", []);
        return;
      }

      db().query(
        `SELECT Users.username AS username, Messages.text AS text, Messages.createDate AS createDate
         FROM Messages
         INNER JOIN Users ON Messages.user_id = Users.id
         WHERE room_id = ?
         ORDER BY Messages.id ASC`,
        [roomId],
        (err, rows) => {
          if (err) {
            console.error("Error fetching messages:", err);
            socket.emit("ServerResponseRequestMessageListToClient", []);
            return;
          }
          socket.emit("ServerResponseRequestMessageListToClient", rows);
        }
      );
    } catch (e) {
      console.error("ClientRequestMessageListToServer error:", e);
      socket.emit("ServerResponseRequestMessageListToClient", []);
    }
  });

  // Mensaje de chat dentro de una sala: persistir y emitir a todos los clientes de esa sala
  socket.on("ClientMessageToServer", (messageData) => {
    try {
      const data = typeof messageData === "string" ? JSON.parse(messageData) : messageData;
      const { userId, roomId, text, username } = data || {};

      if (!userId || !roomId || !text) {
        return; // datos incompletos, no procesar
      }

      db().query(
        `INSERT INTO Messages (user_id, room_id, text, createDate) VALUES (?, ?, ?, NOW())`,
        [userId, roomId, text],
        (err) => {
          if (err) {
            console.error("Error inserting message:", err);
            return;
          }
          const emitted = {
            userId,
            roomId,
            text,
            username: username || "Unknown",
            createDate: new Date().toISOString()
          };
          // Emitir a todos los clientes de la sala
          io.to(roomId).emit("ServerMessageToClient", emitted);
        }
      );
    } catch (e) {
      console.error("ClientMessageToServer error:", e);
    }
  });

  // Login: ya está parametrizado en tu rama server (4177cacc)
  socket.on("LoginRequest", (loginData) => {
    const bddConnection = db();
    bddConnection.query(
      "SELECT id FROM Users WHERE username = ? AND password = ?",
      [loginData.username, loginData.password],
      (err, result) => {
        const loginResponseData = {};
        if (err) {
          console.log(err);
          loginResponseData.status = "error";
          loginResponseData.message = "DB error";
          socket.emit("LoginResponse", loginResponseData);
          return;
        }
        if (!result || result.length <= 0) {
          loginResponseData.status = "error";
          loginResponseData.message = "User or password Incorrect";
          socket.emit("LoginResponse", loginResponseData);
          return;
        }
        loginResponseData.status = "success";
        loginResponseData.id = result[0].id;
        socket.emit("LoginResponse", loginResponseData);
      }
    );
  });

  socket.on("LogoutRequest", () => {
    socket.emit("LogoutResponse", { status: "success", message: "Logged out successfully" });
  });
});

module.exports = router;