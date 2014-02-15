require.config({
  baseUrl: 'src',
  paths: {
    'three': '../lib/three.min',
  },
  shim: {
    'three': {
      exports: 'THREE'
    }
  }
});
require(['app'], function(app) {
  app.main();
});
