// probe-vala — run the real cstimer_module bundle under JavaScriptCore, the
// way a Vala port would.
//
// Why this probe exists: RUST-PORT.md tested six engines that all reproduce
// Node's 206 scrambles byte-for-byte and recommended embedding rather than
// porting. This asks the same question for the other candidate language. Vala
// has no JavaScriptCore binding problem at all — the `jsc/` GObject API ships
// as a vapi (`valac --pkg javascriptcoregtk-6.0`) and is a `GObject` API all
// the way down, so there is no manual `extern "C"` block and no `unsafe`, the
// two things the Rust probe spends its lines on.
//
// Three modes, all needed before a port could be called proven:
//
//   (default)   evaluate shim + bundle + sweep — the dump a caller diffs
//               against `node-reference.cjs`
//   --thread    same, with the context created on a worker thread and no
//               GLib main loop running (the app's rule 4)
//   --api       the host calls into the module — setSeed / getScramble /
//               getImage with typed arguments — and counts what comes back
//
// shim.js and sweep.js are verbatim copies of `probe-common/src/lib.rs`'s
// SHIM and sweep_expr (only the catalogue's source differs: parsed into a
// `TYPES` global here instead of embedded as a string literal). Keep them in
// step if either ever changes.
//
// Build/run: ./run.sh

/// Read a whole file, or abort — a probe that cannot read its input has
/// nothing useful to say.
string read_file (string path) {
    string contents;
    try {
        FileUtils.get_contents (path, out contents);
    } catch (FileError e) {
        error ("cannot read %s: %s", path, e.message);
    }
    return contents;
}

/// `jsc_context_evaluate` returns NULL and parks the reason on the context,
/// so failure is "check the result, then ask the context why".
int fail (JSC.Context ctx, string what) {
    unowned JSC.Exception? exc = ctx.get_exception ();
    stderr.printf ("[vala/jsc] %s: %s\n", what, exc != null ? exc.report () : "<no exception>");
    return 1;
}

/// Fresh VM + context, shim first — the bundle's `isInNode` test needs those
/// globals before it installs `module.exports`.
JSC.Context? boot (string bundle_path, string probe_dir) {
    string shim = read_file (probe_dir + "/shim.js");
    string bundle = read_file (bundle_path);

    var ctx = new JSC.Context ();

    var t0 = GLib.get_monotonic_time ();
    var shim_value = ctx.evaluate (shim, shim.length);
    if (shim_value == null) {
        fail (ctx, "shim");
        return null;
    }
    stdout.printf ("[vala/jsc] shim -> %s\n", shim_value.to_string ());

    // The bundle is 250 KB of Closure-compiled ES5 and one expression, so
    // there is nothing to hand it but the source and a byte count.
    if (ctx.evaluate (bundle, bundle.length) == null) {
        fail (ctx, "cstimer_module.js");
        return null;
    }
    stdout.printf ("[vala/jsc] bundle evaluated OK in %lldus\n",
                   GLib.get_monotonic_time () - t0);
    return ctx;
}

/// Default mode: one evaluate that seeds, walks the catalogue in lockstep and
/// returns the dump as a string.
int run_probe (string bundle_path, string types_path, string probe_dir) {
    string types = read_file (types_path);
    string sweep = read_file (probe_dir + "/sweep.js");

    var ctx = boot (bundle_path, probe_dir);
    if (ctx == null) {
        return 1;
    }

    // Hand the 206-type catalogue over as a JSON global rather than splicing
    // it into the sweep source — JSC parses it, the sweep just reads it.
    ctx.set_value ("TYPES", new JSC.Value.from_json (ctx, types));

    var result = ctx.evaluate (sweep, sweep.length);
    if (result == null) {
        return fail (ctx, "sweep");
    }
    stdout.printf ("%s", result.to_string ());
    return 0;
}

