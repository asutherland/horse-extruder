require.config({
  baseUrl: 'src',
  paths: {
    'three': '../lib/three',
    'threeBSP': '../lib/ThreeCSG',
  },
  shim: {
    'three': {
      exports: 'THREE'
    },
    'threeBSP': {
      deps: ['three'],
      exports: 'ThreeBSP'
    }
  }
});
require(['app'], function(app) {
  app.main();
});
