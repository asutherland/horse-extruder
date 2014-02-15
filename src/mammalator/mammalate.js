define(function(require, exports, module) {

var bodyparts = require('./bodyparts');

/**
 * Base horse size:
 * - Torso: 1.5m long, 0.75m high, 0.4m wide
 * - Legs, 0.75m long starting from the torso.
 */
function makeHorse(sizeScale) {
  var torso = new bodyparts.Torso({
    length: 1.5 * sizeScale,
    height: 0.75 * sizeScale,
    width: 0.4 * sizeScale,
    numLegs: 4
  });
}

});
