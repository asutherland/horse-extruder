/**
 * What makes a mammal?  None of these things, really.  You should be reading
 * wikipedia if you want facts.
 *
 * We gots:
 * - Torso
 * - Legs
 *
 * Each bodypart generates a mesh and one or more bones.
 *
 * # Understanding three.js Bones #
 *
 * I'm reverse-engineering a lot of how the bone infrastructure and what not
 * works from the buffalo data file and the three.js implementation.  Specific
 * observations are listed in here to assist me in my understanding and allowing
 * me to more easily correct my own misunderstandings.
 *
 * ## JSONLoader ##
 *
 * - vertices: Stored as flattened x, y, z triples.  So if vertices has 300
 *   numbers, there are 100 vertices.
 * - faces: Data-stream.  Each face-descriptor starts with a bit-mask.
 *   - Bitmask:
 *     - 0: isQuad: 4 named vertices to create two faces, otherwise 1 face.
 *          quad eats 4 vertex indices, else 3 vertex indices
 *     - 1: hasMaterial. eats one material index
 *     - 3: hasFaceVertexUv. once per UV layer, quad eats 4 uvIndex indices into
 *          the given uv layer at jsonData.uvs[layer], else 3 indices
 *     - 4: hasFaceNormal. eats one normal index which gets multiplied by 3
 *          the normals array contains flattend vectors.  applied to the face.
 *     - 5: hasFaceVertexNormal. eats one normal index (multiple by 3) per
 *          vertex, so 4 if quad else 3.
 *     - 6: hasFaceColor. eats one 'colors' index and applies it to the face.
 *     - 7: hasFaveVertexColor. eats one 'colors' index per vertex, so 4 if quad
 *          else 3.
 * - normals: flattened x, y, z vector triples.  Indexed by 'faces'
 * - uvs: Array of UV value arrays, 1 per UV layer, indexed by 'faces'.
 * - uvs2: Not used?
 * - skinWeights: flattened array of pairs stored as the x, y components of
 *   xyzw-nomenclatured Vector4's with z=0, w=0.  The pairs should add up to
 *   1 (see ShaderChunk.js for why.)
 * - skinIndices: flattened array of pairs stored as the a, b components of
 *   abcd-nomenclatured Vector4's with c=0, d=0.
 * - bones:
 *   - parent: The parent bone
 *   - name
 *   - pos: position.
 *   - scl: scale
 *   - rot: unused.  It looks like it must be the rotation of rotq expressed as
 *     Euleur angles (in degrees).
 *   - rotq: quaternion.
 * - animation, contains:
 *   - "hierarchy": array of
 *     -
 *
 * ## SkinnedMesh / Bone ##
 *
 * SkinnedMesh basics:
 * - Stores a flattened array of Bone's in 'bones', bones are aware of the
 *   hierarchy via 'children' maintenance.
 * - 'boneMatrices' is an array of flattened 4x4 float matrices, one matrix per
 *   bone.
 * - Supports a 'useVertexTexture' mode which stores the data in a texture
 *   somehow.  Ignoring this right now since we're totes programmatic.
 *
 * Bone:
 * - Local bone information is on the Bone Object3D itself
 * - 'skinMatrix' is the result of the cascading application of the parent bone
 *   transforms.  (For the parent/root, this is just the bone's own matrix.)
 *
 * SkinnedMesh more:
 * - boneInverses are calculated during the first updateMatrixWorld.  The
 *   inverse of the skinMatrix for each bone is calculated and saved off.
 * - boneMatrices are calculated by taking the current skinMatrix for the bone
 *   (as updated) and multiplying it by the originally saved off inverse in
 *   'boneInverses'.  Because a matrix times its inverse is the Identity matrix,
 *   this means that the resulting matrix will represent any transform applied
 *   to our initial state.
 *
 * ## ShaderChunk.js ##
 *
 * - gl_Position: The position of the vertex is determined by:
 *   - taking the initial 'position' (unless morphing, in which case 'morphed')
 *     and dubbing it our 'skinVertex'
 *   - For the 2 skinWeights/skinIndices values we had, looking up the bone
 *     matrix for the bone
 *   - Multiplying our 'skinVertex' by each bone matrix and matching bone weight
 *     and summing them.
 *     - This is why the skinWeights want to add up to 1.  If the manipulations
 *       summed on top of 'skinVertex' and were zero for no changes, they would
 *       not have to.
 *
 *
 * ## Results ##
 *
 * Each vertex can/must be associated with two bones.  If you don't want any
 * movement, you can just set the bone indices to the root bone which I guess
 * should never change.  (Why change it when you could just change the root
 * mesh transform?)  If you only want to use one bone, set its weight to 0 and
 * then the other bone does not remotely matter.
 *
 *
 * # CSG and Bones #
 *
 * ## Weightings and Indices ##
 *
 * For any given vertex, we want to be able to specify two bones and their
 * weights, a total of four values when all is said and done.  But since the
 * weights need to add up to 1, that's really one value.  Another potential
 * simplification is that since our art skills are effectively nil in here, we
 * could depend that we're only ever talking about two adjacent bones.  Of
 * course, it seems like we should aspire higher than that, so we won't do that.
 *
 * ThreeCSG currently requires you to be using UV values or it dies.  This
 * gives us two values.  We have three or four values we want to pack in there.
 *
 * Our weights occupy a limited range [0, 1.0] so if we, say, exclude the 1.0
 * value so that we can store the vertex number in the whole number part and the
 * weight in the fractional part (and handle the 1.0 case by specifying 0.5 for
 * both or something), we can be clever/evil.
 */
