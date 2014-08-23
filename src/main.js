var chem = require("chem");
var ani = chem.resources.animations;
var v = chem.vec2d;
var ani = chem.resources.animations;
var canvas = document.getElementById("game");
var engine = new chem.Engine(canvas);
var Socket = require('./socket');

engine.buttonCaptureExceptions[chem.button.KeyF5] = true;

engine.showLoadProgressBar();
engine.start();
canvas.focus();

chem.resources.on('ready', function () {
  var socket = new Socket();

  var batch = new chem.Batch();
  var boom = new chem.Sound('sfx/boom.ogg');

  var players = {};
  var me = null;
  var scroll = v(0, 0);

  var connectingLabel = new chem.Label("connecting...", {
    pos: engine.size.scaled(0.5),
    font: "22px Arial",
    textAlign: "center",
    textBaseline: "center",
    fillStyle: "#ffffff",
    batch: batch,
  });

  var fpsLabel = engine.createFpsLabel();
  engine.on('update', function (dt, dx) {
    connectingLabel.setVisible(!me);
    if (!me) return;

    scroll = me.pos.minus(engine.size.scaled(0.5));

    for (var id in players) {
      var player = players[id];
      player.sprite.pos = player.pos;
    }
  });
  engine.on('draw', function (context) {
    // clear canvas to black
    context.fillStyle = '#000000'
    context.fillRect(0, 0, engine.size.x, engine.size.y);

    // draw all sprites in batch
    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    context.translate(-scroll.x, -scroll.y);
    batch.draw(context);

    // draw a little fps counter in the corner
    context.setTransform(1, 0, 0, 1, 0, 0); // load identity
    fpsLabel.draw(context);
  });
  socket.on('connect', function() {
  });
  socket.on('spawn', function(player) {
    players[player.id] = player;
    player.pos = v(player.pos);
    player.vel = v(player.vel);

    player.sprite = new chem.Sprite(ani.world, {batch: batch});
    player.sprite.pos = player.pos;
    player.sprite.scale = v((player.radius * 2) / player.sprite.size.x,
                            (player.radius * 2) / player.sprite.size.y);
  });
  socket.on('you', function(playerId) {
    me = players[playerId];
  });
  socket.on('move', function(serverPlayer) {
    var player = players[serverPlayer.id];
    player.pos = v(serverPlayer.pos);
    player.vel = v(serverPlayer.vel);
    player.radius = serverPlayer.radius;
  });
});
