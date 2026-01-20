const { Router } = require("express");
const router = Router();

router.get("/", (req, res) => {
  var path = require("path");
  res.sendFile(path.resolve(__dirname + "/chat.html"));
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
        const bddConnection = app.get("bdd");
        bddConnection.query(
        'select id from Users where username = ? and password = ?',
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

    socket.on("LogoutRequest", (logoutData) => {
        socket.emit("LogoutResponse", { status: "success", message: "Logged out successfully" });
    });

    socket.emit("ChatRoomsData", chatRooms);
});

module.exports = router;


// // test connection to BDD
// var mysql = require('mysql');

// var con = mysql.createConnection({
//     host: "localhost",
//     user: "serverUser",
//     password: "user",
//     database: "mydb"
// });

// con.connect(function(err) {
//     if(err) throw err;

//     console.log("Connected!");

//     con.query("select * from Users", function (err, result, fields) {
//         if (err) {
//             console.log(err);
//         } else {
//             console.log(result);
//         }
//     });
// });