# Uno Club (beta)

**Notice:** Uno Club is currently in very early beta stages. There may still be bugs. Uno Club currently only supports 1v1 games. The code is not very well commented. Uno Club will become more polished over time. The main Uno Club instance can be located at https://wrongthink.me.

The premiere online Uno experience. Zero BS; just the Uno experience you deserve.

Uno Club is:
* Realistic. Uno Club follows most of the stock Uno ruleset with minor exceptions made for playability. 
* Competitive. Uno Club is ranked using Openskill, a state of the art, patent-free ranking system.
* Secure. Uno Club is designed with a focus on elegant security.
* Transparent. The source code is public domain. All dependencies are open source.
* Free forever. Uno Club's main instance has no ads, trackers, or requests for donations.
* Easy to deploy. Uno Club can be deployed in a matter of minutes.
* Fun. Uno Club is designed to be fun to play with your friends and comes with a built-in chat.

If you want to join Uno Club's main instance, contact parabirb#5688 for an invite.

## Todo
Currently, the only functionality left to implement is multiplayer (non-1v1).

## Deployment for Self-Hosting
Steps:

Install dependencies with `npm i`.

Write a config. Example config:
```
{
    "port": 80,
    "ssl": true,
    "backupTime": 15,
    "domain": "wrongthink.me",
    "sslConfig": {
        "key": "/path/to/ssl/key",
        "ca": "/path/to/ca/bundle",
        "cert": "/path/to/crt",
        "port": 443
    },
    "systemInvite": "This invite code is permanent and can be used to create initial users.",
    "instanceInfo": "This information will be displayed on the homepage."
}
```
Another example for HTTP only:
```
{
    "port: 80,
    "ssl": false,
    "backupTime": 15,
    "systemInvite": "This invite code is permanent and can be used to create initial users.",
    "instanceInfo": "This information will be displayed on the homepage."
}
```
**NOTE:** The HTTP only version is vulnerable to replay attacks. It is intended for testing purposes only. Turning SSL on will automatically disable game requests over HTTP.

You're ready now. Just use a tool like `forever` to keep it running on your server.