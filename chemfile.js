// the main source file which depends on the rest of your source files.
exports.main = 'src/main';

exports.spritesheet = {
  defaults: {
    delay: 0.05,
    loop: false,
    // possible values: a Vec2d instance, or one of:
    // ["center", "topleft", "topright", "bottomleft", "bottomright",
    //  "top", "right", "bottom", "left"]
    anchor: "center"
  },
  animations: {
    world: {},
    turret: {
      anchor: {x: 20, y: 62},
    },
    starsmall: {},
    starlarge: {},
    bullet: {},
    chunk: {},
  }
};
