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
var lastUpdate = new Date();


var EPSILON = 0.00000001;
var maxSpf = 1 / 20;
var targetSpf = 1 / 60;
var DEFAULT_RADIUS = 30;
var MAX_PLAYER_SPEED = 200 / 60;
var PLAYER_ACCEL = 5 / 60;
var PLAYER_COOLDOWN = 0.2;
var BULLET_SPEED = 1200 / 60;
var DEFAULT_BULLET_RADIUS = 4;
var nextId = 0;

var playerCount = 0;

var players = {};
var bullets = {};

var msgHandlers = {
  controls: function(player, args) {
    player.aim = v(args.aim);
    player.left = args.left;
    player.right = args.right;
    player.up = args.up;
    player.down = args.down;
    player.fire = args.fire;
  },
};

setInterval(callUpdate, 16);
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

function update(dt, dx) {
  var player, id;
  var bullet;

  var delBullets = [];
  for (var bulletId in bullets) {
    bullet = bullets[bulletId];
    bullet.pos.add(bullet.vel.scaled(dx));
    bullet.life -= dt;

    if (bullet.life <= 0) {
      delBullets.push(bullet.id);
    }
  }
  delBullets.forEach(function(id) {
    delete bullets[id];
    broadcast('deleteBullet', id);
  });

  for (id in players) {
    player = players[id];

    player.pos.add(player.vel.scaled(dx));

    var velDelta = v();
    var adjustedAccel = dx * PLAYER_ACCEL * DEFAULT_RADIUS / player.radius;
    if (player.left) velDelta.x -= adjustedAccel;
    if (player.right) velDelta.x += adjustedAccel;
    if (player.up) velDelta.y -= adjustedAccel;
    if (player.down) velDelta.y += adjustedAccel;

    if (player.fire && !player.cooldown) {
      player.cooldown = PLAYER_COOLDOWN;
      var bulletVel = player.vel.plus(player.aim.scaled(BULLET_SPEED));
      var bulletRadius = DEFAULT_BULLET_RADIUS * player.radius / DEFAULT_RADIUS;
      bullet = new Bullet(player, player.pos.clone(), bulletVel, bulletRadius);
      bullets[bullet.id] = bullet;
      broadcast('spawnBullet', bullet.serialize());
    } else if (player.cooldown) {
      player.cooldown -= dt;
      if (player.cooldown < 0) {
        player.cooldown = 0;
      }
    }

    player.vel.add(velDelta);
    var adjustedMaxSpeed = dx * MAX_PLAYER_SPEED * DEFAULT_RADIUS / player.radius;
    if (player.vel.length() > adjustedMaxSpeed) {
      player.vel.normalize().scale(adjustedMaxSpeed);
    }

    if ((player.pos.x < 0 && player.vel.x < 0) ||
        (player.pos.x > mapSize.x && player.vel.x > 0))
    {
      player.vel.x = -player.vel.x;
    }
    if ((player.pos.y < 0 && player.vel.y < 0) ||
        (player.pos.y > mapSize.y && player.vel.y > 0))
    {
      player.vel.y = -player.vel.y;
    }
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

function makeId() {
  return nextId++;
}

function callUpdate() {
  var now = new Date();
  var delta = (now - lastUpdate) / 1000;
  lastUpdate = now;
  var dt = delta;
  if (dt < EPSILON) dt = EPSILON;
  if (dt > maxSpf) dt = maxSpf;
  var multiplier = dt / targetSpf;
  update(dt, multiplier);
}

function Player(ws) {
  this.id = makeId();
  this.pos = v(Math.random() * mapSize.x, Math.random() * mapSize.y);
  this.radius = DEFAULT_RADIUS;
  this.vel = v(0, 0);
  this.aim = v(1, 0);
  this.cooldown = 0;

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

function Bullet(player, pos, vel, radius) {
  this.id = makeId();
  this.player = player;
  this.pos = pos;
  this.vel = vel;
  this.radius = radius;
  this.life = 0.5;
}

Bullet.prototype.serialize = function() {
  return {
    id: this.id,
    pos: this.pos,
    vel: this.vel,
    player: this.player.id,
    radius: this.radius,
  };
};
