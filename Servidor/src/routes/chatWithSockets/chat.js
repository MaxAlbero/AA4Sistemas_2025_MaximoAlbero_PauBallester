const { Router } = require("express");
const { Socket } = require("socket.io");
const router = Router();

router.get("/", (req, res) => {
    
    //console.log("h ", __dirname);
    var path = require("path");

    console.log(path.resolve(__dirname + "/chat.html"));
    res.sendFile(path.resolve( __dirname + "/chat.html"));

});

var io = app.get("io");
var chatRooms = [];

var messageList = [];

io.on("connection", (socket) => {

    var address = socket.request.connection;
    console.log("Socket connected with ip:port --> " 
        + address.remoteAddress + ":" + address.remotePort);


    socket.on("ClientRequestMessageListToServer", () => {
        socket.emit("ServerResponseRequestMessageListToClient", messageList);
    })

    socket.on("ClientMessageToServer", (messageData) => {
        messageList.push(messageData);
        io.emit("ServerMessageToClient", messageData);
    });

    // socket.on("TextElement", (msg) =>{
    //     console.log("Text Element: " + msg);
    // });

    socket.on("LoginRequest", (loginData) => {

        //Preguntar a la bdd la lista de usuarios con username y contraseña
        var bddConnection = app.get("bdd");

        bddConnection.query('select id from Users where username = "' + loginData.username 
            + '" and password = "' + loginData.password + '";', 
            (err, result, fields) => {
        
        var loginResponseData = {

        }

        //Podriamos crear una clase loginResponseData con las variables error y id.
        //O podriamos crear una clase loginResponseData con una variable status y un id.
        //El estatus puede ser por ahora, error|success, y el id puede o no existir.

        //Si no existe llamare a "LoginResponse" con el error
        if(err) {
            console.log(err);

            loginResponseData.status = "error";

            socket.emit("LoginResponse", loginResponseData);
            return;
        }

        if(result.length <= 0){
            console.log("User or password Incorrecta");

            loginResponseData.status = "error";
            loginResponseData.message = "User or password Incorrect";

            socket.emit("LoginResponse", loginResponseData);
            return;
        }


        //Si existe, llamare a "LoginResponse" con el ID
        loginResponseData.statues = "success";
        loginResponseData.id = result[0].id;

        socket.emit("LoginResponse", loginResponseData);

        console.log(loginResponseData);

    });

    });


    socket.emit("ChatRoomsData", chatRooms);
});

module.exports = router;