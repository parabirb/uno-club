const shuffle = require("shuffle");
let deck = require("shuffle/src/deck");

class Round {
    constructor(data = null, newGame = true) {
        // if we're making a new game
        if (newGame) {
            // initialize the users
            this.users = data;
            // create the deck
            this.deck = [];
            // add cards to the deck. sorry for the formatting, my prettifier insists on it
            let types = [{name: "0", amount: 1}, {name: "1", amount: 2}, {name: "2", amount: 2}, {
                name: "3",
                amount: 2
            }, {name: "4", amount: 2}, {name: "5", amount: 2}, {name: "6", amount: 2}, {
                name: "7",
                amount: 2
            }, {name: "8", amount: 2}, {name: "9", amount: 2}, {name: "skip", amount: 2}, {
                name: "reverse",
                amount: 2
            }, {name: "draw 2", amount: 2}];
            let colors = ["red", "blue", "green", "yellow"];
            // push cards to the deck
            for (let color of colors) {
                for (let type of types) {
                    for (let i = 0; i < type.amount; i++) this.deck.push({color, type: type.name});
                }
            }
            // push wild cards
            for (let i = 0; i < 4; i++) {
                this.deck.push({color: "wild", type: "draw 4"});
                this.deck.push({color: "wild", type: "regular"});
            }
            // shuffle deck
            this.deck = shuffle.shuffle({deck: this.deck});
            // deal 7 cards to each player
            this.hands = [];
            for (let player of this.users) this.hands.push([]);
            this.deck.deal(7, this.hands);
            // start the discard pile
            this.discard = [this.deck.draw(1)];
            // technically regular wilds can be first on the discard pile but let's be real here nobody wants to implement that shit
            while (this.discard[0].color === "wild") {
                this.deck.putOnBottomOfDeck(this.discard[0]);
                this.deck.shuffle();
                this.discard = [this.deck.draw(1)];
            }
            // if the first card is a draw 2, put 2 cards in the first player's deck
            if (this.discard[0].type === "draw 2") this.hands[0].push(...this.deck.draw(2));
            // specify the turn
            this.turn = this.discard[0].type === "skip" || this.discard[0].type === "draw 2" || (this.users.length === 2 && this.discard[0].type === "reverse") ? 1 : 0;
            this.drawn = false;
            this.reversed = this.discard[0].type === "reverse" && this.users.length > 2;
        }
        // if we're using existing data
        else {
            this.users = data.users;
            this.deck = new deck(data.deck, Math.random);
            this.hands = data.hands;
            this.discard = data.discard;
            this.turn = data.turn;
            this.drawn = data.drawn;
            this.reversed = data.reversed;
        }
    }

    #indexOfNext() {
        if (this.reversed) return this.turn === 0 ? this.users.length - 1 : this.turn - 1;
        else return (this.turn + 1) % this.users.length;
    }

    #advance() {
        this.turn = this.#indexOfNext();
        this.drawn = false;
    }

    play(index) {
        // add the card to the top of the discard pile
        this.discard.unshift(this.hands[this.turn].splice(index, 1)[0]);
        // determine if we're skipping anyone
        let skipped = this.discard[0].type === "draw 2" || this.discard[0].type === "draw 4" || this.discard[0].type === "skip";
        // check if we're reversing
        if (this.discard[0].type === "reverse") {
            // in multiplayer games
            if (this.users.length > 2) this.reversed = !this.reversed;
            // in a 1v1
            else {
                if (this.hands[this.turn].length === 0) return {over: true, winner: this.turn};
                for (let i = 0; i < 2; i++) this.#advance();
                return {over: false};
            }
        }
        // check if we're making people draw cards, and if so, draw them
        else if (this.discard[0].type === "draw 2") for (let i = 0; i < 2; i++) this.draw(this.#indexOfNext());
        else if (this.discard[0].type === "draw 4") for (let i = 0; i < 4; i++) this.draw(this.#indexOfNext());
        // if the player has no more cards, return that the game is over
        if (this.hands[this.turn].length === 0) return {over: true, winner: this.turn};
        // go to the next turn
        if (!skipped) this.#advance();
        else for (let i = 0; i < 2; i++) this.#advance();
        // return that the game is not over
        return {over: false};
    }

    draw(index = this.turn) {
        // draw a card
        this.hands[index].push(this.deck.draw(1));
        // if our deck is out, shuffle the discard pile to create the new deck
        if (this.deck.length === 0) {
            let newDiscard = [this.discard[0]];
            this.discard.shift();
            this.deck = shuffle.shuffle({deck: this.discard});
            this.discard = newDiscard;
        }
        // note if the player has drawn
        if (index === this.turn) this.drawn = true;
    }

    pass() {
        this.#advance();
    }

    toObject() {
        return {
            users: this.users,
            deck: this.deck.cards,
            hands: this.hands,
            discard: this.discard,
            turn: this.turn,
            drawn: this.drawn,
            reversed: this.reversed
        }
    }
}

module.exports = Round;