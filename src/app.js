define(function(require, exports, module) {
var THREE = require('three');
var ThreeBSP = require('threeBSP');

var mammalate = require('mammalator/mammalate');

exports.main = function() {
  var camera, scene, renderer, funkyMesh;

  init();
  animate();

  function init() {

    camera = new THREE.PerspectiveCamera(
               75,
               window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 100;

    scene = new THREE.Scene();

    var funkyMaterial =  new THREE.MeshBasicMaterial({
      color: 0xff0000,
      wireframe: true
    });

    /*
    var cubeGeom = new THREE.CubeGeometry( 200, 200, 200 );
    var cubeMesh = new THREE.Mesh(cubeGeom);
    var cubeBSP = new ThreeBSP(cubeMesh);

    var sphereGeom = new THREE.SphereGeometry( 100, 32, 32 );
    var sphereMesh = new THREE.Mesh(sphereGeom);
    sphereMesh.position.set(100, 100, 100);
    var sphereBSP = new ThreeBSP(sphereMesh);

    var funkyBSP = cubeBSP.subtract(sphereBSP);
    funkyMesh = funkyBSP.toMesh(funkyMaterial);
    funkyMesh.geometry.computeVertexNormals();

    scene.add( funkyMesh );
    */

    var horseMesh = mammalate.makeHorse(funkyMaterial);

    renderer = new THREE.WebGLRenderer();
    renderer.setSize( window.innerWidth - 10, window.innerHeight - 10);

    document.body.appendChild( renderer.domElement );

  }

  function animate() {
    // note: three.js includes requestAnimationFrame shim
    requestAnimationFrame( animate );

    funkyMesh.rotation.x += 0.01;
    funkyMesh.rotation.y += 0.02;

    renderer.render( scene, camera );
  }
};
});
