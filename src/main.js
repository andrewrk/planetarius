var chem = require("chem");
var v = chem.vec2d;
var ani = chem.resources.animations;
var canvas = document.getElementById("game");
var engine = new chem.Engine(canvas);

engine.buttonCaptureExceptions[chem.button.KeyF5] = true;

engine.showLoadProgressBar();
engine.start();
canvas.focus();

chem.resources.on('ready', function () {
  var batch = new chem.Batch();
  var boom = new chem.Sound('sfx/boom.ogg');
  var ship = new chem.Sprite(ani.ship, {
    batch: batch,
    pos: v(200, 200),
    rotation: Math.PI / 2
  });
  var shipVel = v();
  var rotationSpeed = Math.PI * 0.04;
  var thrustAmt = 0.1;
  var fpsLabel = engine.createFpsLabel();
  engine.on('update', function (dt, dx) {
    ship.pos.add(shipVel);

    // rotate the ship with left and right arrow keys
    if (engine.buttonState(chem.button.KeyLeft)) {
      ship.rotation -= rotationSpeed * dx;
    }
    if (engine.buttonState(chem.button.KeyRight)) {
      ship.rotation += rotationSpeed * dx;
    }

    // apply forward and backward thrust with up and down arrow keys
    var thrust = v(Math.cos(ship.rotation), Math.sin(ship.rotation));
    if (engine.buttonState(chem.button.KeyUp)) {
      shipVel.add(thrust.scaled(thrustAmt * dx));
    }
    if (engine.buttonState(chem.button.KeyDown)) {
      shipVel.sub(thrust.scaled(thrustAmt * dx));
    }

    // press space to blow yourself up
    if (engine.buttonJustPressed(chem.button.KeySpace)) {
      boom.play();
      ship.setAnimation(ani.boom);
      ship.setFrameIndex(0);
      ship.on('animationend', function() {
        ship.delete();
      });
    }
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
});
