var WebSocketServer = require('ws').Server;
var http = require('http');
var path = require('path');
var v = require('vec2d');
var express = require('express');
var serveStatic = require('serve-static');
var app = express();

var server = http.createServer(app);
var wss = new WebSocketServer({
  server: server,
  clientTracking: false,
});

app.use(serveStatic(path.join(__dirname, 'public')));
var port = process.env.PORT || 23915;
var host = process.env.HOST || '0.0.0.0';
server.listen(port, host, function() {
  console.info("Listening at http://" + host + ":" + port + "/");
});

var mapSize = v(1, 1);
setInterval(update, 16);

var playerCount = 0;

var players = {};

var msgHandlers = {
  aim: function(player, args) {
    player.aim = v(args);
  },
};
wss.on('connection', function(ws) {
  var player = new Player(ws);
  players[player.id] = player;
  playerCount += 1;

  ws.on('close', function() {
    delete players[player.id];
    playerCount -= 1;
    broadcast('delete', player.id);
    updateMapSize();
  });

  ws.on('message', function(data, flags) {
    if (flags.binary) {
      console.warn("ignoring binary web socket message");
      return;
    }
    var msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      console.warn("received invalid JSON from web socket:", err.message);
      return;
    }
    var fn = msgHandlers[msg.name];
    if (!fn) {
      console.warn("unrecognized message:", msg.name);
      return;
    }
    fn(player, msg.args);
  });

  ws.on('error', function(err) {
    console.error("web socket error:", err.stack);
  });

  for (var id in players) {
    var otherPlayer = players[id];
    send(ws, 'spawn', otherPlayer.serialize());
    if (otherPlayer !== player) {
      send(otherPlayer.ws, 'spawn', player.serialize());
    }
  }
  send(ws, 'you', player.id);

  updateMapSize();
});

function updateMapSize() {
  if (playerCount === 0) {
    mapSize = v(1, 1);
    return;
  }
  mapSize.x = 960 * 1.5 * playerCount;
  mapSize.y = mapSize.x / 1920 * 1080;
  broadcast('mapSize', mapSize);
}

function update() {
  var player, id;
  for (id in players) {
    player = players[id];

    player.pos.add(player.vel);
  }

  for (id in players) {
    player = players[id];
    broadcast('move', player.serialize());
  }
}

function send(ws, name, args) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    name: name,
    args: args,
  }));
}

function broadcast(name, args) {
  for (var id in players) {
    var player = players[id];
    send(player.ws, name, args);
  }
}

var nextId = 0;
function makeId() {
  return nextId++;
}

function Player(ws) {
  this.id = makeId();
  this.pos = v(Math.random() * mapSize.x, Math.random() * mapSize.y);
  this.radius = 30;
  this.vel = v(0, 0);
  this.aim = v(1, 0);

  this.ws = ws;
}

Player.prototype.serialize = function() {
  return {
    id: this.id,
    pos: this.pos,
    vel: this.vel,
    aim: this.aim,
    radius: this.radius,
  };
};
