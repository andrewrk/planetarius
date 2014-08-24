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

var cheatsEnabled = process.argv.indexOf('--enable-cheats') > 0;
var mapSize = v(1, 1);
var lastUpdate = new Date();


var EPSILON = 0.00000001;
var fps = 60;
var maxSpf = 1 / 20;
var targetSpf = 1 / fps;
var DEFAULT_RADIUS = 30;
var MAX_PLAYER_SPEED = 200 / fps;
var PLAYER_ACCEL = 5 / fps;
var PLAYER_COOLDOWN = 0.3;
var BULLET_SPEED = 1100 / fps;
var DEFAULT_BULLET_RADIUS = 4;
var CHUNK_SPEED = 100 / fps;
var CHUNK_COLLECT_TIMEOUT = 10;
var CHUNK_ATTRACT_DIST = 150;
var CHUNK_ATTRACT_SPEED = 100 / fps;
var MINIMUM_PLAYER_RADIUS = 8;
var NEXT_LEVEL_RADIUS = 80;
var MAX_LEVEL = 3;
var SHIELD_ANGULAR_SPEED = Math.PI * 0.80 / fps;
var DEFAULT_TURRET_RADIUS = 8;
var BULLET_LIFE = 0.5;

var nextId = 0;
var playerCount = 0;

var players = {};
var bullets = {};
var chunks = {};
var turrets = {};

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
    player.level = 0;
    player.shield = null;
    player.kills = 0;
    player.hasTurret = false;
    broadcast('spawn', player.serialize());
    send(player.ws, 'you', player.id);
  },
  upgrayde: function(player, args) {
    if (cheatsEnabled) { // nice try, crapface
      playerGainRadius(player, 4);
    }
  },
};

