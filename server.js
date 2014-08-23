var WebSocketServer = require('ws').Server;
var http = require('http');
var path = require('path');
var v = require('vec2d');
var express = require('express');
var serveStatic = require('serve-static');
var app = express();
var eden = require('node-eden');

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
var PLAYER_COOLDOWN = 0.3;
var BULLET_SPEED = 1100 / 60;
var DEFAULT_BULLET_RADIUS = 4;
var CHUNK_SPEED = 100 / 60;
var CHUNK_COLLECT_TIMEOUT = 10;
var CHUNK_ATTRACT_DIST = 150;
var CHUNK_ATTRACT_SPEED = 100 / 60;
var MINIMUM_PLAYER_RADIUS = 8;
var nextId = 0;

var playerCount = 0;

var players = {};
var bullets = {};
var chunks = {};

var msgHandlers = {
  controls: function(player, args) {
    player.aim = v(args.aim);
    player.left = args.left;
    player.right = args.right;
    player.up = args.up;
    player.down = args.down;
    player.fire = args.fire;
  },
  spawn: function(player, args) {
    player.deleted = false;
    player.pos = v(Math.random() * mapSize.x, Math.random() * mapSize.y);
    player.radius = DEFAULT_RADIUS;
    player.vel = v(0, 0);
    player.aim = v(1, 0);
    player.cooldown = 0;
    broadcast('spawn', player.serialize());
    send(player.ws, 'you', player.id);
  },
};

setInterval(callUpdate, 16);
setInterval(sendUpdate, 32);
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

  for (var bulletId in bullets) {
    var bullet = bullets[bulletId];
    send(ws, 'spawnBullet', bullet.serialize());
  }

  for (var chunkId in chunks) {
    var chunk = chunks[chunkId];
    send(ws, 'spawnChunk', chunk.serialize());
  }

  updateMapSize();
});

function updateMapSize() {
  if (playerCount === 0) {
    mapSize = v(1, 1);
    return;
  }
  mapSize.x = 960 + (playerCount - 1) * 300;
  mapSize.y = mapSize.x / 1920 * 1080;
  broadcast('mapSize', mapSize);
}

function sendUpdate() {
  for (var playerId in players) {
    var player = players[playerId];
    if (player.deleted) continue;
    broadcast('move', player.serialize());
  }
  for (var chunkId in chunks) {
    var chunk = chunks[chunkId];
    broadcast('chunkMove', chunk.serialize());
  }
}

