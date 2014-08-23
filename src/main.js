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
  var scroll = v(0, 0);

  var mapSize = engine.size.clone();

  var connectingLabel = new chem.Label("connecting...", {
    pos: engine.size.scaled(0.5),
    font: "22px Arial",
    textAlign: "center",
    textBaseline: "center",
    fillStyle: "#ffffff",
    batch: staticBatch,
  });

  var debugLabel = new chem.Label("debug", {
    pos: v(0, 0),
    font: "12px Arial",
    textAlign: "left",
    textBaseline: "top",
    fillStyle: "#ffffff",
    batch: staticBatch,
  });

  generateStars(v(1080 * 4, 1920 * 4), 0.00005);

  var fpsLabel = engine.createFpsLabel();
  staticBatch.add(fpsLabel);

  engine.on('update', function (dt, dx) {
    connectingLabel.setVisible(!me);
    if (!me) return;

    scroll = me.pos.minus(engine.size.scaled(0.5));

    me.left = engine.buttonState(button.KeyLeft);
    me.right = engine.buttonState(button.KeyRight);
    me.up = engine.buttonState(button.KeyUp);
    me.down = engine.buttonState(button.KeyDown);
    me.fire = engine.buttonState(button.MouseLeft);
    me.aim = engine.mousePos.plus(scroll).minus(me.pos).normalize();
    sendControlUpdate();
    for (var id in players) {
      var player = players[id];

      player.pos.add(player.vel.scaled(dx));

      player.sprite.pos = player.pos;
      player.sprite.scale = v((player.radius * 2) / player.sprite.size.x,
                              (player.radius * 2) / player.sprite.size.y);
      player.turretSprite.pos = player.sprite.pos.plus(player.aim.scaled(player.radius));
      player.turretSprite.scale = player.sprite.scale;
      player.turretSprite.rotation = player.aim.angle();
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

    // draw a little fps counter in the corner
    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    staticBatch.draw(context);
  });
  socket.on('connect', function() {
  });
  socket.on('disconnect', function(){
    Object.keys(players).forEach(deletePlayer);
    Object.keys(chunks).forEach(deleteChunk);
    Object.keys(bullets).forEach(deleteBullet);
    me = null;
  });
  socket.on('delete', deletePlayer);
  socket.on('spawn', function(player) {
    players[player.id] = player;
    player.pos = v(player.pos);
    player.vel = v(player.vel);
    player.aim = v(player.aim);

    player.sprite = new chem.Sprite(ani.world, { batch: batch });
    player.turretSprite = new chem.Sprite(ani.turret, {
      batch: batch,
      zOrder: 1,
      pos: player.pos,
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
  function deletePlayer(playerId) {
    var player = players[playerId];
    player.sprite.delete();
    player.turretSprite.delete();
    delete players[playerId];
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
});
