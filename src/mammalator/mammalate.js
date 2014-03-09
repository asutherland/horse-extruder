define(function(require) {

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
 * Helper for creating boned extruded geometry that's cobbled together via
 * CSG.
 *
 * ## Bones and Skinning ##
 *
 * SkinnedMesh and its three.js rendering support logic do not care about the
 * semantics of bones.  During rendering, each bone is reduced to a transform
 * matrix characterizing the changes to the skeleton from its initial state.
 * (And of course since the skeleton is a hierarchy, all changes of the parents
 * are propagated).  Each geometry vertex is associated with two bones and two
 * weights.  The vertex is transformed by each matrix and scaled using the
 * weight and those positions summed to produce the final vertex position for
 * rendering.
 *
 * ### Bones are Really Joints ###
 *
 * Bones are characterized in three.js by a displacement position from the
 * parent bone and a rotation characterized by a quaternion.  The position is
 * the position of the joint that controls what you would think of as the bone.
 * If we want to animate your upper arm, then the bone's position is the
 * position of your shoulder.
 *
 * ### Bones are Oriented Along +Y ###
 *
 * Convention is that bones point in the y-axis in the positive direction.  So
 * in un-transformed upper-arm-local space, your upper arm starts at the origin
 * and your elbow is at y=N
 *
 * ### Bones' Are Positioned Based Inside Our Static Geometry ###
 *
 * The bones should be configured based on the geometry.  If the geometry is of
 * a person on a skateboard doing a jump through the air while eating a hotdog
 * and giving some other skateboarder a high five, then the bones need to match
 * up with that.  That seems hard, though, so maybe just the person standing
 * with arms at their side, body looking into the screen (along -Z)
 *
 */
function DynamicGeometryHelper() {
  this._bones = [];
}
DynamicGeometryHelper.prototype = {
  /**
   * Define a bone.  Exists to support cooperative allocation of bone indices.
   * All bone stuff should be baked into u,v coordinates in the geometry
   * because of our ThreeCSG hack; see bodyparts.js.
   *
   * @param {String} def.name
   *   Singing the bone-connectedness song requires a name for each bone.
   * @param {DynBone} [def.parent]
   * @param {THREE.Vector3} def.pos
   *   The position of the joint/bone (relative to the parent bone).
   * @param {THREE.Quaternion} def.rotq
   *   The rotation quaternion that causes the line local-coordinate space
   *   line segment [0,0,0]-[0,bone length,0] to correspond to where we want
   *   the (imaginary) bone to be in 3d space when fully transformed.
   * @param {Number} def.length
   *   The length of the conceptual bone for extrusion purposes.  This is used
   *   along with `transition`.  This part of the extruded geometry is entirely
   *   weighted to this bone.
   * @param {Number} def.transition
   *   The length of the transition between this bone and the next bone for
   *   extrusion and bone-binding purposes.  This part of the extruded geometry
   *   is weighted to both this bone and the next bone with some type of
   *   transition happening.  This conceptually would visually correspond to the
   *   elbow part of an arm.
   *
   * @return DynBone
   *   This is actually just the def passed in with us having messed with it
   *   a bit.
   */
  addBone: function(def) {
    def.index = this._bones.length;
    this._bones.push(def);

    return def;
  },

  /**
   * Compute the matrix for the given bone
   */
  _getBoneTransformMatrix: function(bone) {
    var ourMatrix = new THREE.Matrix4();
    ourMatrix.makeRotationFromQuaternion(bone.rotq);
    // assume scale is [1, 1, 1] still.
    ourMatrix.setPosition(bone.pos);

    if (!bone.parent) {
      return ourMatrix;
    }
    var parentMatrix = this._getBoneTransformMatrix(bone.parent);
    ourMatrix.multiplyMatrices(parentMatrix, ourMatrix);
    return ourMatrix;
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
   * shape and produce a mesh that is positioned along the bone in the mesh's
   * coordinate space by applying the bone hierarchy transform for the first
   * bone in the list.
   *
   * The extrusion is a boring straight extrusion at this time and the bones
   * need to be appropriately lined up with that already.
   *
   * @param {THREE.Shape} shape
   * @param {DynBone} opts.featherBone
   *   It's possible the first bit of our geometry should feather in a bone like
   *   a spine bone that should not be part of our generated geometry but does
   *   want to affect initial weights.
   * @param {Number} opts.featherLength
   *   How long should the feathering stage be?
   * @param {DynBone[]} opts.bones
   *   The list of bones which we are generating a skin to go over.  The first
   *   bone defines the location of this geometry in mesh-space
   */
  extrudeBonedThingIntoMesh: function(opts) {
    var stops = [];

    var firstBoneOffset = 0.0;
    if (opts.featherBone) {
      stops.push({
        boneIndex: opts.featherBone.index,
        offset: 0.0,
      });
      firstBoneOffset = opts.featherLength;
    }

    var totalLength = 0.0;
    opts.bones.forEach(function(bone, iBone) {
      // Put a stop at both ends of the bone; no interpolation within the bone.
      stops.push({
        boneIndex: bone.index,
        offset: (iBone === 0) ? firstBoneOffset : totalLength
      });
      totalLength += bone.length;
      stops.push({
        boneIndex: bone.index,
        offset: totalLength
      });
      // We want interpolation between bones, so there is no need to add a stop
      // here.  The next bone's stop will result in the interpolation, we just
      // need to make sure we explicitly lengthen the bone.
      totalLength += bone.transition;
    });
    var uvgen = new BoneUVGenerator(stops);

    var geom = new THREE.ExtrudeGeometry(
      opts.shape,
      {
        // 3 intra points per 90 deg
        curveSegments: opts.curveSegments || 16,
        steps: opts.length / EXTRUDE_SAMPLE_DENSITY,
        amount: opts.length,
        UVGenerator: uvgen
      });
    // ExtrudeGeometry explicitly doesn't call this, but then it also fails to
    // actually create any normals.
    geom.computeVertexNormals();

    // Extrusion occurs in the +Z direction, local bone coordinate space is +Y,
    // so we need to rotate around the X-axis, specifically -90deg.
    var mesh = new THREE.Mesh(geom);
    mesh.rotateX(-Math.PI / 2);

    // So now we're +Y oriented, but we want to convert into our overall mesh
    // coordinate space, so we want to apply the net bone transform of the first
    // bone.
    var orientingBone = opts.bones[0];
    var boneMatrix = this._getBoneTransformMatrix(orientingBone);
    mesh.applyMatrix(boneMatrix);

    return mesh;
  },

  /**
   * Create the bone data-structures expected by SkinnedMesh.  Our bone defs use
   * vector objects/etc., but SkinnedMesh is expecting JSON-loaded simple
   * object data.
   */
  _makeInertBones: function() {
    return this._bones.map(function(bone) {
      return {
        parent: bone.parent ? bone.parent.index : -1,
        name: bone.name,
        pos: bone.pos.toArray(),
        rotq: bone.rotq.toArray(),
        // do not define a scale, defaults to 1,1,1
      };
    });
  },

  /**
   * Produce a skinned mesh with the given material from the provided CSG node.
   */
  makeSkinnedMesh: function(csg, material) {
    // - render to mesh
    var mesh = csg.toMesh(material);
    mesh.geometry.computeVertexNormals(); // XXX check if skinned will handle

    // - unpack bone indices and weights

    return mesh;
  },
};

/**
 * @typedef {Object} BoneStop
 * @property {Number} boneIndex
 * @property {Number} offset
 *   Distance, not ratio, along the entire length of the extrusion.
 */

/**
 * Emit UV-coordinates for our hacky means of tunneling bone indices/weights
 * through ThreeCSG.  ExtrudeGeometry wants this to generate u,v coords for
 * vertex triples at the top/bottom and quads along the sides.
 *
 * Our bone weighting is based on simple bone "stops" that's conceptually
 * similar to a linear gradient where you have a finite/enumerated set of
 * colors.  The stops name a single bone.  At the stop, that is the only bone
 * weighting doing anything.  In between the stops there is potentially a
 * linear transition between the two bones.
 *
 * @param {BoneStop[]} stops
 */
function BoneUVGenerator(stops, length) {
  this.stops = stops;
  this.length = length;

  // it's fine to cache these; we consume them on the other side
  this._topVec = this._mapLinear(0.0);
  this._bottomVec = this._mapLinear(1.0);
}
BoneUVGenerator.prototype = {
  /**
   * Generate a tunneled bone-index + bone-weight vector given a distance along
   * the extrusion segment.
   *
   * We find the two stops that bound the offset we are given.  If there is an
   * exact match, we pretend that one stop is two stops.  If the stops are
   * talking about the same bone then no transition has to occur.
   *
   * We do a naive linear search without caching for simplicity reasons at this
   * time.
   */
  _mapLinear: function(dist) {
    var stops = this.stops;
    var prevStop = stops[0], nextStop;
    for (var i = 0; i < stops.length; i++) {
      nextStop = stops[i];
      if (nextStop.offset === dist) {
        prevStop = nextStop;
        break;
      }

      if (nextStop.offset > dist) {
        break;
      }

      // (note: important for when we run off the end, distance-wise)
      prevStop = nextStop;
    }

    if (prevStop.boneIndex === nextStop.boneIndex) {
      return new THREE.Vector2(prevStop.boneIndex, 0);
    }
    var delta = nextStop.offset - prevStop.offset;
    var ratio = (dist - prevStop.offset) / delta;
    return new THREE.Vector2(prevStop.boneIndex + ratio,
                             nextStop.boneIndex + (1 - ratio));
  },

  generateTopUV: function(geometry, extrudedShape, extrudeOptions,
                          indexA, indexB, indexC ) {
    return [this._topVec, this._topVec, this._topVec];
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
    var aRatio = stepIndex / (stepsLength - 1),
        cRatio = (stepIndex + 1) / (stepsLength - 1);
    // Convert the ratio into absolute distance since that's how our stops are
    // defined.  Obviously we could pre-process the steps instead but for
    // clarity while debugging, we're doing it like this for now.
    var aDist = aRatio * this.length,
        cDist = cRatio * this.length;
    var aVec = this._mapLinear(aDist),
        cVec = this._mapLinear(cDist);
    return [aVec, aVec, cVec, cVec];
  },
};

/**
 * Base horse size:
 * - Torso: 1.5m long, 0.75m high, 0.4m wide
 * - Legs, 0.75m long from the bottom of the torso; legs potentially need to
 *   extend higher since the torso is not a cuboid.
 *
 * The horse stands on the y=0 floor plane with its withers (stable neck point
 * thing) at z=0 and its head looking into the screen (along -Z).  The horse
 * extends along +Z, so it has bilateral symmetry when bisected by x=0.
 */
function makeHorse(material) {
  var torso = new bodyparts.Torso({
    type: 'horizontal',
    length: 1.5,
    height: 0.75,
    width: 0.4,
    skinDepth: 0.01,
    legLength: 0.75,
    footLength: 0.1,
    legPairs: [
      { radius: 0.05 },
      { radius: 0.1 }
    ]
  });

  var dgh = new DynamicGeometryHelper();
  var csgNode = torso.createCSG(dgh);

  return dgh.makeSkinnedMesh(csgNode, material);
}

return {
  makeHorse: makeHorse
};

});
