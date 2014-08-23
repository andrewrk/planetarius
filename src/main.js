var chem = require("chem");
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
  });
  engine.on('draw', function (context) {
    // clear canvas to black
    context.fillStyle = '#000000'
    context.fillRect(0, 0, engine.size.x, engine.size.y);

    // draw all sprites in batch
    batch.draw(context);

    // draw a little fps counter in the corner
    fpsLabel.draw(context);
  });
  socket.on('connect', function() {
  });
  socket.on('spawn', function(player) {
    players[player.id] = player;
  });
  socket.on('you', function(playerId) {
    me = players[playerId];
  });
});
