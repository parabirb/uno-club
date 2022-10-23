// deps
const fs = require("fs");
const https = require("https");
const express = require("express");
const openskill = require("openskill");
const User = require("../classes/user");
const Game = require("../classes/game");
const Round = require("../classes/round");
const Invite = require("../classes/invite");
const {EventEmitter} = require("events");
const {createSession, createChannel} = require("better-sse");
let nacl = require("tweetnacl");
nacl.util = require("tweetnacl-util");

// express server function
function expressServer({config, users, games, invites, database}) {
    // event emitter
    const emitter = new EventEmitter();

    // hex functions
    const fromHexString = hexString =>
        new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    const toHexString = bytes =>
        bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");

    // function to redact game info
    function filterGameInfo(input) {
        let game = new Game(input, false);
        game = game.toObject();
        game.round.deck = game.round.deck.length;
        game.round.hands = game.round.hands.map(x => x.length);
        return game;
    }

    // function to redact game info based on user
    function filterGameInfoUser(input, user) {
        let index = input.users.indexOf(user);
        if (index === -1) return filterGameInfo(input);
        else {
            let game = filterGameInfo(input);
            game.round.hands[index] = input.round.hands[index];
            return game;
        }
    }

    // function to find 1v1 game
    function find1v1Game(a, b) {
        return games.findOne({users: {$contains: [a, b]}});
    }

    // function to sync database and prune things
    function doImportantThings() {
        // remove any games and invites which should be expired
        games.findAndRemove({endDate: {$lte: Date.now()}});
        invites.findAndRemove({endDate: {$lte: Date.now()}});
        // sync the database
        database.saveDatabase();
    }

    // do the important things
    doImportantThings();
    // set an interval to do the important things when specified
    setInterval(doImportantThings, config.backupTime * 60 * 1000);

    // init new app
    const app = new express();
    app.set("view engine", "ejs");
    app.use(express.json());

    // get controllers
    app.get("/", (req, res) => res.render("index", {instanceInfo: config.instanceInfo}));
    app.get("/register", (req, res) => res.render("register"));
    app.get("/login", (req, res) => res.render("login"));
    app.get("/dashboard", (req, res) => res.render("dashboard"));
    app.get("/profile/:username", (req, res) => {
        // find the user
        let user = users.findOne({username: req.params.username});
        // if we can't
        if (user === null) {
            res.redirect("/");
            return;
        }
        // render the page
        res.render("profile", {username: req.params.username});
    })
    app.get("/userInfo/:username", (req, res) => {
        // find the user
        let user = users.findOne({username: req.params.username});
        // if we can't
        if (user === null) {
            res.status(404).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // return the data
        res.json({
            status: "success",
            data: (new User(user)).toObject()
        });
    });
    app.get("/invitesInfo/:username", (req, res) => {
        // find the user
        let user = users.findOne({username: req.params.username});
        // if we can't
        if (user === null) {
            res.status(404).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // return the data
        res.json({
            status: "success",
            data: invites.find({users: {$contains: req.params.username}}).map(x => new Invite(x)).map(x => x.toObject())
        });
    });
    app.get("/outgoingInvitesInfo/:username", (req, res) => {
        // find the user
        let user = users.findOne({username: req.params.username});
        // if we can't
        if (user === null) {
            res.status(404).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // return the data
        res.json({
            status: "success",
            data: invites.find({challenger: req.params.username}).map(x => new Invite(x)).map(x => x.toObject())
        });
    });
    app.get("/gamesInfo/:username", (req, res) => {
        // find the user
        let user = users.findOne({username: req.params.username});
        // if we can't
        if (user === null) {
            res.status(404).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // return the data
        res.json({
            status: "success",
            data: games.find({users: {$contains: req.params.username}}).map(x => filterGameInfo(x))
        });
    });
    app.get("/1v1Game/:a/:b", (req, res) => {
        // find the game
        let game = find1v1Game(req.params.a, req.params.b);
        // if we can't
        if (game === null) {
            res.redirect("/");
            return;
        }
        // render it
        res.render("1v1", {a: req.params.a, b: req.params.b});
    });

    // sse and game POST controllers
    app.get("/sse/1v1Game/:a/:b/:auth", async (req, res) => {
        // find the game
        let game = find1v1Game(req.params.a, req.params.b);
        // if we can't
        if (game === null) {
            res.status(404).json({
                status: "error",
                error: "Game not found."
            });
            return;
        }
        // if we're not authenticating
        if (req.params.auth === "none") {
            // create the SSE session
            const session = await createSession(req, res);
            // push the state
            session.push({
                type: "state",
                contents: filterGameInfo(game)
            });
            // hook the session up to the eventemitter
            const evtListener = (message) => {
                if (message.type === "state") session.push({type: "state", contents: filterGameInfo(message.contents)});
                else session.push(message);
            };
            emitter.on(`${req.params.a}/${req.params.b}`, evtListener);
            // remove the emitter when our session ends
            session.on("disconnected", () => {
                emitter.removeListener(`${req.params.a}/${req.params.b}`, evtListener);
            });
        }
        // otherwise
        else {
            // check the authentication header
            let header = req.params.auth;
            let headerRegex = /^[a-zA-Z0-9]{1,24}.[a-f0-9]{156}$/;
            if (!headerRegex.test(header)) {
                res.status(403).json({
                    status: "error",
                    error: "Invalid authorization header."
                });
                return;
            }
            let [username, signature] = header.split(".");
            let user = users.findOne({username});
            if (user === null) {
                res.status(403).json({
                    status: "error",
                    error: "Invalid authorization header."
                });
                return;
            }
            let signed = nacl.sign.open(fromHexString(signature), fromHexString(user.signingPublicKey));
            if (signed === null || nacl.util.encodeUTF8(signed) !== "authentication") {
                res.status(403).json({
                    status: "error",
                    error: "Invalid authorization header."
                });
                return;
            }
            // create the SSE session
            const session = await createSession(req, res);
            // push the state
            session.push({
                type: "state",
                contents: filterGameInfoUser(game, username)
            });
            // hook the session up to the eventemitter
            const evtListener = (message) => {
                if (message.type === "state") session.push({
                    type: "state",
                    contents: filterGameInfoUser(message.contents, username)
                });
                else session.push(message);
            };
            emitter.on(`${req.params.a}/${req.params.b}`, evtListener);
            // remove the emitter when our session ends
            session.on("disconnected", () => {
                emitter.removeListener(`${req.params.a}/${req.params.b}`, evtListener);
            });
        }
    });
    app.post("/1v1Game/:a/:b/chat", (req, res) => {
        // check if the user exists
        let user = users.findOne({username: req.body.username});
        if (user === null) {
            res.status(403).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // check if the game exists
        let game = find1v1Game(req.params.a, req.params.b);
        if (game === null) {
            res.status(404).json({
                status: "error",
                error: "Game not found."
            });
            return;
        }
        // verify the signature
        let message = nacl.sign.open(nacl.util.decodeBase64(req.body.message), fromHexString(user.signingPublicKey));
        if (message === null) {
            res.status(403).json({
                status: "error",
                error: "Key could not be verified."
            });
            return;
        }
        // convert the message to a string
        message = nacl.util.encodeUTF8(message);
        // if the message is too long
        if (message.length > 280) {
            res.status(403).json({
                status: "error",
                error: "Chats can be a maximum of 280 characters."
            });
            return;
        }
        // post the message
        emitter.emit(`${req.params.a}/${req.params.b}`, {
            type: "chat",
            contents: {
                username: req.body.username,
                message
            }
        });
        // return success
        res.status(201).json({
            status: "success"
        });
    });
    app.post("/1v1Game/:a/:b/play", (req, res) => {
        // check if the user exists
        let user = users.findOne({username: req.body.username});
        if (user === null) {
            res.status(403).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // check if the game exists
        let game = find1v1Game(req.params.a, req.params.b);
        if (game === null) {
            res.status(404).json({
                status: "error",
                error: "Game not found."
            });
            return;
        }
        // make sure the user is a player and it's their turn
        let userIndex = game.users.indexOf(req.body.username);
        if (userIndex === -1 || game.round.turn !== userIndex) {
            res.status(403).json({
                status: "error",
                error: "You either are not in the game or it is not your turn."
            });
            return;
        }
        // verify the signature
        let message = nacl.sign.open(nacl.util.decodeBase64(req.body.signature), fromHexString(user.signingPublicKey));
        if (message === null) {
            res.status(403).json({
                status: "error",
                error: "Key could not be verified."
            });
            return;
        }
        // convert the message to a string
        message = nacl.util.encodeUTF8(message);
        let messageRegex = new RegExp(`^${req.params.a}-${req.params.b}-playCard-[0-9]{1,2} (?:blue|red|yellow|green|na)$`);
        // verify that it's a valid message
        if (!messageRegex.test(message)) {
            res.status(403).json({
                status: "error",
                error: "Invalid message."
            });
            return;
        }
        // verify that the index is valid
        let index = message.split("-")[message.split("-").length - 1].split(" ");
        let wildColor = index[1]
        index = +index[0];
        if (index >= game.round.hands[userIndex].length) {
            res.status(400).json({
                status: "error",
                error: "Card is invalid."
            });
            return;
        }
        // create a game object
        let gameObject = new Game(game, false);
        // retrieve the specified card and the last card in the hand
        let card = gameObject.round.hands[userIndex][index];
        let lastCard = gameObject.round.hands[userIndex][gameObject.round.hands[userIndex].length - 1];
        // verify the card can be played
        if (gameObject.round.discard[0].type !== card.type && gameObject.round.discard[0].color !== card.color && gameObject.round.discard[0].chosen !== card.color && card.color !== "wild") {
            res.status(403).json({
                status: "error",
                error: "Card cannot be played."
            });
            return;
        }

        // function to verify wild draw 4s as playable
        function wildDraw4Playable() {
            for (let handCard of gameObject.round.hands[userIndex]) {
                if (handCard.color !== "wild" && (handCard.color === gameObject.round.discard[0].color || handCard.color === gameObject.round.discard[0].chosen)) {
                    return false;
                }
            }
            return true;
        }

        // ensure the user hasn't drawn a playable card
        if (gameObject.round.drawn && index !== gameObject.round.hands[userIndex].length - 1 && (gameObject.round.discard[0].type === lastCard.type || gameObject.round.discard[0].color === lastCard.color || gameObject.round.discard[0].chosen === lastCard.color) && (lastCard.color !== "wild" ? true : (lastCard.type !== "draw 4" || wildDraw4Playable()))) {
            res.status(403).json({
                status: "error",
                error: "Card cannot be played. If a drawn card is playable, it must be played. The last card in the hand is the card last drawn."
            });
            return;
        }
        // ensure the user doesn't have any same-color cards if the card is a wild draw 4
        if (card.color === "wild" && card.type === "draw 4") {
            if (!wildDraw4Playable()) {
                res.status(403).json({
                    status: "error",
                    error: "Card cannot be played. There must be no cards of the same color in the hand to play a Wild Draw 4."
                });
                return;
            }
        }
        // ensure a color is chosen if a card is wild
        if (card.color === "wild" && wildColor === "na") {
            res.status(403).json({
                status: "error",
                error: "A color must be specified for wild cards."
            });
            return;
        }
        // play the card and convert the instance to a regular object
        let result = gameObject.play(index);
        gameObject = gameObject.toObject();
        // if the game isn't over
        if (!result.gameOver) {
            // if the card is wild, add the chosen color
            if (card.color === "wild") gameObject.round.discard[0].chosen = wildColor;
            // change the game state
            games.remove(game);
            games.insert(gameObject);
            // push the message
            emitter.emit(`${req.params.a}/${req.params.b}`, {
                type: "state",
                contents: gameObject
            });
        }
        // if it is
        else {
            // change the ranks of the users
            let userA = users.findOne({username: req.params.a});
            let userB = users.findOne({username: req.params.b});
            let userAClone = (new User(userA)).toObject();
            let userBClone = (new User(userB)).toObject();
            users.remove(userA);
            users.remove(userB);
            let [newARating, newBRating] = openskill.rate([[userAClone.rating], [userBClone.rating]], {score: [gameObject.points[0], gameObject.points[1]]});
            newARating = newARating[0];
            newBRating = newBRating[0];
            let newUserA = (new User({username: userAClone.username, signingPublicKey: userAClone.signingPublicKey, classRating: newARating})).toObject();
            let newUserB = (new User({username: userBClone.username, signingPublicKey: userBClone.signingPublicKey, classRating: newBRating})).toObject();
            users.insert(newUserA);
            users.insert(newUserB);
            // push the message
            emitter.emit(`${req.params.a}/${req.params.b}`, {
                type: "win",
                contents: gameObject.points[0] > gameObject.points[1] ? req.params.a : req.params.b
            });
            // remove the game
            games.remove(game);
        }
        // return success
        res.status(200).json({
            status: "success"
        });
    });
    app.post("/1v1Game/:a/:b/draw", (req, res) => {
        // check if the user exists
        let user = users.findOne({username: req.body.username});
        if (user === null) {
            res.status(403).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // check if the game exists
        let game = find1v1Game(req.params.a, req.params.b);
        if (game === null) {
            res.status(404).json({
                status: "error",
                error: "Game not found."
            });
            return;
        }
        // make sure the user is a player and it's their turn
        let userIndex = game.users.indexOf(req.body.username);
        if (userIndex === -1 || game.round.turn !== userIndex) {
            res.status(403).json({
                status: "error",
                error: "You either are not in the game or it is not your turn."
            });
            return;
        }
        // verify the signature
        let message = nacl.sign.open(nacl.util.decodeBase64(req.body.signature), fromHexString(user.signingPublicKey));
        if (message === null) {
            res.status(403).json({
                status: "error",
                error: "Key could not be verified."
            });
            return;
        }
        // convert the message to a string
        message = nacl.util.encodeUTF8(message);
        let messageRegex = new RegExp(`^${req.params.a}-${req.params.b}-draw$`);
        // verify that it's a valid message
        if (!messageRegex.test(message)) {
            res.status(403).json({
                status: "error",
                error: "Invalid message."
            });
            return;
        }
        // create a game object
        let gameObject = new Game(game, false);
        // make sure they haven't drawn
        if (gameObject.round.drawn) {
            res.status(403).json({
                status: "error",
                error: "You have already drawn a card."
            });
            return;
        }
        // draw a card and convert the instance to a regular object
        gameObject.draw();
        gameObject = gameObject.toObject();
        // change the game state
        games.remove(game);
        games.insert(gameObject);
        // push the message
        emitter.emit(`${req.params.a}/${req.params.b}`, {
            type: "state",
            contents: gameObject
        });
        // return success
        res.status(200).json({
            status: "success"
        });
    });
    app.post("/1v1Game/:a/:b/pass", (req, res) => {
        // check if the user exists
        let user = users.findOne({username: req.body.username});
        if (user === null) {
            res.status(403).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // check if the game exists
        let game = find1v1Game(req.params.a, req.params.b);
        if (game === null) {
            res.status(404).json({
                status: "error",
                error: "Game not found."
            });
            return;
        }
        // make sure the user is a player and it's their turn
        let userIndex = game.users.indexOf(req.body.username);
        if (userIndex === -1 || game.round.turn !== userIndex) {
            res.status(403).json({
                status: "error",
                error: "You either are not in the game or it is not your turn."
            });
            return;
        }
        // verify the signature
        let message = nacl.sign.open(nacl.util.decodeBase64(req.body.signature), fromHexString(user.signingPublicKey));
        if (message === null) {
            res.status(403).json({
                status: "error",
                error: "Key could not be verified."
            });
            return;
        }
        // convert the message to a string
        message = nacl.util.encodeUTF8(message);
        let messageRegex = new RegExp(`^${req.params.a}-${req.params.b}-pass$`);
        // verify that it's a valid message
        if (!messageRegex.test(message)) {
            res.status(403).json({
                status: "error",
                error: "Invalid message."
            });
            return;
        }
        // create a game object
        let gameObject = new Game(game, false);
        // make sure they drew first
        if (!gameObject.round.drawn) {
            res.status(403).json({
                status: "error",
                error: "You have not drawn yet."
            });
            return;
        }
        // draw a card and convert the instance to a regular object
        gameObject.pass();
        gameObject = gameObject.toObject();
        // change the game state
        games.remove(game);
        games.insert(gameObject);
        // push the message
        emitter.emit(`${req.params.a}/${req.params.b}`, {
            type: "state",
            contents: gameObject
        });
        // return success
        res.status(200).json({
            status: "success"
        });
    });

    // post controllers
    app.post("/register", (req, res) => {
        // make sure invites are valid
        let inviteRegex = /^[a-zA-Z0-9]{1,24}-[a-f0-9]{154}$/;
        if (typeof req.body.invite !== "string") {
            res.status(403).json({
                status: "error",
                error: "An invite code must be provided."
            });
            return;
        }
        if (req.body.invite !== config.systemInvite && !inviteRegex.test(req.body.invite)) {
            res.status(403).json({
                status: "error",
                error: "Invalid invite code."
            });
            return;
        } else if (req.body.invite !== config.systemInvite) {
            let inviter = users.findOne(req.body.invite.split("-")[0]);
            if (inviter === null) {
                res.status(403).json({
                    status: "error",
                    error: "Invite code does not belong to a valid user."
                });
                return;
            }
            let invitation = +nacl.util.encodeUTF8(nacl.sign.open(fromHexString(req.body.invite.split("-")[1]), fromHexString(inviter.signingPublicKey)));
            if (invitation === 0 || isNaN(invitation) || Date.now() > (invitation + 24 * 60 * 60 * 1000)) {
                res.status(403).json({
                    status: "error",
                    error: "Invite code does not function. This is most likely because it has expired."
                });
                return;
            }
        }
        let usernameRegex = /^[a-zA-Z0-9]{1,24}$/;
        let publicKeyRegex = /^[a-f0-9]{64}$/;
        // make sure our username and public key are valid
        if (typeof req.body.username !== "string" || !usernameRegex.test(req.body.username)) {
            res.status(400).json({
                status: "error",
                error: "Usernames must be provided. Usernames can only be alphanumeric and can be at most 24 characters."
            });
            return;
        }
        if (typeof req.body.signingPublicKey !== "string" || !publicKeyRegex.test(req.body.signingPublicKey)) {
            res.status(400).json({
                status: "error",
                error: "Malformed public key or public key not present."
            });
            return;
        }
        // make sure the user is valid
        if (users.findOne({username: req.body.username}) !== null) {
            res.status(403).json({
                status: "error",
                error: "A user with this username already exists."
            });
            return;
        }
        // create the user
        let user = new User({
            username: req.body.username,
            signingPublicKey: req.body.signingPublicKey
        });
        // push it to the database
        users.insert(user.toObject());
        // return success
        res.status(201).json({
            status: "success"
        });
    });
    app.post("/challengeIndividual", (req, res) => {
        // find the challenger
        let challenger = users.findOne({username: req.body.challenger});
        // if we can't
        if (challenger === null) {
            res.status(404).json({
                status: "error",
                error: "Challenger could not be found."
            });
            return;
        }
        // make sure the challenger and challengee are not the same
        if (req.body.challenger === req.body.username) {
            res.status(403).json({
                status: "error",
                error: "You cannot invite yourself to a game."
            });
            return;
        }
        // verify signature
        let sigData = nacl.sign.open(nacl.util.decodeBase64(req.body.signature), fromHexString(challenger.signingPublicKey));
        if (sigData === null) {
            res.status(403).json({
                status: "error",
                error: "Could not verify signature."
            });
            return;
        }
        sigData = nacl.util.encodeUTF8(sigData);
        let sigDataRegex = /^invite-[0-9]+$/;
        if (!sigDataRegex.test(sigData) || Date.now() > +sigData.split("-")[1] + 60 * 1000) {
            res.status(403).json({
                status: "error",
                error: "Signature invalid."
            });
            return;
        }
        // find the user being challenged
        let user = users.findOne({username: req.body.username});
        // if we can't
        if (user === null) {
            res.status(404).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // make sure this isn't a duplicate invite
        let typeOneInvite = invites.findOne({
            type: "1v1",
            challenger: req.body.challenger,
            users: {$contains: [req.body.username]}
        });
        let typeTwoInvite = invites.findOne({
            type: "1v1",
            challenger: req.body.username,
            users: {$contains: [req.body.challenger]}
        });
        let typeOneGame = games.findOne({users: {$contains: [req.body.challenger, req.body.username]}});
        let typeTwoGame = games.findOne({users: {$contains: [req.body.username, req.body.challenger]}});
        if (typeOneInvite !== null || typeTwoInvite !== null || typeOneGame !== null || typeTwoGame !== null) {
            res.status(403).json({
                status: "error",
                error: "Invite appears to be a duplicate of an existing invite or game."
            });
            return;
        }
        // create the invite
        invites.insert({
            type: "1v1",
            challenger: req.body.challenger,
            users: [req.body.username],
            accepted: [false],
            endDate: Date.now() + 24 * 60 * 60 * 1000
        });
        // return success
        res.status(201).json({
            status: "success"
        });
    });
    app.post("/accept1v1Invite", (req, res) => {
        // find the user
        let user = users.findOne({username: req.body.username});
        // if we can't
        if (user === null) {
            res.status(404).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // verify signature
        let sigData = nacl.sign.open(nacl.util.decodeBase64(req.body.signature), fromHexString(user.signingPublicKey));
        if (sigData === null) {
            res.status(403).json({
                status: "error",
                error: "Could not verify signature."
            });
            return;
        }
        sigData = nacl.util.encodeUTF8(sigData);
        let sigDataRegex = /^accept-[0-9]+$/;
        if (!sigDataRegex.test(sigData) || Date.now() > +sigData.split("-")[1] + 60 * 1000) {
            res.status(403).json({
                status: "error",
                error: "Signature invalid."
            });
            return;
        }
        // find the challenger
        let challenger = users.findOne({username: req.body.challenger});
        // if we can't
        if (user === null) {
            res.status(404).json({
                status: "error",
                error: "Challenger could not be found."
            });
            return;
        }
        // find the invite
        const query = {type: "1v1", challenger: req.body.challenger, users: {$contains: req.body.username}};
        let invite = invites.findOne(query);
        // if we can't
        if (invite === null) {
            res.status(404).json({
                status: "error",
                error: "Invite could not be found."
            });
            return;
        }
        // delete the invite
        invites.findAndRemove(query);
        // turn it into a game
        let game = new Game([req.body.challenger, req.body.username]);
        // push it to the games
        games.insert(game.toObject());
        // emit an event
        emitter.emit(`${req.body.challenger}/${req.body.username}`, {type: "init", contents: game.toObject()});
        // return success
        res.status(201).json({
            status: "success"
        });
    });
    app.post("/decline1v1Invite", (req, res) => {
        // find the user
        let user = users.findOne({username: req.body.username});
        // if we can't
        if (user === null) {
            res.status(404).json({
                status: "error",
                error: "User could not be found."
            });
            return;
        }
        // verify signature
        let sigData = nacl.sign.open(nacl.util.decodeBase64(req.body.signature), fromHexString(user.signingPublicKey));
        if (sigData === null) {
            res.status(403).json({
                status: "error",
                error: "Could not verify signature."
            });
            return;
        }
        sigData = nacl.util.encodeUTF8(sigData);
        let sigDataRegex = /^decline-[0-9]+$/;
        if (!sigDataRegex.test(sigData) || Date.now() > +sigData.split("-")[1] + 60 * 1000) {
            res.status(403).json({
                status: "error",
                error: "Signature invalid."
            });
            return;
        }
        // find the challenger
        let challenger = users.findOne({username: req.body.challenger});
        // if we can't
        if (user === null) {
            res.status(404).json({
                status: "error",
                error: "Challenger could not be found."
            });
            return;
        }
        // find the invite
        const query = {type: "1v1", challenger: req.body.challenger, users: {$contains: req.body.username}};
        let invite = invites.findOne(query);
        // if we can't
        if (invite === null) {
            res.status(404).json({
                status: "error",
                error: "Invite could not be found."
            });
            return;
        }
        // delete the invite
        invites.findAndRemove(query);
        // return success
        res.status(200).json({
            status: "success"
        });
    });
    // if no ssl
    if (!config.ssl) {
        app.listen(config.port);
    } else {
        // create a secondary HTTP app to redirect to HTTPS
        const secondaryApp = new express();
        secondaryApp.get("*", (req, res) => res.redirect(`https://${config.domain}${req.url}`));
        secondaryApp.listen(config.port);

        // launch the primary HTTPS app
        https.createServer({
            key: fs.readFileSync(config.sslConfig.key),
            ca: fs.readFileSync(config.sslConfig.ca),
            cert: fs.readFileSync(config.sslConfig.cert)
        }, app).listen(config.sslConfig.port);
    }
}

module.exports = expressServer;