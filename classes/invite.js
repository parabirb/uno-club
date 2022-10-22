class Invite {
    constructor({type, challenger, users, accepted, endDate}) {
        this.type = type;
        this.challenger = challenger;
        this.users = users;
        this.accepted = accepted;
        this.endDate = endDate;
    }
    toObject() {
        return { type: this.type, challenger: this.challenger, users: this.users, accepted: this.accepted, endDate: this.endDate };
    }
}

module.exports = Invite;