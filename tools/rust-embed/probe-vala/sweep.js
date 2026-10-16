(function(){
  var c = globalThis.module.exports;
  var types = globalThis.TYPES;
  c.setSeed('42');
  var ok = 0, empty = 0, img = 0, failed = [], slow = [], dump = [];
  var tAll = Date.now();
  for (var i = 0; i < types.length; i++) {
    var ty = types[i];
    var s0 = Date.now();
    var scr;
    try { scr = c.getScramble(ty.id, ty.len); }
    catch (e) { failed.push(ty.id + ': scramble ERROR ' + e.message); continue; }
    slow.push([Date.now() - s0, ty.id]);
    dump.push(ty.id + '\t' + JSON.stringify(String(scr)));
    if (String(scr).trim() === '') { empty++; } else { ok++; }
    try {
      var im = c.getImage(scr, ty.id);
      if (typeof im === 'string' && im.length) img++;
    } catch (e) { failed.push(ty.id + ': image ERROR ' + e.message); }
  }
  slow.sort(function(a, b) { return b[0] - a[0]; });
  var out = [];
  out.push('generated OK=' + ok + ' empty=' + empty + ' images=' + img +
           ' failures=' + failed.length + ' total=' + types.length);
  for (var i = 0; i < failed.length; i++) out.push('  FAIL ' + failed[i]);
  out.push('sweep wall time: ' + (Date.now() - tAll) + 'ms');
  out.push('slowest types:');
  for (var i = 0; i < Math.min(5, slow.length); i++) {
    out.push('  ' + slow[i][1] + ' ' + slow[i][0] + 'ms');
  }
  return '===DUMP===\n' + dump.join('\n') + '\n===COUNTS===\n' + out.join('\n');
})()
