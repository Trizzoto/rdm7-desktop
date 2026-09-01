use std::path::Path;

/// Notice when a file is ADDED to the frontend.
///
/// `frontendDist` is `../src/dist` and there is no `devUrl`, so the whole
/// directory is baked into the binary by `generate_context!` at compile time.
/// Editing a file that is already in there is handled without our help:
/// the codegen emits an `include_bytes!` for every asset, rustc writes them
/// all into `target/debug/rdm7-desktop.d`, and cargo rebuilds when one of
/// them moves. Deleting one is covered too — cargo treats a dep that has
/// gone missing as dirty.
///
/// Adding one is the gap. A brand new file appears in no dep-info anywhere,
/// so cargo has nothing to compare, skips the rebuild, and the app runs on
/// without it: the asset 404s at `tauri.localhost` and the failure looks like
/// a bad path rather than a build that never happened. Listing the
/// directories here closes it — a directory's mtime moves when a file is
/// added or removed. The per-file lines are belt and braces.
///
/// `beforeDevCommand` runs merge_overlay.py before cargo starts, so by the
/// time we get here `dist/index.html` is already current.
fn watch(dir: &Path) {
    println!("cargo:rerun-if-changed={}", dir.display());
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        // A fresh clone, before the first merge_overlay.py run. The missing
        // path is still printed above, so cargo re-runs us once it appears.
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            watch(&path);
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}

fn main() {
    watch(Path::new("../src/dist"));
    tauri_build::build()
}
