const { Router } = require("express");
const router = Router();

router.get("/", (req, res) => { //quan algu façi una petició get. Que en aquest cas es demanar alguna cosa a traves de la url

    // res.send("Hello World");
    res.json({Title: "Hello World in Routes"});
});

router.use("/chat", require("./chatWithSockets/chat"));

module.exports = router; //quan algu fa un require d'aquest arxiu, em retorna el que hi ha dins de module.exports