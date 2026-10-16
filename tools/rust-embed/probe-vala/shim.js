(function(){
  var g = globalThis;
  g.global = g;
  g.process = {};
  g.require = function(){ return {}; };
  g.module = { exports: {} };
  g.console = { log: function(){}, warn: function(){}, error: function(){} };

  g.SCRAMBLE_NOOBST = [
    ['turn the top face', 'turn the bottom face'],
    ['turn the right face', 'turn the left face'],
    ['turn the front face', 'turn the back face']
  ];
  g.SCRAMBLE_NOOBSS =
    ' clockwise by 90 degrees,| counterclockwise by 90 degrees,| by 180 degrees,';

  if (!String.prototype.substr) {
    String.prototype.substr = function(start, len) {
      var s = String(this);
      start = start < 0 ? Math.max(s.length + start, 0) : Math.min(start, s.length);
      if (len === undefined) return s.slice(start);
      return s.slice(start, start + Math.max(len, 0));
    };
  }
  return 'shim-ok';
})()