setInterval(callUpdate, 16);
setInterval(sendUpdate, 32);
wss.on('connection', function(ws) {
  var player = new Player(ws);
  players[player.id] = player;
  playerCount += 1;

  ws.on('close', function() {
    players[player.id].deleted = true;
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

  for (var turretId in turrets) {
    var turret = turrets[turretId];
    send(ws, 'spawnTurret', turret.serialize());
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
  for (var turretId in turrets) {
    var turret = turrets[turretId];
    broadcast('turretMove', turret.serialize());
  }
}

function update(dt, dx) {
  var player, id;
  var playerId;
  var bullet;
  var turret, turretId;

  var radiusSum = 0;

  var delBullets = [];
  for (var bulletId in bullets) {
    bullet = bullets[bulletId];
    if (bullet.deleted) continue;

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
        playerToBullet.normalize();
        var hitPlayer = false;
        if (player.shield != null) {
          var shieldUnit = v.unit(player.shield);
          if (shieldUnit.dot(playerToBullet) >= 0.60) {
            collide(player, bullet);
            broadcast('bulletMove', bullet.serialize());
          } else {
            hitPlayer = true;
          }
        } else {
          hitPlayer = true;
        }
        if (hitPlayer) {
          playerLoseChunk(player, bullet.radius, playerToBullet, bullet.player);
          bullet.deleted = true;
          delBullets.push(bullet.id);
        }
      }
    }

    if (bullet.deleted) continue;

    for (turretId in turrets) {
      turret = turrets[turretId];
      if (turret.deleted) continue;
      if (turret.player === bullet.player) continue;
      var turretToBullet = bullet.pos.minus(turret.pos);
      if (turretToBullet.length() < turret.radius + bullet.radius) {
        turretToBullet.normalize();
        turretLoseChunk(turret, bullet.radius, turretToBullet, bullet.player);
        bullet.deleted = true;
        delBullets.push(bullet.id);
      }
    }
  }
  delBullets.forEach(function(id) {
    delete bullets[id];
    broadcast('deleteBullet', id);
  });

  var dist;
  for (turretId in turrets) {
    turret = turrets[turretId];
    if (turret.deleted) continue;

    // aim and fire
    closestPlayer = null;
    closestDist = Infinity;
    for (playerId in players) {
      player = players[playerId];
      if (player.deleted || player === turret.player) continue;
      dist = turret.pos.distance(player.pos);
      if (dist < closestDist) {
        closestDist = dist;
        closestPlayer = player;
      }
    }
    if (closestPlayer) {
      /*
      var timeTillBulletHit = closestDist / BULLET_SPEED;
      var newPos = player.pos.plus(player.vel.scaled(timeTillBulletHit * fps));
      */
      var newPos = closestPlayer.pos;
      var turretToNewPos = newPos.minus(turret.pos);
      //console.log("actual:", turretToNewPos.length(), "wanted:", BULLET_LIFE * BULLET_SPEED, "timeTill:", timeTillBulletHit);
      if (turretToNewPos.length() < BULLET_LIFE * BULLET_SPEED * fps) {
        turret.aim = turretToNewPos.normalize();
        if (!turret.cooldown) {
          turret.cooldown = PLAYER_COOLDOWN;
          bulletVel = turret.vel.plus(turret.aim.scaled(BULLET_SPEED));
          bulletRadius = DEFAULT_BULLET_RADIUS * turret.radius / DEFAULT_RADIUS;
          bullet = new Bullet(turret.player, turret.pos.clone(), bulletVel, bulletRadius);
          bullets[bullet.id] = bullet;
          broadcast('spawnBullet', bullet.serialize());
        }
      }
    }
    if (turret.cooldown) {
      turret.cooldown -= dt;
      if (turret.cooldown < 0) {
        turret.cooldown = 0;
      }
    }

    //radiusSum += turret.radius ;
  }

  var delChunks = [];
  var chunk;
  var closestDist, closestPlayer;
  for (var chunkId in chunks) {
    chunk = chunks[chunkId];
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

    closestDist = Infinity;
    closestPlayer = null;
    for (playerId in players) {
      player = players[playerId];
      if (player === chunk.player) continue;
      if (player.deleted) continue;

      var vecToPlayer = player.pos.minus(chunk.pos);
      dist = vecToPlayer.length();
      if (dist - player.radius - chunk.radius < CHUNK_ATTRACT_DIST && dist < closestDist) {
        vecToPlayer.normalize().scale(CHUNK_ATTRACT_SPEED);
        closestDist = dist;
        chunk.vel = vecToPlayer;
        closestPlayer = player;
      }
    }

    if (closestPlayer && closestDist < closestPlayer.radius + chunk.radius) {
      playerGainRadius(closestPlayer, chunk.radius);
      delChunks.push(chunk.id);
    } else {
      radiusSum += chunk.radius;
    }
  }
  delChunks.forEach(function(chunkId) {
    delete chunks[chunkId];
    broadcast('deleteChunk', chunkId);
  });

  var bulletVel, bulletRadius;
  for (id in players) {
    player = players[id];
    if (player.deleted) continue;

    if (player.shield != null) {
      player.shield = (player.shield + SHIELD_ANGULAR_SPEED * dx) % (Math.PI * 2);
    }

    player.pos.add(player.vel.scaled(dx));

    var velDelta = v();
    var adjustedAccel = dx * PLAYER_ACCEL * DEFAULT_RADIUS / player.radius;
    if (player.left) velDelta.x -= adjustedAccel;
    if (player.right) velDelta.x += adjustedAccel;
    if (player.up) velDelta.y -= adjustedAccel;
    if (player.down) velDelta.y += adjustedAccel;

    if (player.fire && !player.cooldown) {
      player.cooldown = PLAYER_COOLDOWN;
      bulletVel = player.vel.plus(player.aim.scaled(BULLET_SPEED));
      bulletRadius = DEFAULT_BULLET_RADIUS * player.radius / DEFAULT_RADIUS;
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

    if (!player.deleted) {
      radiusSum += player.radius;
    }
  }

  for (var otherPlayerId in players) {
    var otherPlayer = players[otherPlayerId];
    if (otherPlayer === player) continue;
    if (player.pos.distance(otherPlayer.pos) < player.radius + otherPlayer.radius) {
      collide(player, otherPlayer);
    }
  }

  if (radiusSum * radiusSum * Math.PI < mapSize.x * mapSize.y * 0.02) {
    var chunkVelDir = v.unit(Math.random() * Math.PI * 2);
    var chunkVel = chunkVelDir.scaled(CHUNK_SPEED);
    var chunkPos = v(Math.random() * mapSize.x, Math.random() * mapSize.y);
    chunk = new Chunk(null, chunkPos, chunkVel, Math.random() * 10 + 1);
    chunks[chunk.id] = chunk;
    broadcast('spawnChunk', chunk.serialize());
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

  var delTurrets = [];
  for (turretId in turrets) {
    turret = turrets[turretId];
    if (turret.deleted || turret.player.deleted) {
      delTurrets.push(turret.id);
      continue;
    }
  }
  delTurrets.forEach(function(turretId) {
    broadcast('deleteTurret', turretId);
    delete turrets[turretId];
  });
}

function getPlayerTurret(player) {
  for (var turretId in turrets) {
    var turret = turrets[turretId];
    if (turret.player === player) {
      return turret;
    }
  }
  return null;
}

function playerGainRadius(player, radius) {
  player.radius += radius;

  var lostRadius;
  var i;
  if (player.radius > NEXT_LEVEL_RADIUS) {
    var playerTurret = getPlayerTurret(player);
    if (player.level >= 2 && !playerTurret) {
      var turretRadius = DEFAULT_TURRET_RADIUS * player.radius / DEFAULT_RADIUS;
      if (turretRadius > MINIMUM_PLAYER_RADIUS &&
          player.radius - turretRadius > MINIMUM_PLAYER_RADIUS)
      {
        var turret = new Turret(player, player.pos.clone(), turretRadius);
        turrets[turret.id] = turret;
        playerLoseRadius(player, turret.radius);
        broadcast('spawnTurret', turret.serialize());
      }
    } else if (player.level < MAX_LEVEL) {
      lostRadius = player.radius - DEFAULT_RADIUS;
      player.level += 1;
      player.radius = DEFAULT_RADIUS;

      player.shield = (player.level === 1 || player.level === 3) ? 0 : null;
      player.hasTurret = (player.level >= 2);

      var chunkCount = 12;
      var chunkRadius= lostRadius / chunkCount;
      for (i = 0; i < chunkCount; i += 1) {
        var chunkVelDir = v.unit(Math.PI * 2 * (i / chunkCount));
        var chunkVel = chunkVelDir.scaled(CHUNK_SPEED * 2);
        var chunkPos = player.pos.plus(chunkVelDir.scaled(player.radius));
        var chunk = new Chunk(player, chunkPos, chunkVel, chunkRadius);
        chunks[chunk.id] = chunk;
        broadcast('spawnChunk', chunk.serialize());
      }
    } else {
      // we need the player's radius to go down. shoot bullets in all directions
      lostRadius = player.radius - DEFAULT_RADIUS;
      player.level += 1;
      player.radius = DEFAULT_RADIUS;
      var radiusToLose = player.radius / 2;
      var bulletCount = 12;
      var bulletRadius = lostRadius / bulletCount;
      for (i = 0; i < bulletCount; i += 1) {
        var bulletVelDir = v.unit(Math.PI * 2 * (i / bulletCount));
        var bulletVel = bulletVelDir.scaled(BULLET_SPEED);
        var bullet = new Bullet(player, player.pos.clone(), bulletVel, bulletRadius);
        bullets[bullet.id] = bullet;
        broadcast('spawnBullet', bullet.serialize());
      }
    }
  }
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

function turretLoseChunk(turret, radius, chunkVelDir, bulletPlayer) {
  var chunkVel = chunkVelDir.scaled(CHUNK_SPEED);
  var chunkPos = turret.pos.plus(chunkVelDir.scaled(turret.radius));
  var chunk = new Chunk(turret.player, chunkPos, chunkVel, radius);
  chunks[chunk.id] = chunk;
  broadcast('spawnChunk', chunk.serialize());

  turret.radius -= radius;
  if (turret.radius < MINIMUM_PLAYER_RADIUS) {
    turret.deleted = true;
    if (bulletPlayer) {
      bulletPlayer.kills += 1;
    }
    if (turret.radius > 0) {
      var extraChunk = new Chunk(turret.player, turret.pos.clone(), turret.vel.clone(), turret.radius);
      chunks[extraChunk.id] = extraChunk;
      broadcast('spawnChunk', extraChunk.serialize());
    }
  }
}

function playerLoseChunk(player, radius, chunkVelDir, bulletPlayer) {
  var chunkVel = chunkVelDir.scaled(CHUNK_SPEED);
  var chunkPos = player.pos.plus(chunkVelDir.scaled(player.radius));
  var chunk = new Chunk(player, chunkPos, chunkVel, radius);
  chunks[chunk.id] = chunk;
  broadcast('spawnChunk', chunk.serialize());

  playerLoseRadius(player, radius, bulletPlayer);
}

function playerLoseRadius(player, radius, bulletPlayer) {
  player.radius -= radius;
  if (player.radius < MINIMUM_PLAYER_RADIUS) {
    player.deleted = true;
    if (bulletPlayer) {
      bulletPlayer.kills += 1;
    }
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
  this.level = 0;
  this.shield = null;
  this.kills = 0;
  this.hasTurret = false;

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
    level: this.level,
    shield: this.shield,
    kills: this.kills,
  };
};

function Bullet(player, pos, vel, radius) {
  this.id = makeId();
  this.player = player;
  this.pos = pos;
  this.vel = vel;
  this.radius = radius;
  this.life = BULLET_LIFE;
  this.collisionDamping = 0.95;
  this.density = 0.04;
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

Bullet.prototype.mass = function() {
  return this.radius * this.radius * Math.PI * this.density;
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

function Turret(player, pos, radius) {
  this.id = makeId();
  this.radius = radius;
  this.pos = pos;
  this.vel = v(0, 0);
  this.player = player;
  this.aim = v(1, 0);
  this.cooldown = 0;
}

Turret.prototype.serialize = function() {
  return {
    id: this.id,
    pos: this.pos,
    vel: this.vel,
    radius: this.radius,
    aim: this.aim,
  };
};
