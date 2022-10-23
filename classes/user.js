const openskill = require("openskill");

class User {
    constructor({username, signingPublicKey, rating }) {
        this.username = username;
        this.signingPublicKey = signingPublicKey;
        this.rating = rating || openskill.rating();
    }
    toObject() {
        return { username: this.username, signingPublicKey: this.signingPublicKey, rating: this.rating };
    }
}

module.exports = User;