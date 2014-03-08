define(function(require, exports, module) {

var bodyparts = require('./bodyparts');

var THREE = require('three');
var ThreeBSP = require('threeBSP');


/**
 * When extruding, what should the spacing of our vertices be?  Because bones
 * operate on a per-vertex basis and we want to do linear interpolation, we
 * shouldn't cheap out.  (Although it's important to keep in mind that the
 * BSP basis of ThreeCSG means that it can produce a frightening number of
 * polygons from simple geometry, so we don't want to go too overboard, at
 * least until we have a dual-contouring or better level CSG library.)
 */
var EXTRUDE_SAMPLE_DENSITY = 0.1;


/**
 * Mainly
 */
function DynamicGeometryHelper() {
  this.bones = [];
}
DynamicGeometryHelper.prototype = {
  /**
   * Define a bone.  Exists to support cooperative allocation of bone indices.
   * All bone stuff should be baked into u,v coordinates in the geometry
   * because of our ThreeCSG hack; see bodyparts.js.
   */
  addBone: function(def) {
    def.index = this.bones.length;
    if (def.parent) {
      def.parent = def.parent.index;
    }
    this.bones.push(def);

    return def;
  },

  makeEllipseShape: function(hRad, vRad) {
    var shape = new THREE.Shape();
    shape.moveTo(0, vRad);
    shape.quadraticCurveTo(hRad, vRad, hRad, 0);
    shape.quadraticCurveTo(hRad, -vRad, 0, -vRad);
    shape.quadraticCurveTo(-hRad, -vRad, -hRad, 0);
    shape.quadraticCurveTo(-hRad, vRad, 0, vRad);
    return shape;
  },

  /**
   * Boned extrusion helper.  Give us a shape and a list of the bones in the
   * shape
   */
  extrudeBonedThing: function(opts) {
    var uvgen = new BoneUVGenerator(opts.bone);

    var geom = new THREE.ExtrudeGeometry(
      shape,
      {
        // 3 intra points per 90 deg
        curveSegments: opts.curveSegments || 16,
        steps: this.length / EXTRUDE_SAMPLE_DENSITY,
        amount: this.length,
        uvGenerator: uvgen
      });

  },

  makeSkinnedMesh: function(csg) {
  },
};

/**
 * Emit UV-coordinates for our hacky means of tunneling bone indices/weights
 * through ThreeCSG.  ExtrudeGeometry wants this to generate u,v coords for
 * vertex triples at the top/bottom and quads along the sides.
 *
 */
function BoneUVGenerator(bones) {
  this.bones = bones;

  // it's fine to cache these; we consume them on the other side
  this._topVec = this._mapLinear(0.0);
  this._bottomVec = this._mapLinear(1.0);
}
BoneUVGenerator.prototype = {
  _mapLinear: function(dist) {
  },

  generateTopUV: function(geometry, extrudedShape, extrudeOptions,
                          indexA, indexB, indexC ) {
    return [this._topVec, this._topVec, this._toVec];
  },

  generateBottomUV: function(geometry, extrudedShape, extrudeOptions,
                             indexA, indexB, indexC ) {
    return [this._bottomVec, this._bottomVec, this._bottomVec];
  },

  /**
   * Generate u,v coords for quads as the side-walls are built.
   *
   * The contour indices are talking about the position in the shape we
   * are extruding and this appears to operate backwards (countourIndex1 ===
   * countourIndex2 + 1).  But our steps move forward, with 'a' and 'b'
   * corresponding to stepIndex and 'c' and 'd' corresponding to stepIndex + 1.
   */
  generateSideWallUV: function(geometry, extrudedShape, wallContour,
                               extrudeOptions,
                               indexA, indexB, indexC, indexD,
                               stepIndex, stepsLength,
                               contourIndex1, contourIndex2 ) {

  },
};

/**
 * Base horse size:
 * - Torso: 1.5m long, 0.75m high, 0.4m wide
 * - Legs, 0.75m long starting from the torso.
 *
 * The horse's resulting coordinate space positions the horse so its feet are on
 * a y=0 floor plane, oriented along the x-axis so that it is symmetrically
 * bisected by z=0.  The start of the horse's torso starts at x=0 and grows in
 * the positive x-direction.  Because all horses should look to the left.
 */
function makeHorse() {
  var torso = new bodyparts.Torso({
    length: 1.5,
    height: 0.75,
    width: 0.4,
    legLength: 0.75,
    legPairs: [
      { radius: 0.05 },
      { radius: 0.1 }
    ]
  });

  var dgh = new DynamicGeometryHelper();
  var csgNode = torso.createCSG(dgh);

  return dgh.makeSkinnedMesh(csgNode);
}

});