function update(dt, dx) {
  var player, id;
  var playerId;
  var bullet;

  var delBullets = [];
  for (var bulletId in bullets) {
    bullet = bullets[bulletId];
    bullet.pos.add(bullet.vel.scaled(dx));
    bullet.life -= dt;

    if (bullet.life <= 0) {
      delBullets.push(bullet.id);
      continue;
    }

    for (playerId in players) {
      player = players[playerId];
      if (player.deleted) continue;
      if (player === bullet.player) continue;
      var playerToBullet = bullet.pos.minus(player.pos);
      if (playerToBullet.length() < player.radius + bullet.radius) {
        playerLoseChunk(player, bullet.radius, playerToBullet.normalize());
        delBullets.push(bullet.id);
      }
    }
  }
  delBullets.forEach(function(id) {
    delete bullets[id];
    broadcast('deleteBullet', id);
  });

  var delChunks = [];
  for (var chunkId in chunks) {
    var chunk = chunks[chunkId];
    chunk.pos.add(chunk.vel.scaled(dx));

    if ((chunk.pos.x < 0 && chunk.vel.x < 0) ||
        (chunk.pos.x > mapSize.x && chunk.vel.x > 0))
    {
      chunk.vel.x = -chunk.vel.x;
    }
    if ((chunk.pos.y < 0 && chunk.vel.y < 0) ||
        (chunk.pos.y > mapSize.y && chunk.vel.y > 0))
    {
      chunk.vel.y = -chunk.vel.y;
    }

    if (chunk.player) {
      chunk.playerTimeout -= dt;
      if (chunk.playerTimeout <= 0) {
        chunk.player = null;
      }
    }

    var closestDist = Infinity;
    var closestPlayer = null;
    for (playerId in players) {
      player = players[playerId];
      if (player === chunk.player) continue;
      if (player.deleted) continue;

      var vecToPlayer = player.pos.minus(chunk.pos);
      var dist = vecToPlayer.length();
      if (dist - player.radius - chunk.radius < CHUNK_ATTRACT_DIST && dist < closestDist) {
        vecToPlayer.normalize().scale(CHUNK_ATTRACT_SPEED);
        closestDist = dist;
        chunk.vel = vecToPlayer;
        closestPlayer = player;
      }
    }

    if (closestPlayer && closestDist < closestPlayer.radius + chunk.radius) {
      closestPlayer.radius += chunk.radius;
      delChunks.push(chunk.id);
    }
  }
  delChunks.forEach(function(chunkId) {
    delete chunks[chunkId];
    broadcast('deleteChunk', chunkId);
  });

  for (id in players) {
    player = players[id];
    if (player.deleted) continue;

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
      playerLoseRadius(player, bullet.radius / 5);
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

  for (var otherPlayerId in players) {
    var otherPlayer = players[otherPlayerId];
    if (otherPlayer === player) continue;
    if (player.pos.distance(otherPlayer.pos) < player.radius + otherPlayer.radius) {
      collide(player, otherPlayer);
    }
  }

  var delPlayers = [];
  for (id in players) {
    player = players[id];
    if (player.deleted) {
      delPlayers.push(player.id);
      continue;
    }
  }
  delPlayers.forEach(function(playerId) {
    broadcast('delete', playerId);
  });
}

function collide(player, other) {
  // calculate normal
  var normal = other.pos.minus(player.pos).normalize();
  // calculate relative velocity
  var rv = other.vel.minus(player.vel);
  // calculate relative velocity in terms of the normal direction
  var velAlongNormal = rv.dot(normal);
  // do not resolve if velocities are separating
  if (velAlongNormal > 0) return;
  // calculate restitution
  var e = Math.min(player.collisionDamping, other.collisionDamping);
  // calculate impulse scalar
  var j = -(1 + e) * velAlongNormal;
  var myMass = player.mass();
  var otherMass = other.mass();
  j /= 1 / myMass + 1 / otherMass;
  // apply impulse
  var impulse = normal.scale(j);
  player.vel.sub(impulse.scaled(1 / myMass));
  other.vel.add(impulse.scaled(1 / otherMass));
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

function playerLoseChunk(player, radius, chunkVelDir) {
  var chunkVel = chunkVelDir.scaled(CHUNK_SPEED);
  var chunkPos = player.pos.plus(chunkVelDir.scaled(player.radius));
  var chunk = new Chunk(player, chunkPos, chunkVel, radius);
  chunks[chunk.id] = chunk;
  broadcast('spawnChunk', chunk.serialize());

  playerLoseRadius(player, radius);
}

function playerLoseRadius(player, radius) {
  player.radius -= radius;
  if (player.radius < MINIMUM_PLAYER_RADIUS) {
    player.deleted = true;
    if (player.radius > 0) {
      var extraChunk = new Chunk(null, player.pos.clone(), player.vel.clone(), player.radius);
      chunks[extraChunk.id] = extraChunk;
      broadcast('spawnChunk', extraChunk.serialize());
    }
  }
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
  this.collisionDamping = 0.9;
  this.density = 1;
  this.name = eden.eve();

  this.ws = ws;
}

Player.prototype.mass = function() {
  return this.radius * this.radius * Math.PI * this.density;
};

Player.prototype.serialize = function() {
  return {
    id: this.id,
    pos: this.pos,
    vel: this.vel,
    aim: this.aim,
    radius: this.radius,
    name: this.name,
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

function Chunk(player, pos, vel, radius) {
  this.id = makeId();
  this.radius = radius;
  this.pos = pos;
  this.vel = vel;
  this.player = player;
  this.playerTimeout = CHUNK_COLLECT_TIMEOUT;
}

Chunk.prototype.serialize = function() {
  return {
    id: this.id,
    pos: this.pos,
    vel: this.vel,
    radius: this.radius,
  };
};
