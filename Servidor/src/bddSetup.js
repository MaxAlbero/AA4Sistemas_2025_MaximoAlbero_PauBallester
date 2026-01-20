const mysql = require("mysql");

const connection = mysql.createConnection({
    host: "localhost",
    user: "serverUser",
    password: "user",
    database: "mydb"
});

connection.connect((error) => {

    if(error) throw error;

    console.log("BDD Connected!");

    app.set("bdd", connection);

    connection.query("select * from Users", (err, result, fields) => {

        if(err)
            console.log(err);
        else
        {
            console.log("Results: ");
            console.log(result);
            // console.log("Fields: ");
            // console.log(fields);
        }

    })

    // connection.query("call CreateUser('User Creado Desde Procedure y servidor','77777');",
    //      (err, result, fields) => {
    //     if(err)
    //         console.log(err);
    //     else
    //     {
    //         console.log("Results: ");
    //         console.log(result);
    //         console.log("Fields: ");
    //         console.log(fields);
    //     }
    //      }
    // )
});

module.exports = connection;