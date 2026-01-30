// Escuchar notificaciones del sistema
socket.on("RoomSystemMessage", function (payload) {
  try {
    const msg = JSON.parse(payload);
    addChatMessage({ username: "SYSTEM", text: msg.text, type: msg.type, ts: msg.ts });
  } catch (e) {
    console.warn("[RoomSystemMessage] parse error:", e);
  }
});

function addChatMessage({ username, text, type, ts }) {
  const el = document.createElement("div");
  el.className = type === "system" ? "chat-msg system" : "chat-msg";
  el.textContent = `[${username}] ${text}`;
  document.querySelector("#chat-messages").appendChild(el);
}