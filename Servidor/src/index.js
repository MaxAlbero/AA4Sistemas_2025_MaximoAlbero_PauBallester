//Init
const express = require("express");

app = express(); //Aixo crida al constructor i el posa a la variable "app" 
// (26/11: sense el const, "app" es una variable global, només podem fer això aqui, de normal esta malament)

//Settings Section
app.set("port", process.env.PORT || 3000); //la variable por la estic posant perque la vull fer servir després
app.set("json spaces", 2); //

//Middlewares

const morgan = require("morgan");
//aixo ens permet dir-li a una variable utilitzar una clase 
app.use(morgan("dev"));
//app.use(morgan("combined"));

//Express url work setup
app.use(express.urlencoded({extended: false})); //aixo fa que es treballi amb coses mes senzilles
app.use(express.json()); //aixo ens permet indicar que express pot treballar amb json

// app.get("/", (req,res) => {
//     res.json({"Title": "HelloWorld"});
// });
const http = require("http"); 
const server = http.createServer(app); //crear un servidor http

const { Server } = require("socket.io");

const io = new Server(server);
app.set("io", io);

const bddConnection = require("./bddSetup");
app.set("bdd", bddConnection);

require("./routes/gameSockets");

const roomState = new Map(); // roomId -> { unityCount: number, paused: boolean }

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  let clientType = 'web'; // por defecto
  socket.on('registerClientType', (type) => {
    if (type === 'unity' || type === 'web') {
      clientType = type;
      console.log(`Client ${socket.id} registrado como ${clientType}`);
    }
  });

    socket.on('joinRoom', (data) => {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const { roomId, playerId, playerName } = parsed;

    socket.join(roomId);
    socket.data.currentRoomId = roomId;

    // Emitir setup inicial de la grid sólo para visualización del cliente
    const gridSetup = {
        playerId: playerId,
        playerName: playerName,
        sizeX: 6,
        sizeY: 12
    };

    console.log(`Enviando setupGrid a ${socket.id}:`, gridSetup);
    socket.emit('setupGrid', JSON.stringify(gridSetup));
  });

  socket.on('gameUpdate', (data) => {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const { roomId, gridUpdate } = parsed;

    const state = roomState.get(roomId) || { unityCount: 0, paused: false };
    if (state.unityCount <= 0) {
      if (!state.paused) {
        state.paused = true;
        console.log(`Sala ${roomId} en pausa: no hay clientes Unity conectados`);
        io.to(roomId).emit('pauseState', { paused: true });
      }
      roomState.set(roomId, state);
      return; // no emitir updates si no hay Unity
    }

    console.log(`Enviando updateGrid a sala ${roomId}`);
    io.to(roomId).emit('updateGrid', JSON.stringify(gridUpdate));
  });

    socket.on('leaveRoom', (data) => {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        const { roomId } = parsed;
        socket.leave(roomId);
        socket.data.currentRoomId = null;
    });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    // Nota: si el cliente estaba en una sala, convendría decrementar unityCount.
    // Esto se puede lograr guardando roomId en el socket al unirse y aplicando la misma lógica que leaveRoom.
    console.log("fasfsadufdshfiuhfdsiufhdif");
  });
    // Listado de salas desde BDD
    socket.on('requestRooms', () => {
        // Si el cliente ya está en una sala, no devolver listado
        if (socket.data && socket.data.currentRoomId) {
            socket.emit('roomsInfo', []); // o no emitir nada; aquí devolvemos lista vacía por claridad del cliente
            return;
        }
        const db = app.get('bdd');
        db.query('SELECT id, name FROM Rooms ORDER BY id ASC', (err, rows) => {
            if (err) {
            console.error('Error fetching rooms:', err);
            socket.emit('roomsInfo', []);
            return;
            }
            socket.emit('roomsInfo', rows);
        });
    });
});

app.use(require("./routes/_routes"));

server.listen(app.get("port"), () => {
    const ip = GetIp();
    const port = app.get("port");

    console.log("Servidor en la url: http://" + ip + ":" + port + "/");
});

//Función de ayuda para obtener la IP - por ahora se queda comentada

const { networkInterfaces} = require ("os");
GetIp = () => {
    const nets = networkInterfaces();

    const results = {};

    for(const name of Object.keys(nets)){
        for(const net of nets[name]){
            const ipv4Family = typeof net.family == "string" ? "IPv4" : 4
            
            if(net.family === ipv4Family && !net.internal) {
                if(!results[name]){
                    results[name] = [];
                }
                results[name].push(net.address);
            }
        }
    }

    //return results;
    return results["enp0s3"][0]; //La IP
}