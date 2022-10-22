const { rating } = require("openskill");

class User {
    constructor({username, signingPublicKey, classRating = rating()}) {
        this.username = username;
        this.signingPublicKey = signingPublicKey;
        this.rating = classRating;
    }
    toObject() {
        return { username: this.username, signingPublicKey: this.signingPublicKey, rating: this.rating };
    }
}

module.exports = User;