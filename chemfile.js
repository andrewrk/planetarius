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
    world1: {},
    world2: {},
    world3: {},
    world4: {},
    volyes: {
      anchor: 'topleft',
    },
    volno: {
      anchor: 'topleft',
    },
    dropturret: {
      anchor: {x: 50, y: 50},
    },
    turret: {
      anchor: {x: 20, y: 62},
    },
    starsmall: {},
    starlarge: {},
    bullet: {},
    chunk: {},
    controls: {
      anchor: 'topleft',
    },
  }
};
