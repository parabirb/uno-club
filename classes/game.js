const Round = require("./round");

class Game {
    constructor(data, newGame = true) {
        if (newGame) {
            this.users = data;
            this.points = [];
            for (let user of this.users) this.points.push(0);
            this.round = new Round(this.users);
            this.endDate = Date.now() + 48 * 60 * 60 * 1000;
        } else {
            this.users = data.users;
            this.points = data.points;
            this.round = new Round(data.round, false);
            this.endDate = data.endDate;
        }
    }

    play(index) {
        let result = this.round.play(index);
        if (result.over) {
            let accumulatedPoints = 0;
            for (let i = 0; i < this.users.length; i++) {
                if (i !== result.winner) {
                    for (let card of this.round.hands[i]) {
                        if (!isNaN(+card.type)) accumulatedPoints += +card.type;
                        else if (card.type === "reverse" || card.type === "skip" || card.type === "draw 2") accumulatedPoints += 20;
                        else accumulatedPoints += 50;
                    }
                }
            }
            this.points[result.winner] += accumulatedPoints;
            if (this.points[result.winner] >= 500) {
                return {
                    roundOver: true,
                    gameOver: true,
                    points: this.points
                };
            } else {
                this.round = new Round(this.users);
                return {
                    roundOver: true,
                    gameOver: false
                };
            }
        }
        else {
            return {
                roundOver: false,
                gameOver: false
            };
        }
    }

    draw() {
        this.round.draw();
    }

    pass() {
        this.round.pass();
    }

    toObject() {
        return {
            users: this.users,
            points: this.points,
            round: this.round.toObject(),
            endDate: this.endDate
        };
    }
}

module.exports = Game;