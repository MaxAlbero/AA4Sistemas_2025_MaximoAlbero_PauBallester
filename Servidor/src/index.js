//Init
const express = require("express");

app = express(); //Aixo crida al constructor i el posa a la variable "app" 
// (26/11: sense el const, "app" es una variable global, només podem fer això aqui, de normal esta malament)

// require("./bddSetup");

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

app.get("/", (req,res) => {
    res.json({"Title": "HelloWorld"});
});
//app.use(require("./routes/_routes"));

app.listen(app.get("port"), () => {
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