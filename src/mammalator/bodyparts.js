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
define(function(require, exports, module) {

var THREE = require('three');
var ThreeBSP = require('threeBSP');


/**
 * Torsos are extruded ovals that are beveled at the ends, because nature
 * abhors a non-bevel.
 *
 * We're assuming a quadruped+ for now.
 *
 * Torsos are the core of our hierarchy.  Bones:
 * - Root/anchor bone: middle of the torso, but not used for anything.
 * - One bone per leg pair.  The space allocated for the legs around it is
 *   entirely allocated to that bone.  We then transition linearly between
 *   this segment and the next leg segment/bone.
 *
 * @param {DynamicGeometryHelper} dgh
 * @param specs
 * @param specs.length
 * @param specs.height
 * @param specs.width
 * @param specs.legLength
 * @param specs.legPairs [LegInfo]
 */
function Torso(specs) {
  this.length = specs.length;
  this.height = specs.height;
  this.width = specs.width;
  this.legLength = specs.legLength;

  var numLegPairs = specs.legPairs.length;
  this.legPairs = specs.legPairs.map(function(legPair, iLegPair) {
    // Because of how we're doing the bones via uv mapping, we do need to
    // produce separate geometries.  For sanity/simplicity, we create a
    // Leg object for each leg
    var pairInfo = {

    };
  });
}
Torso.prototype = {
  _createTorsoGeom: function(dgh) {
    var vRad = this.height / 2, hRad = this.width / 2;

    // Our exciting oval body!
    var ovalShape = dgh.makeEllipseShape(hRad, vRad);


  },

  createCSG: function(dgh) {
    var torsoGeom = this._createTorsoGeom(dgh);
    var torsoMesh = new THREE.Mesh(torsoGeom);
    var torsoCSG = new ThreeBSP(torsoMesh);

  }
};

/**
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
 *   The len
 */
function Leg(name, specs) {
  this.name = name;
  this.overallLength = specs.overallLength;
  this.footLength = specs.footLength;
};
Leg.prototype = {
  createCSG: function(dgh) {
    var legLength = this.overallLength - this.footLength;
    var upperLegBone = dgh.addBone({
      name: this.name + '-upper-leg',
      length: legLength * 0.4,
      transition: legLength * 0.1
    });
    var lowerLegBone = dgh.addBone({
      name: this.name + '-lower-leg',
      length: legLength * 0.4,
      transition: legLength * 0.1
    });
    var footBone = dgh.addBone({
      name: this.name + '-foot',
      length: this.footLength,
      transition: 0
    });

    var geom = dgh.extrudeBonedThing({
      shape:
    });

    var geom = new THREE.ExtrudeGeometry(
      shape,
      {
        // Look at least a little bit round; 2 intra points per 90 deg.
        curveSegments: 12,
        steps: this.length / EXTRUDE_SAMPLE_DENSITY,
        amount: this.length,
        uvGenerator: uvgen
      });
  }
};

});
