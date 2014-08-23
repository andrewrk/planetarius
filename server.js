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

var mapSize = v(9600, 5400);

var players = {};
wss.on('connection', function(ws) {
  var player = new Player(ws);
  players[player.id] = player;

  ws.on('close', function() {
    delete players[player.id];
    broadcast('delete', player.id);
  });

  broadcast('spawn', player.serialize());
  send(ws, 'you', player.id);
});

function send(ws, name, args) {
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
  this.ws = ws;
}

Player.prototype.serialize = function() {
  return {
    id: this.id,
    pos: this.pos,
  };
};