define(function(require) {

var THREE = require('three');
var ThreeBSP = require('threeBSP');


/**
 * Torsos are extruded ovals that are beveled at the ends, because nature
 * abhors a non-bevel.
 *
 * We're assuming a quadruped+ for now.
 *
 * Torsos are the core of our hierarchy.  We have our bones mimic reality with
 *   a spine just below the surface at the top of the torso.  Bones:
 * - Root/anchor bone: the spine at the withers/stable point.
 * - One spine bone per leg pair.  This owns the part of the torso that
 *   surrounds it, with transitions to the next spine links.
 * - One hip-type bone per leg per leg pair.  These are hung off of the matching
 *   spine bone.  The torso decides the position of this joint/socket, but
 *   does not actually create it or use it itself.  Instead, we leave it to the
 *   leg to create the bone.  We do tell it about the spine bone so it can
 *   use it as the parent bone and perform some blending of the top of the leg
 *   with the torso weighting.
 *
 * @param {DynamicGeometryHelper} dgh
 * @param specs
 * @param specs.length
 * @param specs.height
 * @param specs.width
 * @param specs.skinDepth
 *   How thick is the skin?  Controls how far inside the body bones go.  (At
 *   least bones that we're not pretending are symmetrically encased in
 *   muscle/fat/whatever, like we pretend legs are.)
 * @param specs.legLength
 * @param specs.legPairs [LegInfo]
 */
function Torso(specs) {
  var length = this.length = specs.length;
  var height = this.height = specs.height;
  var width = this.width = specs.width;
  var skinDepth = this.skinDepth = specs.skinDepth;
  var legLength = this.legLength = specs.legLength;

  var halfHeight = height / 2;
  var halfWidth = width / 2;
  var torsoTop = legLength + height;
  var spineTop = torsoTop - skinDepth;

  var numLegPairs = specs.legPairs.length;

  var rootBonePos = this.rootBonePos =
        new THREE.Vector3(0, spineTop, skinDepth);
  var spineLength = (length - skinDepth * 2);
  var spineDelta = new THREE.Vector3(0, 0, spineLength / (numLegPairs - 1));

  this.legPairs = specs.legPairs.map(function(legPair, iLegPair) {
    // Because of how we're doing the bones via uv mapping, we do need to
    // produce separate geometries.  For sanity/simplicity, we create a
    // Leg object for each leg
    var legSpecs = {
      radius: legPair.radius,
      overallLength: legLength + halfHeight,
      footLength: specs.footLength
    };

    var legXOffset = (halfWidth - legPair.radius);
    var legYOffset = spineTop - (legLength + halfHeight);
    // While in world-space the hip-joint-ish things want to be X/Y displaced,
    // in bone-space we actually want this to happen in X/Z space because of
    // the rotation of the spine from +Y to +Z.
    var leftJointOffset = new THREE.Vector3(-legXOffset,
                                            0,
                                            legYOffset);
    var rightJointOffset = new THREE.Vector3(legXOffset,
                                             0,
                                             legYOffset);

    var pairInfo = {
      spineBone: null,
      spinePosDelta: iLegPair ? spineDelta : new THREE.Vector3(),
      leftJointOffset: leftJointOffset,
      rightJointOffset: rightJointOffset,
      leftLeg: new Leg('legs' + iLegPair + '-left',  legSpecs, 'left'),
      rightLeg: new Leg('legs' + iLegPair + '-right', legSpecs, 'right'),
    };
    return pairInfo;
  });
}
Torso.prototype = {
  _createTorsoMesh: function(dgh) {
    var vRad = this.height / 2, hRad = this.width / 2;

    // We want the entire spine to be oriented down the Z axis.
    // We need to rotate from +Y (the bone direction convention) to +Z, which is
    // around +X, 90 degs
    var rootRotQ = new THREE.Quaternion();
    rootRotQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    var rootBone = dgh.addBone({
      name: 'root',
      pos: this.rootBonePos,
      rotq: rootRotQ,
      // our root is not used for anything, this does not matter.
      length: 0,
      transition: 0
    });

    var norot = new THREE.Quaternion();

    // Our exciting oval body!
    var ovalShape = dgh.makeEllipseShape(hRad, vRad);

    var lastSpineBone = rootBone;
    // create the bones
    var extrudeBones = this.legPairs.map(function(pairInfo, iPairInfo) {
      lastSpineBone = pairInfo.spineBone = dgh.addBone({
        name: 'spine' + iPairInfo,
        parent: lastSpineBone,
        pos: pairInfo.spinePosDelta,
        // we are already pointed +Z
        rotq: norot,
      });
      return lastSpineBone;
    });

    return dgh.extrudeBonedThingIntoMesh({
      shape: ovalShape,
      bones: extrudeBones,
      length: this.length
    });
  },

  createCSG: function(dgh) {
    var torsoMesh = this._createTorsoMesh(dgh);
    var torsoCSG = new ThreeBSP(torsoMesh);

    var aggrCSG = torsoCSG;

    this.legPairs.forEach(function(pairInfo) {
      var leftCSG = pairInfo.leftLeg.createCSG(
        dgh, pairInfo.spineBone, pairInfo.leftJointOffset);
      aggrCSG = aggrCSG.union(leftCSG);
      var rightCSG = pairInfo.rightLeg.createCSG(
        dgh, pairInfo.spineBone, pairInfo.rightJointOffset);
      aggrCSG = aggrCSG.union(rightCSG);
    });

    return aggrCSG;
  }
};

/**
 * Create a leg suitable for walking in the -Z direction with all joints
 * rotating around -X because that's easier to right-hand-rule.  (If convention
 * is different, that should be changed.)
 *
 * A leg always consists of two leg segments connected by a knee, plus a foot
 * and an ankle.
 *
 * Bones / segments:
 * - Upper leg (bone), entirely that bone
 * - Knee region.  Quick linear transition between upper and lower leg.
 * - Lower leg (bone), entirely that bone
 * - Ankle. Like the knee, a quick transition.
 * - Foot / hoof (bone).
 *
 * Initial configurations are legs are vertical / perpendicular to the ground,
 * the foot is tangent to the leg / parallel to the ground.
 *
 * @param specs.radius
 * @param specs.overallLength
 *   The overall length of the leg.  This includes everything; all other sizes
 *   are just talking about pieces of this overall length.
 * @param specs.footLength
 *   The length of the foot; this should probably be mooted by separate foot
 *   geometry which self-identifies the size.
 */
function Leg(name, specs, whichLeg) {
  this.name = name;
  this.radius = specs.radius;
  this.overallLength = specs.overallLength;
  this.footLength = specs.footLength;
};
Leg.prototype = {
  createCSG: function(dgh, spineBone, jointPosOffset) {
    var legLength = this.overallLength - this.footLength;
    // The spine is transformed to point along +Z, but we want the leg pointing
    // at -Y, so we want another 90 degree rotation around +X.
    var rotLegDown = new THREE.Quaternion();
    rotLegDown.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    var upperLegBone = dgh.addBone({
      name: this.name + '-upper-leg',
      parent: spineBone,
      pos: jointPosOffset,
      rotq: rotLegDown,
      length: legLength * 0.5,
      transition: legLength * 0.1
    });
    // The leg points at -Y like its parent.
    var norot = new THREE.Quaternion();
    var lowerLegBone = dgh.addBone({
      name: this.name + '-lower-leg',
      parent: upperLegBone,
      // (in bone-space this bone is along the +Y axis from its parent)
      pos: new THREE.Vector3(0, legLength * 0.55, 0),
      rotq: norot,
      length: legLength * 0.3,
      transition: legLength * 0.1
    });
    var footBone = dgh.addBone({
      name: this.name + '-foot',
      parent: lowerLegBone,
      pos: new THREE.Vector3(0, legLength * 3, 0),
      // the foot bone wants to be tangent in the future, but for  now...
      rotq: norot,
      length: this.footLength,
      transition: 0
    });

    var legShape = dgh.makeEllipseShape(this.radius, this.radius);
    var legMesh = dgh.extrudeBonedThingIntoMesh({
      shape: legShape,
      featherBone: spineBone,
      featherLength: legLength * 0.1,
      bones: [
        upperLegBone,
        lowerLegBone,
        footBone
      ],
      length: this.overallLength
    });
    return new ThreeBSP(legMesh);
  }
};

return {
  Torso: Torso,
  Leg: Leg
};

});
