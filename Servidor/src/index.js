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

io.on('connection', (socket) => {
    console.log('Un cliente se ha conectado:', socket.id);
    
    // Manejador del evento "message"
    socket.on('message', (data) => {
        console.log('Mensaje recibido del cliente:', data);
        
        // Responder al cliente que envió el mensaje
        socket.emit('message', 'Servidor: Mensaje recibido correctamente!');
        
        // O responder a TODOS los clientes
        // io.emit('message', 'Servidor broadcast: ' + data);
    });
    
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
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


io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);
    
    // === EVENTO: Cliente solicita unirse a una sala ===
    socket.on('joinRoom', (data) => {
        try {
            // Parsear el JSON que viene de Unity
            const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { roomId, playerId, playerName } = parsedData;
            
            console.log(`joinRoom recibido:`, parsedData);
            
            socket.join(roomId);
            console.log(`Jugador ${playerName} (ID: ${playerId}) se unió a sala ${roomId}`);
            
            // Enviar setup inicial del grid a ESTE cliente
            const gridSetup = {
                playerId: playerId,
                playerName: playerName,
                sizeX: 6,
                sizeY: 12
            };
            
            console.log(`Enviando setupGrid:`, gridSetup);
            socket.emit('setupGrid', JSON.stringify(gridSetup));
            
            // OPCIONAL: También enviar a los DEMÁS clientes de la sala
            // socket.to(roomId).emit('setupGrid', JSON.stringify(gridSetup));
            
        } catch (error) {
            console.error('Error en joinRoom:', error);
        }
    });
    
    // === EVENTO: Actualizar el grid ===
    socket.on('gameUpdate', (data) => {
        try {
            const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { roomId, gridUpdate } = parsedData;
            
            console.log(`gameUpdate recibido para sala ${roomId}:`, gridUpdate);
            
            // Enviar la actualización a TODOS los clientes de esa sala
            console.log(`Enviando updateGrid a sala ${roomId}`);
            io.to(roomId).emit('updateGrid', JSON.stringify(gridUpdate));
            
        } catch (error) {
            console.error('Error en gameUpdate:', error);
        }
    });
    
    // === EVENTO: Jugador sale de la sala ===
    socket.on('leaveRoom', (data) => {
        try {
            const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
            const { roomId, playerId } = parsedData;
            
            socket.leave(roomId);
            console.log(`Jugador ID ${playerId} salió de sala ${roomId}`);
            
            // Avisar a los demás clientes
            io.to(roomId).emit('removePlayer', playerId);
            
        } catch (error) {
            console.error('Error en leaveRoom:', error);
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
    
    // Evento de prueba
    socket.on('message', (data) => {
        console.log('Mensaje:', data);
        socket.emit('message', 'Servidor: Mensaje recibido correctamente!');
    });
});