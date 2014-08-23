var chem = require("chem");
var ani = chem.resources.animations;
var v = chem.vec2d;
var button = chem.button;
var ani = chem.resources.animations;
var canvas = document.getElementById("game");
var engine = new chem.Engine(canvas);
var Socket = require('./socket');

engine.buttonCaptureExceptions[chem.button.KeyF5] = true;

engine.showLoadProgressBar();
engine.start();
canvas.focus();

var CHUNK_ROTATION_DELTA = Math.PI * 2 / 100;

chem.resources.on('ready', function () {
  var socket = new Socket();

  var batch = new chem.Batch();
  var staticBatch = new chem.Batch();
  var bgBatch = new chem.Batch();

  var players = {};
  var bullets = {};
  var chunks = {};
  var me = null;
  var died = false;
  var scroll = v(0, 0);
  var playerLevelAnimations = [ani.world1, ani.world2];

  var MINI_ME_COLOR = '#536EDB';
  var MINI_THEM_COLOR = '#D4313F';
  var SHIELD_DIST = 6;
  var SHIELD_COLOR = '#73AFDA';

  var mapSize = engine.size.clone();
  var miniMapSize = v(80, 45);
  var miniMapPos = v(0, 0);

  var connectingLabel = new chem.Label("connecting...", {
    pos: engine.size.scaled(0.5),
    font: "22px Arial",
    textAlign: "center",
    textBaseline: "center",
    fillStyle: "#ffffff",
    batch: staticBatch,
  });

  var debugLabel = new chem.Label("debug", {
    pos: v(0, engine.size.y - 20),
    font: "12px Arial",
    textAlign: "left",
    textBaseline: "top",
    fillStyle: "#ffffff",
    batch: staticBatch,
  });

  var controlsSprite = new chem.Sprite(ani.controls, {
    pos: v(miniMapPos.x + miniMapSize.x + 4, miniMapPos.y),
    batch: staticBatch,
  });

  generateStars(v(1080 * 4, 1920 * 4), 0.00005);

  var fpsLabel = engine.createFpsLabel();
  staticBatch.add(fpsLabel);

  engine.on('buttondown', function(btn) {
    if (btn === button.KeyBackspace) {
      // nothing to see here, move along
      socket.send("upgrayde");
    }
  });

  engine.on('update', function (dt, dx) {
    if (!me) {
      connectingLabel.setVisible(true);
      connectingLabel.text = died ? "You are fodder. Press R to respawn." : "connecting...";
      if (died && engine.buttonState(button.KeyR)) {
        died = false;
        socket.send('spawn');
      }
    } else {
      connectingLabel.setVisible(false);
    }

    if (me) {
      scroll = me.pos.minus(engine.size.scaled(0.5));

      debugLabel.text = String(me.radius);

      me.left = engine.buttonState(button.KeyLeft) || engine.buttonState(button.KeyA);
      me.right = engine.buttonState(button.KeyRight) ||
        engine.buttonState(button.KeyD) || engine.buttonState(button.KeyE);
      me.up = engine.buttonState(button.KeyUp) ||
        engine.buttonState(button.KeyW) || engine.buttonState(button.KeyComma);
      me.down = engine.buttonState(button.KeyDown) ||
        engine.buttonState(button.KeyS) || engine.buttonState(button.KeyO);
      me.fire = engine.buttonState(button.MouseLeft);
      me.aim = engine.mousePos.plus(scroll).minus(me.pos).normalize();
      sendControlUpdate();
    }
    for (var id in players) {
      var player = players[id];

      player.pos.add(player.vel.scaled(dx));

      player.sprite.pos = player.pos;
      player.sprite.scale = v((player.radius * 2) / player.sprite.size.x,
                              (player.radius * 2) / player.sprite.size.y);
      player.turretSprite.pos = player.sprite.pos.plus(player.aim.scaled(player.radius));
      player.turretSprite.scale = player.sprite.scale;
      player.turretSprite.rotation = player.aim.angle();

      player.label.pos = player.pos.offset(0, -player.radius);
    }

    for (var bulletId in bullets) {
      var bullet = bullets[bulletId];
      bullet.pos.add(bullet.vel.scaled(dx));
      bullet.sprite.pos = bullet.pos;
    }

    for (var chunkId in chunks) {
      var chunk = chunks[chunkId];
      chunk.pos.add(chunk.vel.scaled(dx));
      chunk.sprite.pos = chunk.pos;
      chunk.rotation = (chunk.rotation + CHUNK_ROTATION_DELTA * dx) % (2 * Math.PI);
    }
  });
  engine.on('draw', function (context) {
    // clear canvas to black
    context.fillStyle = '#000000'
    context.fillRect(0, 0, engine.size.x, engine.size.y);

    var bgBackFactor = 0.60;
    var bgBackScroll = scroll.scaled(bgBackFactor).neg().floor();
    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    context.translate(bgBackScroll.x, bgBackScroll.y);
    bgBatch.draw(context);

    // draw all sprites in batch
    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    context.translate(-scroll.x, -scroll.y);
    // draw container box
    context.strokeStyle = '#BFBFBF';
    context.strokeRect(0, 0, mapSize.x, mapSize.y);
    batch.draw(context);

    var playerId, player;
    for (playerId in players) {
      player = players[playerId];
      if (player.shield) {
        var angle = player.shield.angle();
        context.beginPath();
        context.arc(player.pos.x, player.pos.y, player.radius + SHIELD_DIST,
            angle - Math.PI * 0.25, angle + Math.PI * 0.25);
        context.strokeStyle = SHIELD_COLOR;
        context.lineWidth = 2;
        context.stroke();
        context.lineWidth = 1;
      }
    }

    // mini map
    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    var scale = miniMapSize.divBy(mapSize);
    context.scale(scale.x, scale.y);
    for (playerId in players) {
      player = players[playerId];
      context.beginPath();
      context.arc(player.pos.x, player.pos.y, player.radius, 0, 2 * Math.PI);
      context.closePath();
      context.fillStyle = (player === me) ? MINI_ME_COLOR: MINI_THEM_COLOR;
      context.fill();
    }

    // draw a little fps counter in the corner
    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    staticBatch.draw(context);
    context.strokeStyle = '#BFBFBF';
    context.strokeRect(miniMapPos.x, miniMapPos.y, miniMapSize.x, miniMapSize.y);
  });
  socket.on('connect', function() {
  });
  socket.on('disconnect', function(){
    Object.keys(players).forEach(deletePlayer);
    Object.keys(chunks).forEach(deleteChunk);
    Object.keys(bullets).forEach(deleteBullet);
    me = null;
  });
  socket.on('delete', function(playerId) {
    deletePlayer(playerId, true);
  });
  socket.on('spawn', function(player) {
    players[player.id] = player;
    player.pos = v(player.pos);
    player.vel = v(player.vel);
    player.aim = v(player.aim);

    player.sprite = new chem.Sprite(playerLevelAnimations[player.level], { batch: batch });
    player.turretSprite = new chem.Sprite(ani.turret, {
      batch: batch,
      zOrder: 1,
      pos: player.pos,
    });
    player.label = new chem.Label(playerName(player), {
      pos: player.pos.offset(0, -player.radius),
      font: "18px Arial",
      textAlign: "center",
      textBaseline: "center",
      fillStyle: "#ffffff",
      batch: batch,
    });
  });
  socket.on('you', function(playerId) {
    me = players[playerId];
  });
  socket.on('move', function(serverPlayer) {
    var player = players[serverPlayer.id];
    player.pos = v(serverPlayer.pos);
    player.vel = v(serverPlayer.vel);
    player.aim = v(serverPlayer.aim);
    player.radius = serverPlayer.radius;
    player.shield = serverPlayer.shield ? v(serverPlayer.shield) : null;
    if (serverPlayer.kills !== player.kills) {
      player.kills = serverPlayer.kills;
      player.label.text = playerName(player);
    }
    if (player.level !== serverPlayer.level) {
      player.level = serverPlayer.level;
      player.sprite.setAnimation(playerLevelAnimations[player.level]);
      player.label.text = playerName(player);
    }
  });
  socket.on('mapSize', function(serverMapSize) {
    mapSize = v(serverMapSize);
  });
  socket.on('spawnBullet', function(bullet) {
    bullets[bullet.id] = bullet;
    bullet.player = players[bullet.player];
    bullet.pos = v(bullet.pos);
    bullet.vel = v(bullet.vel);
    bullet.sprite = new chem.Sprite(ani.bullet, {
      batch: batch,
      pos: bullet.pos,
    });
    bullet.sprite.scale = v((bullet.radius * 2) / bullet.sprite.size.x,
                            (bullet.radius * 2) / bullet.sprite.size.y);
  });
  socket.on('bulletMove', function(serverBullet) {
    var bullet = bullets[serverBullet.id];
    bullet.pos = v(serverBullet.pos);
    bullet.vel = v(serverBullet.vel);
    bullet.radius = serverBullet.radius;
  });
  socket.on('spawnChunk', function(chunk) {
    chunks[chunk.id] = chunk;
    chunk.pos = v(chunk.pos);
    chunk.vel = v(chunk.vel);
    chunk.sprite = new chem.Sprite(ani.chunk, {
      batch: batch,
      pos: chunk.pos,
    });
    chunk.sprite.scale = v((chunk.radius * 2) / chunk.sprite.size.x,
                            (chunk.radius * 2) / chunk.sprite.size.y);
  });
  socket.on('chunkMove', function(serverChunk) {
    var chunk = chunks[serverChunk.id];
    chunk.pos = v(serverChunk.pos);
    chunk.vel = v(serverChunk.vel);
    chunk.radius = serverChunk.radius;
  });
  socket.on('deleteBullet', deleteBullet);
  socket.on('deleteChunk', deleteChunk);
  
  function deleteChunk(chunkId) {
    var chunk = chunks[chunkId];
    chunk.sprite.delete();
    delete chunks[chunkId];
  }
  function deleteBullet(bulletId) {
    var bullet = bullets[bulletId];
    bullet.sprite.delete();
    delete bullets[bulletId];
  }
  function deletePlayer(playerId, _died) {
    var player = players[playerId];
    if (!player) return;
    player.sprite.delete();
    player.turretSprite.delete();
    player.label.delete();
    delete players[playerId];
    if (player === me) {
      me = null;
      died = !!_died;
    }
  }

  function generateStars(size, density) {
    var area = size.x * size.y;
    var count = density * area;
    for (var i = 0; i < count; i += 1) {
      var name = Math.random() > 0.50 ? "starsmall" : "starlarge";
      var sprite = new chem.Sprite(ani[name], {
        batch: bgBatch,
        pos: v(Math.random() * size.x, Math.random() * size.y),
      });
    }
  }

  function sendControlUpdate() {
    socket.send('controls', {
      aim: me.aim,
      left: me.left,
      right: me.right,
      up: me.up,
      down: me.down,
      fire: me.fire,
    });
  }
  function playerName(player) {
    return player.name + " Lvl:" + (player.level + 1) + " Kil:" + player.kills;
  }
});