/// The call path a port actually uses: the host calls into the module, with
/// three result shapes to marshal — a string, a boolean `false` (RUST-PORT.md
/// §3's trap 2: not null, not an exception), and a thrown exception.
///
/// Runs as its own mode so nothing here can perturb the RNG stream the dump
/// sweep measures. Expected counts are the reference run's.
int run_api (string bundle_path, string types_path, string probe_dir) {
    var ctx = boot (bundle_path, probe_dir);
    if (ctx == null) {
        return 1;
    }
    var exports = ctx.get_value ("module").object_get_property ("exports");
    if (!exports.is_object ()) {
        stderr.printf ("[vala/api] module.exports is not an object\n");
        return 1;
    }
    var set_seed = exports.object_get_property ("setSeed");
    var get_scramble = exports.object_get_property ("getScramble");
    var get_image = exports.object_get_property ("getImage");
    if (!set_seed.is_function () || !get_scramble.is_function () || !get_image.is_function ()) {
        stderr.printf ("[vala/api] exports are not the three functions\n");
        return 1;
    }

    JSC.Value[] seed42 = { new JSC.Value.string (ctx, "42") };
    JSC.Value[] scramble333 = { new JSC.Value.string (ctx, "333"),
                                new JSC.Value.number (ctx, 20) };
    int failures = 0;

    // Seed parity: the same seed must produce the same scramble.
    set_seed.function_callv (seed42);
    var first = get_scramble.function_callv (scramble333);
    set_seed.function_callv (seed42);
    var second = get_scramble.function_callv (scramble333);
    if (first == null || second == null) {
        return fail (ctx, "getScramble('333', 20)");
    }
    bool deterministic = first.is_string () && second.is_string ()
                         && first.to_string () == second.to_string ();
    stdout.printf ("[vala/api] seed parity: %s  sample: %s\n",
                   deterministic ? "identical" : "DIFFERENT",
                   deterministic ? first.to_string () : "<see above>");
    if (!deterministic) {
        failures++;
    }

    // Host-driven walk over the whole catalogue: every value crosses the
    // Vala ↔ JS boundary, none of it is marshalled from inside the script.
    var types = new JSC.Value.from_json (ctx, read_file (types_path));
    int count = (int) types.object_get_property ("length").to_double ();
    int ok = 0, empty = 0, images = 0, no_image = 0, bad = 0;
    string sample_image = "";

    set_seed.function_callv (seed42);
    for (int i = 0; i < count; i++) {
        var ty = types.object_get_property_at_index (i);
        string id = ty.object_get_property ("id").to_string ();
        double len = ty.object_get_property ("len").to_double ();

        JSC.Value[] scramble_args = { new JSC.Value.string (ctx, id),
                                      new JSC.Value.number (ctx, len) };
        var scr = get_scramble.function_callv (scramble_args);
        if (scr == null || !scr.is_string ()) {
            bad++;
            stdout.printf ("  FAIL %s: getScramble returned %s\n", id,
                           scr == null ? "an exception" : "a non-string");
            if (scr == null) {
                ctx.clear_exception ();
            }
            continue;
        }
        string text = scr.to_string ();
        if (text.strip () == "") {
            empty++;
        } else {
            ok++;
        }

        JSC.Value[] image_args = { scr, new JSC.Value.string (ctx, id) };
        var image = get_image.function_callv (image_args);
        if (image == null) {
            bad++;
            ctx.clear_exception ();
            stdout.printf ("  FAIL %s: image threw\n", id);
            continue;
        }
        if (image.is_string () && image.to_string ().length > 0) {
            images++;
            if (sample_image == "") {
                sample_image = image.to_string ().substring (0, 40);
            }
        } else if (image.is_boolean ()) {
            no_image++;                     // the documented `false`, not a hole
        } else {
            bad++;
            stdout.printf ("  FAIL %s: image is neither string nor boolean\n", id);
        }
    }

    stdout.printf ("[vala/api] host-driven OK=%d empty=%d images=%d no-image=%d failures=%d total=%d\n",
                   ok, empty, images, no_image, bad + failures, count);
    stdout.printf ("[vala/api] image sample: %s…\n", sample_image);

    return (ok == 206 && empty == 0 && images == 177 && bad == 0) ? 0 : 1;
}

int main (string[] args) {
    int off = 1;
    bool threaded = false;
    bool api = false;
    while (off < args.length && args[off].has_prefix ("--")) {
        if (args[off] == "--thread") {
            threaded = true;
        } else if (args[off] == "--api") {
            api = true;
        } else {
            stderr.printf ("usage: probe-vala [--thread] [--api] <bundle.js> <types.json> <probe-dir>\n");
            return 2;
        }
        off++;
    }
    if (args.length != off + 3) {
        stderr.printf ("usage: probe-vala [--thread] [--api] <bundle.js> <types.json> <probe-dir>\n");
        return 2;
    }
    string bundle_path = args[off];
    string types_path = args[off + 1];
    string probe_dir = args[off + 2];

    // The app's rule 4: a 4x4 WCA scramble takes ~1.2 s and must never run on
    // the UI thread. `--thread` builds the whole context on a plain worker
    // thread with no GLib main loop running — the shape a port would use.
    if (!threaded) {
        return api ? run_api (bundle_path, types_path, probe_dir)
                    : run_probe (bundle_path, types_path, probe_dir);
    }
    int rc = 1;
    string bp = bundle_path, tp = types_path, dp = probe_dir;
    bool use_api = api;
    var thread = new Thread<void*> ("jsc-sweep", () => {
        rc = use_api ? run_api (bp, tp, dp) : run_probe (bp, tp, dp);
        return null;
    });
    thread.join ();
    return rc;
}
