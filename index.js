/*
    uno club
    written by parabirb october 21, 2022. public domain.
    with this, i am officially off my hiatus.
    enjoy.
*/
// deps
const loki = require("lokijs");
const config = require("./config.json");
const expressServer = require("./controllers/express");

// init the database
const database = new loki("database.db");

// set infinite maximum listeners
process.setMaxListeners(Infinity);

// load the database
database.loadDatabase({}, () => {
    // retrieve collections
    let users = database.getCollection("users");
    let games = database.getCollection("games");
    let invites = database.getCollection("invites");
    // if they don't exist, init them
    if (users === null) users = database.addCollection("users");
    if (games === null) games = database.addCollection("games");
    if (invites === null) invites = database.addCollection("invites");
    // init the express server
    expressServer({
        config,
        users,
        games,
        invites,
        database
    });
});