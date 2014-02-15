define(function(require, exports, module) {
var THREE = require('three');
var ThreeBSP = require('threeBSP');

exports.main = function() {
  var camera, scene, renderer, funkyMesh

  init();
  animate();

  function init() {

    camera = new THREE.PerspectiveCamera(
               75,
               window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 1000;

    scene = new THREE.Scene();

    var cubeGeom = new THREE.CubeGeometry( 200, 200, 200 );
    var cubeMesh = new THREE.Mesh(cubeGeom);
    var cubeBSP = new ThreeBSP(cubeMesh);

    var sphereGeom = new THREE.SphereGeometry( 100, 32, 32 );
    var sphereMesh = new THREE.Mesh(sphereGeom);
    sphereMesh.position.set(100, 100, 100);
    var sphereBSP = new ThreeBSP(sphereMesh);

    var funkyBSP = cubeBSP.subtract(sphereBSP);
    var funkyMaterial =  new THREE.MeshBasicMaterial({
      color: 0xff0000,
      wireframe: true
    });
    funkyMesh = funkyBSP.toMesh(funkyMaterial);
    funkyMesh.geometry.computeVertexNormals();

    scene.add( funkyMesh );

    renderer = new THREE.CanvasRenderer();
    renderer.setSize( window.innerWidth, window.innerHeight );

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
