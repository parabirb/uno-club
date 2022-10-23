const { rating } = require("openskill");

class User {
    constructor({username, signingPublicKey, classRating}) {
        this.username = username;
        this.signingPublicKey = signingPublicKey;
        this.rating = classRating || rating();
    }
    toObject() {
        return { username: this.username, signingPublicKey: this.signingPublicKey, rating: this.rating };
    }
}

module.exports = User;